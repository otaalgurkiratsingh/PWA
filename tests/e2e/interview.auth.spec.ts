/**
 * Phase 3: the trainer interview, the trucker path, pain areas, progressive profiling, the food plan
 * and the weekly adaptation proposal — against the scripted Supabase mock (auth harness). Plan and
 * diet replies from the mock run through the REAL validator code (planRules.ts / diet.ts).
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { MockSupabase, type MockUser } from './mockSupabase';

const OWNER: MockUser = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com', membership: 'active' };
const SHELF = JSON.parse(readFileSync('supabase/functions/_shared/data/diet-shelf.json', 'utf8')) as { dishes: { id: string; diet: string }[] };
const NO_GYM = ['bodyweight', 'dumbbell', 'kettlebell', 'band'];

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('What should we call you?').fill('Harjit');
  await page.getByRole('checkbox', { name: /18 or older/ }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
}

const answers = (page: Page) => page.getByRole('group', { name: 'Your answer' });
const question = (page: Page) => page.getByTestId('interview-question');
async function chip(page: Page, name: string | RegExp) {
  await answers(page).getByRole('button', { name, exact: typeof name === 'string' }).click();
}

async function idbAll(page: Page, store: string) {
  return page.evaluate(async ([db, s]) => new Promise<unknown[]>((resolve, reject) => {
    const req = indexedDB.open(`rozana-journal-${db}`);
    req.onsuccess = () => {
      const g = req.result.transaction(s!, 'readonly').objectStore(s!).getAll();
      g.onsuccess = () => { resolve(g.result); req.result.close(); };
      g.onerror = () => reject(g.error);
    };
    req.onerror = () => reject(req.error);
  }), [OWNER.id, store]);
}

type Program = { version: number; name: string; days: { name: string; exercises: { exercise_key: string; variant: string; name: string; sets: unknown[] }[] }[] };
const latestProgram = async (page: Page) => ((await idbAll(page, 'programs')) as Program[]).sort((a, b) => b.version - a.version)[0]!;

/** The standard (non-trucker) interview, answering the essentials. */
async function standardInterview(page: Page, opts: { pain?: string[]; note?: string; equipment?: string[] } = {}) {
  await expect(question(page)).toContainText('Hi Harjit! I’m Luma, your trainer');
  await expect(page.getByText('A few more questions — about 2 min')).toBeVisible();
  await chip(page, 'A regular schedule');
  await chip(page, 'Get stronger');
  for (const d of ['Mon', 'Wed', 'Fri']) await chip(page, d);
  await chip(page, 'Done');
  await chip(page, '45 min');
  await chip(page, 'Gym');
  for (const e of opts.equipment ?? ['Barbell', 'Dumbbells']) await chip(page, e);
  await chip(page, 'Done');
  await chip(page, 'New to training');
  if (opts.pain?.length) {
    for (const p of opts.pain) await chip(page, p);
    await chip(page, 'Done');
  } else await chip(page, 'None of these');
  if (opts.note) {
    await page.getByLabel('Anything hurting right now?').fill(opts.note);
    await chip(page, 'Send');
  } else await chip(page, 'Nothing to add');
  await chip(page, 'I read it and nothing applied to me');
  await chip(page, 'Yes — back up and use AI help');
}

test('trainer interview → review → draft plan → accept (no AI call until Generate)', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  sb.aiHandler = (op, b, caller, s) => (op === 'onboarding_plan' ? s.validatedPlanReply(caller, b) : { status: 'error', error: 'not_configured', message: 'x' });
  await sb.install(page);
  await signIn(page);
  await standardInterview(page);
  // The conversation is kept on screen; every answer was a chip, nothing went to AI.
  await expect(page.locator('.bubble.me', { hasText: 'Get stronger' })).toBeVisible();
  expect(sb.aiCalls()).toEqual([]);
  // A reload resumes the same conversation (draft saved on the phone).
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Review my answers' })).toBeVisible();
  await page.getByRole('button', { name: 'Review my answers' }).click();
  await expect(page.getByRole('heading', { name: 'Review and plan' })).toBeVisible();
  await page.getByRole('button', { name: /Generate my draft plan/ }).click();
  await expect(page.getByText('Two-day starter')).toBeVisible({ timeout: 10_000 });
  expect(sb.profileOf(OWNER.id)).toMatchObject({ training: { goal_priorities: ['strength'], days_available: [1, 3, 5], sessions_per_week: 3, minutes_per_session: 45, location: 'gym', experience: 'new', screening: 'no_concerns', lifestyle: 'standard', pain_areas: [] } });
  await page.getByRole('button', { name: 'Accept plan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workout' })).toBeVisible();
  expect((await latestProgram(page)).days).toHaveLength(2);
  expect(sb.decided).toEqual([expect.objectContaining({ decision: 'accepted' })]);
});

test('trucker path: cab defaults, gym equipment listed but filtered out, "Built for the cab"', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  sb.aiHandler = (op, b, caller, s) => (op === 'onboarding_plan' ? s.validatedPlanReply(caller, b) : { status: 'error', error: 'not_configured', message: 'x' });
  await sb.install(page);
  await signIn(page);
  await chip(page, 'I drive long-haul / I’m on the road most days');
  await expect(page.getByText(/build around the cab and rest stops/)).toBeVisible();
  await chip(page, 'Lose fat');
  await expect(question(page)).toContainText('even 20 minutes at a rest stop');
  await chip(page, '2');
  await chip(page, '30 min');
  await chip(page, 'Truck cab / rest stop');
  // Dumbbells and bands are preselected; listing a barbell must not put barbell moves in the plan.
  await expect(answers(page).getByRole('button', { name: 'Dumbbells' })).toHaveAttribute('aria-pressed', 'true');
  await expect(answers(page).getByRole('button', { name: 'Bands' })).toHaveAttribute('aria-pressed', 'true');
  await chip(page, 'Barbell');
  await chip(page, 'Done');
  await chip(page, 'Coming back after a break');
  await chip(page, 'None of these');
  await chip(page, 'Nothing to add');
  await chip(page, 'I read it and nothing applied to me');
  await chip(page, 'Yes — back up and use AI help');
  await page.getByRole('button', { name: 'Review my answers' }).click();
  await expect(page.getByText(/Truck cab \/ rest stop · bodyweight, dumbbell, band, barbell · on the road most days/)).toBeVisible();
  await page.getByRole('button', { name: /Generate my draft plan/ }).click();
  await expect(page.getByText('Built for the cab — no gym needed.')).toBeVisible({ timeout: 10_000 });
  expect(sb.profileOf(OWNER.id)).toMatchObject({ training: { lifestyle: 'trucker', location: 'truck', rotating_schedule: true, sessions_per_week: 2, minutes_per_session: 30, equipment: ['dumbbell', 'band', 'barbell'] } });
  await page.getByRole('button', { name: 'Accept plan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workout' })).toBeVisible();
  const variants = (await latestProgram(page)).days.flatMap((d) => d.exercises.map((e) => e.variant));
  expect(variants.length).toBeGreaterThan(3);
  expect(variants.every((v) => NO_GYM.includes(v))).toBe(true);
});

test('skip-everything path: every question skippable; "standard plan" escape always works, with no AI', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  await sb.install(page);
  await signIn(page);
  for (let i = 0; i < 3; i++) await answers(page).getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.locator('.bubble.me', { hasText: 'Skip for now' })).toHaveCount(3);
  await expect(page.getByText(/more questions — about \d+ min/)).toBeVisible();
  await page.getByRole('button', { name: 'Just set me up with a standard plan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workout' })).toBeVisible();
  await expect(page.getByText('Full body A').first()).toBeVisible();
  expect(sb.aiCalls()).toEqual([]);
});

test('pain areas: loading moves left out, a supportive move added, never a diagnosis', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  sb.aiHandler = (op, b, caller, s) => (op === 'onboarding_plan' ? s.validatedPlanReply(caller, b) : { status: 'error', error: 'not_configured', message: 'x' });
  await sb.install(page);
  await signIn(page);
  await standardInterview(page, { pain: ['Lower back', 'Knees'], note: 'Back gets stiff after long drives', equipment: ['Barbell', 'Dumbbells', 'Bands'] });
  await expect(page.getByText(/I’ll leave out moves that load your lower back and knees/)).toBeVisible();
  await expect(page.getByText(/I’m not a physio or doctor — if pain is sharp, getting worse, or comes with numbness or tingling, please get it checked first\./).first()).toBeVisible();
  await page.getByRole('button', { name: 'Review my answers' }).click();
  await expect(page.getByText(/Bothering you: Lower back, Knees/)).toBeVisible();
  await page.getByRole('button', { name: /Generate my draft plan/ }).click();
  await expect(page.getByText('Two-day starter')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Accept plan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workout' })).toBeVisible();
  const ids = (await latestProgram(page)).days.flatMap((d) => d.exercises.map((e) => `${e.exercise_key}:${e.variant}`));
  expect(ids).not.toContain('squat:barbell'); // the scripted model proposed it; the validator removed it
  expect(ids.some((id) => ['bird_dog:bodyweight', 'dead_bug:bodyweight', 'glute_bridge:bodyweight', 'side_plank:bodyweight'].includes(id))).toBe(true);
  expect(ids.some((id) => ['glute_bridge:bodyweight', 'step_up:dumbbell', 'leg_curl:machine', 'hip_thrust:barbell'].includes(id))).toBe(true);
  expect(sb.profileOf(OWNER.id)).toMatchObject({ training: { pain_areas: ['lower_back', 'knees'], pain_note: 'Back gets stiff after long drives' } });
});

/** Onboard through the interview with AI help on but everything else skipped, then the standard plan. */
async function quickOnboard(page: Page) {
  await signIn(page);
  for (let i = 0; i < 20; i++) {
    if (await answers(page).getByRole('button', { name: 'Yes — back up and use AI help' }).count()) break;
    await answers(page).getByRole('button', { name: 'Skip for now' }).click();
  }
  await chip(page, 'Yes — back up and use AI help');
  await page.getByRole('button', { name: 'Review my answers' }).click();
  await page.getByRole('button', { name: /Start from a simple 2-day plan/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workout' })).toBeVisible();
}

test('week-1 question on Today: one a day, skippable, answered directly (never inferred)', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  await sb.install(page);
  await quickOnboard(page);
  await page.goto('/#/today');
  const card = page.getByRole('region', { name: 'A question from Luma' });
  await expect(card).toContainText('do you eat veg, egg, or non-veg?');
  await card.getByRole('button', { name: 'Veg', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'A question from Luma' })).toHaveCount(0); // only one a day
  await expect.poll(() => (sb.profileOf(OWNER.id) as { food_prefs: { pattern: string } } | null)?.food_prefs.pattern).toBe('vegetarian');
});

test('food plan: timeline reality check shows exactly once; diet draft totals match targets with real veg ids only', async ({ page }) => {
  const sb = new MockSupabase([OWNER]);
  sb.aiHandler = (op, b, caller, s) => (op === 'diet_draft' ? s.dietReply(caller, b) : { status: 'error', error: 'not_configured', message: 'x' });
  await sb.install(page);
  await quickOnboard(page);
  await page.goto('/#/diet');
  await expect(page.getByRole('heading', { name: 'Food plan' })).toBeVisible();
  await page.getByLabel('Weight (kg)').fill('92');
  await page.getByLabel('Height (cm)').fill('176');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByLabel('Age').fill('41');
  await page.getByRole('button', { name: 'Male', exact: true }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('group', { name: 'What you eat' }).getByRole('button', { name: 'Veg', exact: true }).click();
  await expect(page.getByTestId('diet-targets')).toContainText('Your body burns about');

  // An unsafe timeline (12 kg in 4 weeks) gets one kind reality check…
  await page.getByRole('button', { name: 'Add a goal' }).click();
  await page.getByLabel('Goal weight (kg)').fill('80');
  await page.getByLabel('In how many weeks?').fill('4');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Honest take: 12 kg in 4 weeks/)).toBeVisible();
  await expect(page.getByText(/A steadier 0.5–1 kg a week is what lasts/)).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  // …and never again, even for another unsafe timeline.
  await page.getByRole('button', { name: 'Change goal' }).click();
  await page.getByLabel('Goal weight (kg)').fill('78');
  await page.getByLabel('In how many weeks?').fill('3');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Goal: 78 kg in 3 weeks/)).toBeVisible();
  await expect(page.getByText(/Honest take/)).toHaveCount(0);
  await expect.poll(() => (sb.profileOf(OWNER.id) as { body: { timeline_checked: boolean } } | null)?.body.timeline_checked).toBe(true);

  await page.getByRole('button', { name: 'Draft my food plan' }).click();
  const totals = page.getByTestId('diet-totals');
  await expect(totals).toBeVisible({ timeout: 10_000 });
  expect(sb.aiCalls('diet_draft')).toHaveLength(1);
  const kcal = Number(await totals.getAttribute('data-kcal'));
  const target = Number(await totals.getAttribute('data-target-kcal'));
  expect(Math.abs(kcal - target)).toBeLessThanOrEqual(target * 0.1);
  const ids = await page.locator('[data-dish-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-dish-id')!));
  expect(ids.length).toBeGreaterThan(4);
  for (const id of ids) expect(SHELF.dishes.find((d) => d.id === id)?.diet).toBe('veg');
  await page.getByRole('button', { name: 'Accept food plan' }).click();
  await expect(page.getByRole('heading', { name: 'Your food plan' })).toBeVisible();
  await expect.poll(() => (sb.profileOf(OWNER.id) as { targets: { source: string; energy_kcal: number } | null } | null)?.targets?.source).toBe('diet_plan');
  expect((sb.profileOf(OWNER.id) as { targets: { energy_kcal: number } }).targets.energy_kcal).toBe(target);
  expect(sb.decided).toEqual([expect.objectContaining({ decision: 'accepted' })]);
});

/** Three finished workouts in the last week with reps to spare (what a person would have logged). */
async function seedGoodWeek(page: Page) {
  await page.evaluate(async (owner) => {
    const prog = await new Promise<{ id: string; version: number; days: { id: string; name: string; exercises: { id: string; exercise_key: string; name: string; variant: string; load_convention: string; unilateral: boolean; muscle_group: string; measurement: string; sets: { rep_min: number; rep_max: number }[] }[] }[] }>((resolve) => {
      const r = indexedDB.open(`rozana-journal-${owner}`);
      r.onsuccess = () => { const g = r.result.transaction('programs').objectStore('programs').getAll(); g.onsuccess = () => { resolve(g.result[0]); r.result.close(); }; };
    });
    const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const sessions = [2, 3, 5].map((n, k) => {
      const dd = prog.days[k % prog.days.length]!;
      const at = new Date(Date.now() - n * 864e5).toISOString();
      return {
        id: crypto.randomUUID(), owner_id: owner, local_version: 1, created_at: at, updated_at: at, deleted_at: null, synthetic: false,
        program_version_id: prog.id, program_version: prog.version, day_id: dd.id, day_name: dd.name, local_date: day(n), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        started_at: at, finished_at: at, status: 'finished',
        exercises: dd.exercises.map((e) => ({
          planned_exercise_id: e.id, exercise_key: e.exercise_key, name: e.name, variant: e.variant, load_convention: e.load_convention, unilateral: e.unilateral, muscle_group: e.muscle_group, measurement: e.measurement,
          sets: e.sets.map((s, i) => ({ id: crypto.randomUUID(), index: i, type: 'working', planned: s, draft: { reps: null, load: null }, actual: { reps: s.rep_max, load: 10, unit: 'kg', rir: 3, discomfort: false }, status: 'completed', completed_at: at, added: false })),
        })),
      };
    });
    await new Promise<void>((resolve) => {
      const r = indexedDB.open(`rozana-journal-${owner}`);
      r.onsuccess = () => { const tx = r.result.transaction('workout_sessions', 'readwrite'); for (const s of sessions) tx.objectStore('workout_sessions').put(s); tx.oncomplete = () => { r.result.close(); resolve(); }; };
    });
  }, OWNER.id);
}

async function adaptationReady(page: Page) {
  const sb = new MockSupabase([OWNER]);
  await sb.install(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Just set me up with a standard plan' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Workout' })).toBeVisible();
  await seedGoodWeek(page);
  await page.goto('/#/today');
  await page.reload();
  const card = page.getByTestId('adaptation');
  await expect(card).toContainText('You’re recovering well — add a set to pressing movements?');
  return card;
}

test('weekly adaptation: Accept saves a new plan version with one more pressing set', async ({ page }) => {
  const card = await adaptationReady(page);
  const before = await latestProgram(page);
  await card.getByRole('button', { name: 'Accept' }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await latestProgram(page)).version).toBe(before.version + 1);
  const after = await latestProgram(page);
  const sets = (p: Program, key: string) => p.days.flatMap((d) => d.exercises).filter((e) => e.exercise_key === key).map((e) => e.sets.length);
  expect(sets(after, 'bench_press')).toEqual(sets(before, 'bench_press').map((n) => n + 1));
  expect(sets(after, 'squat')).toEqual(sets(before, 'squat'));
  // Nothing more this week, in Coach either.
  await page.reload();
  await expect(page.getByTestId('adaptation')).toHaveCount(0);
});

test('weekly adaptation: Edit opens the plan editor with the change; saving there is the approval', async ({ page }) => {
  const card = await adaptationReady(page);
  const before = await latestProgram(page);
  await card.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit plan' })).toBeAttached();
  await page.getByRole('button', { name: /Save/ }).first().click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Save/ });
  if (await confirm.count()) await confirm.first().click();
  await expect.poll(async () => (await latestProgram(page)).version).toBe(before.version + 1);
  await page.goto('/#/today');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.getByTestId('adaptation')).toHaveCount(0);
});

test('weekly adaptation: Not now changes nothing and hides the proposal for this week', async ({ page }) => {
  const card = await adaptationReady(page);
  const before = await latestProgram(page);
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.getByTestId('adaptation')).toHaveCount(0);
  expect((await latestProgram(page)).version).toBe(before.version);
});
