// @vitest-environment node
// Phase 3: trucker path, pain areas, diet drafts — the rules live in code and are tested here.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { handleAiRequest, type HandlerDeps, type UserScopedDb } from './handler';
import { emptyOutput, type CoachOutput, type PlanDraft } from './aiContracts';
import { EXERCISE_LIBRARY, exerciseId } from './exerciseCatalog';
import { allowedExercises, checkPlan, enforceBodyRules, NO_GYM_EQUIPMENT, PAIN_RULES, type PlanningAnswers } from './planRules';
import { readProfile } from './envelope';
import type { Shelf } from './diet';

const USER = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://rozana.example';
const shelf = JSON.parse(readFileSync(new URL('./data/diet-shelf.json', import.meta.url), 'utf8')) as Shelf;
const SHELF = new Map(shelf.dishes.map((d) => [d.id, d]));
const EQUIP = new Map(EXERCISE_LIBRARY.map((x) => [exerciseId(x), x.equipment]));
const usage = { input_tokens: 1000, output_tokens: 200, thinking_tokens: 0, total_tokens: 1200 };

const baseTraining = {
  goal_priorities: ['fat_loss'], days_available: [], sessions_per_week: 2, minutes_per_session: 30, time_windows: [], rotating_schedule: true,
  experience: 'new', current_routine: '', exercise_likes: '', recent_performance: '', location: 'truck', equipment: ['dumbbell', 'band', 'barbell', 'machine'],
  avoid_exercises: '', restrictions: '', screening: 'no_concerns', inspiration_note: '', lifestyle: 'trucker', pain_areas: ['lower_back', 'knees'], pain_note: 'Back gets stiff after long drives',
  goal_direction: null, sleep_pattern: 'shift', updated_at: '2026-10-09T00:00:00Z',
};
const settings = (training: Record<string, unknown> = {}, profile: Record<string, unknown> = {}) => ({
  collection: 'settings', doc_id: 'p', deleted: false,
  body: { profile: {
    units: 'kg', goal: 'fat_loss', timezone: 'America/Toronto', adult_confirmed: true, profile_version: 5, height_cm: 178, nickname: 'Harjit',
    training: { ...baseTraining, ...training }, food_prefs: { pattern: 'vegetarian', meatless_weekdays: [], allergies: [], cuisine: 'punjabi_home' }, consent: {},
    body: { weight_kg: 95, age_years: 45, sex: 'male', goal_weight_kg: null, goal_weeks: null }, ...profile,
  } },
});

const ex = (id: string, sets = 2) => ({ exercise_id: id, variant_id: null, working_sets: sets, rep_min: 8, rep_max: 12, target_load: null, load_unit: 'kg' as const, rest_seconds: 60, effort_instruction: '', substitution_exercise_ids: [], notes: '' });
const draft = (days: PlanDraft['days']): PlanDraft => ({
  title: 'Cab plan', status: 'draft', goal: 'fat loss', profile_version: '5', schedule_mode: 'rotation', duration_weeks_before_review: 4,
  warmup: [{ instruction: 'Walk around the truck', minutes: 3 }], days, recovery_notes: [], progression_rule: 'Add a rep when it feels easy.', review_trigger: '4 weeks',
});

function deps(rows: unknown[], model: (text: string) => unknown) {
  const callModel = vi.fn(async (r: { text: string }) => ({ json: model(r.text), usage }));
  const storePlanDraft = vi.fn<(a: { kind?: string; plan: unknown }) => Promise<{ id: string; created_at: string }>>(async () => ({ id: 'draft-1', created_at: '2026-10-09T10:00:00Z' }));
  const finish = vi.fn(async () => undefined);
  const reserve = vi.fn(async () => ({ status: 'reserved' as const, request_id: 'req-1' }));
  const db: UserScopedDb = {
    membership: async () => 'active', aiConsent: async () => true, imageConsent: async () => false,
    documents: async () => rows as never, memory: async () => [], thread: async () => [], photos: async () => [],
  };
  const d: HandlerDeps = {
    config: { apiKey: 'k', modelId: 'm', style: 'generate_content', pricing: { inputPerMTok: 0.5, outputPerMTok: 3 }, allowedOrigins: [ORIGIN], timeoutMs: 1000, dietShelf: shelf },
    verifyToken: async () => ({ sub: USER }),
    userDb: () => db,
    admin: { reserve, finish, storeReview: vi.fn(), storeExchange: vi.fn(), storePlanDraft },
    callModel,
  };
  return { d, callModel, storePlanDraft, finish, reserve };
}
const post = (body: unknown) => new Request('https://fn.example/ai', { method: 'POST', headers: { authorization: 'Bearer good', origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const planReq = { operation: 'onboarding_plan', operation_id: '77777777-7777-4777-8777-777777777777', today: '2026-10-09', timezone: 'America/Toronto', profile_version: 5 };
const dietReq = { operation: 'diet_draft', operation_id: '88888888-8888-4888-8888-888888888888', today: '2026-10-09', timezone: 'America/Toronto', profile_version: 5 };

describe('trucker path: no gym access → only bodyweight, dumbbell, kettlebell and band moves', () => {
  it('filters the allowed list whatever else is listed', () => {
    const a = allowedExercises({ equipment: ['barbell', 'machine', 'cable', 'dumbbell', 'band'], avoid_exercises: '', location: 'truck' });
    expect(a.length).toBeGreaterThan(10);
    expect(a.every((x) => NO_GYM_EQUIPMENT.includes(x.equipment))).toBe(true);
    const home = allowedExercises({ equipment: ['barbell', 'kettlebell'], avoid_exercises: '', location: 'home' });
    expect(home.some((x) => x.equipment === 'barbell')).toBe(false);
    expect(home.some((x) => x.equipment === 'kettlebell')).toBe(true);
    // Gym access keeps the full list.
    expect(allowedExercises({ equipment: ['barbell'], avoid_exercises: '', location: 'both' }).some((x) => x.equipment === 'barbell')).toBe(true);
  });

  it('the envelope gets cab-only exercises; a gym move in the draft is rejected and retried', async () => {
    let n = 0;
    const { d, callModel, storePlanDraft } = deps([settings({ pain_areas: [] })], () => {
      n++;
      const days = n === 1
        ? [{ label: 'Cab day', weekday: null, estimated_minutes: 25, exercises: [ex('squat:barbell'), ex('push_up:bodyweight')] }]
        : [{ label: 'Cab day', weekday: null, estimated_minutes: 25, exercises: [ex('goblet_squat:dumbbell'), ex('push_up:bodyweight'), ex('band_row:band')] }];
      return { ...emptyOutput('draft_ready', 'A short plan you can do at a rest stop.'), plan: draft(days) } satisfies CoachOutput;
    });
    const res = await (await handleAiRequest(post(planReq), d)).json();
    const sent = (callModel.mock.calls[0]![0] as { text: string }).text;
    const env = JSON.parse(sent.slice(sent.indexOf('{', sent.indexOf('ENVELOPE'))));
    expect(env.allowed_exercises.every((x: { equipment: string }) => NO_GYM_EQUIPMENT.includes(x.equipment))).toBe(true);
    expect(env.lifestyle.long_haul_driver).toBe(true);
    expect(env.equipment.no_gym_access).toBe(true);
    expect(sent).toMatch(/truck cab or at a rest stop/);
    expect(callModel).toHaveBeenCalledTimes(2);
    const stored = storePlanDraft.mock.calls[0]![0].plan as PlanDraft;
    expect(stored.days.flatMap((x) => x.exercises).every((e) => NO_GYM_EQUIPMENT.includes(EQUIP.get(e.exercise_id)!))).toBe(true);
    expect(res.output.status).toBe('draft_ready');
  });
});

describe('pain areas: loading moves out, supportive moves in', () => {
  const answers: PlanningAnswers = {
    goal_priorities: ['strength'], days_available: [1, 3], sessions_per_week: 2, minutes_per_session: 45, rotating_schedule: false, experience: 'regular',
    location: 'gym', equipment: ['barbell', 'dumbbell', 'cable', 'machine'], avoid_exercises: '', restrictions: '', screening: 'no_concerns', recent_performance: '',
    pain_areas: ['lower_back', 'knees'],
  };

  it('every rule only names real catalogue ids', () => {
    const ids = new Set(EXERCISE_LIBRARY.map(exerciseId));
    for (const r of Object.values(PAIN_RULES)) for (const id of [...r.exclude, ...r.supportive]) expect(ids.has(id)).toBe(true);
  });

  it('excluded movements are not allowed', () => {
    const a = allowedExercises(answers).map((x) => x.id);
    for (const id of [...PAIN_RULES.lower_back.exclude, ...PAIN_RULES.knees.exclude]) expect(a).not.toContain(id);
    expect(a).toContain('bird_dog:bodyweight');
  });

  it('enforceBodyRules removes excluded ids and adds a supportive move to the shortest day, within time', () => {
    const allowedAll = allowedExercises({ ...answers, pain_areas: [] });
    const allowed = allowedExercises(answers);
    const plan = draft([
      { label: 'A', weekday: 1, estimated_minutes: 40, exercises: [ex('squat:barbell', 3), ex('bench_press:barbell', 3), ex('row:cable', 3)] },
      { label: 'B', weekday: 3, estimated_minutes: 30, exercises: [ex('lat_pulldown:cable'), ex('plank:bodyweight')] },
    ]);
    const r = enforceBodyRules({ ...plan, days: plan.days.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e, substitution_exercise_ids: ['deadlift:barbell', 'leg_press:machine'] })) })) }, answers, allowed);
    const ids = r.plan.days.flatMap((d) => d.exercises.map((e) => e.exercise_id));
    expect(ids).not.toContain('squat:barbell');
    expect(r.plan.days.flatMap((d) => d.exercises.flatMap((e) => e.substitution_exercise_ids))).not.toContain('deadlift:barbell');
    // Lower back: plank isn't on the supportive list → bird dog; knees → glute bridge. The first goes to day B (shorter).
    expect(r.plan.days[1]!.exercises.map((e) => e.exercise_id)).toContain('bird_dog:bodyweight');
    expect(ids).toEqual(expect.arrayContaining(['bird_dog:bodyweight', 'glute_bridge:bodyweight']));
    expect(r.changes.join(' ')).toMatch(/Left out 1 movement/);
    const check = checkPlan(r.plan, answers, allowed, 'kg', 1);
    expect(check.errors).toEqual([]);
    expect(allowedAll.length).toBeGreaterThan(allowed.length);
  });

  it('when nothing fits the time, the supportive move becomes a rest-day note instead', () => {
    const tight = { ...answers, minutes_per_session: 20, pain_areas: ['shoulders'] };
    const allowed = allowedExercises(tight);
    const plan = draft([{ label: 'A', weekday: 1, estimated_minutes: 20, exercises: [ex('goblet_squat:dumbbell', 3), ex('push_up:bodyweight', 3), ex('plank:bodyweight', 2)] }]);
    const r = enforceBodyRules(plan, tight, allowed);
    expect(r.plan.days[0]!.exercises.map((e) => e.exercise_id)).not.toContain('band_pull_apart:band');
    expect(r.plan.recovery_notes.join(' ')).toMatch(/rest day/);
  });

  it('the handler applies the rules before validation, says what it changed, and an urgent pain note never reaches the model', async () => {
    const { d, storePlanDraft } = deps([settings({ location: 'both', equipment: ['dumbbell', 'barbell'], lifestyle: 'standard', rotating_schedule: true })], () => ({
      ...emptyOutput('draft_ready', 'Here is a plan.'),
      plan: draft([{ label: 'A', weekday: null, estimated_minutes: 25, exercises: [ex('deadlift:barbell'), ex('push_up:bodyweight'), ex('one_arm_row:dumbbell')] }]),
    }));
    const res = await (await handleAiRequest(post(planReq), d)).json();
    const stored = storePlanDraft.mock.calls[0]![0].plan as PlanDraft;
    const ids = stored.days.flatMap((x) => x.exercises.map((e) => e.exercise_id));
    expect(ids).not.toContain('deadlift:barbell');
    expect(ids.some((id) => PAIN_RULES.lower_back.supportive.includes(id))).toBe(true);
    expect(ids.some((id) => PAIN_RULES.knees.supportive.includes(id))).toBe(true);
    expect(res.output.assistant_message).toMatch(/Checked by the app: Left out 1 movement/);

    const urgent = deps([settings({ pain_note: 'numbness in my arm when I drive' })], () => ({}));
    const r2 = await (await handleAiRequest(post(planReq), urgent.d)).json();
    expect(r2.status).toBe('safety');
    expect(urgent.callModel).not.toHaveBeenCalled();
    expect(urgent.reserve).not.toHaveBeenCalled();
  });

  it('pain with a screening concern still goes to the guidance path', async () => {
    const { d, callModel } = deps([settings({ screening: 'has_concerns' })], () => ({}));
    const res = await (await handleAiRequest(post(planReq), d)).json();
    expect(res.output.status).toBe('guidance_needed');
    expect(callModel).not.toHaveBeenCalled();
  });
});

describe('diet_draft', () => {
  const vegDay = (ids: string[]) => ({ meals: [{ slot: 'lunch', items: ids.map((dish_id) => ({ dish_id, servings: 1 })) }], notes: ['Keep water handy.'] });

  it('asks for missing details without a model call or a reservation', async () => {
    const { d, callModel, reserve } = deps([settings({}, { body: { weight_kg: null, age_years: 45, sex: null } })], () => ({}));
    const res = await (await handleAiRequest(post(dietReq), d)).json();
    expect(res).toMatchObject({ status: 'ok', operation: 'diet_draft', draft: null });
    expect(res.questions).toHaveLength(2);
    expect(callModel).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('refuses a stale profile version', async () => {
    const { d } = deps([settings()], () => ({}));
    const r = await handleAiRequest(post({ ...dietReq, profile_version: 4 }), d);
    expect(r.status).toBe(409);
  });

  it('the envelope is minimised: targets from code, veg-only allowed dishes, no name, no history', async () => {
    const { d, callModel, reserve } = deps([settings()], () => vegDay(['asc096']));
    await handleAiRequest(post(dietReq), d);
    expect(reserve.mock.calls[0]![2]).toBe('diet_draft');
    const sent = (callModel.mock.calls[0]![0] as { text: string }).text;
    expect(sent).toMatch(/^OPERATION: diet_draft/);
    expect(sent).not.toMatch(/Harjit|history|meal_entries/);
    const env = JSON.parse(sent.slice(sent.indexOf('{', sent.indexOf('ENVELOPE'))));
    expect(env.allowed_dishes.every(([id]: [string]) => SHELF.get(id)!.diet === 'veg')).toBe(true);
    expect(env.targets.energy_kcal).toBeGreaterThan(1500);
  });

  it('a valid AI day is stored as a diet draft; totals are recomputed from the database (model numbers ignored)', async () => {
    const profile = readProfile([settings() as never]);
    expect(profile.body.weight_kg).toBe(95);
    // Build a day the checker accepts from the app's own composition, then let the "model" return it.
    const { composeDay, dietTargets, shelfFor } = await import('./diet');
    const t = dietTargets({ weight_kg: 95, height_cm: 178, age_years: 45, sex: 'male', goal: 'fat_loss', lifestyle: 'trucker', sessions_per_week: 2 });
    const day = composeDay(shelfFor(shelf.dishes, { pattern: 'vegetarian', allergies: [] }), t, { variant: 1 });
    const { d, storePlanDraft } = deps([settings()], () => ({ ...day, notes: ['Pack roasted chana for the drive.'], totals: { kcal: 99999 } }));
    const res = await (await handleAiRequest(post(dietReq), d)).json();
    expect(res.draft.plan.source).toBe('ai');
    expect(storePlanDraft.mock.calls[0]![0].kind).toBe('diet');
    const items = res.draft.plan.meals.flatMap((m: { items: { dish_id: string; servings: number }[] }) => m.items);
    expect(items.every((i: { dish_id: string }) => SHELF.get(i.dish_id)?.diet === 'veg')).toBe(true);
    const kcal = Math.round(items.reduce((s: number, i: { dish_id: string; servings: number }) => s + SHELF.get(i.dish_id)!.kcal * i.servings, 0));
    expect(res.draft.plan.totals.kcal).toBe(kcal);
    expect(Math.abs(kcal - res.draft.plan.targets.energy_kcal)).toBeLessThanOrEqual(res.draft.plan.targets.energy_kcal * 0.1);
  });

  it('an invented id or a non-veg dish gets one retry, then the app composes the day itself', async () => {
    const nonveg = shelf.dishes.find((x) => x.diet === 'nonveg')!.id;
    const { d, callModel, finish } = deps([settings()], (text) => (text.includes('REJECTED') ? vegDay(['made-up-dish']) : vegDay([nonveg])));
    const res = await (await handleAiRequest(post(dietReq), d)).json();
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(res.draft.plan.source).toBe('code');
    const ids = res.draft.plan.meals.flatMap((m: { items: { dish_id: string }[] }) => m.items.map((i) => i.dish_id));
    expect(ids.every((id: string) => SHELF.get(id)?.diet === 'veg')).toBe(true);
    expect(finish.mock.calls.at(-1)![1 + 1]).toBe('succeeded');
  });
});
