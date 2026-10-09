import { PROFILE_DOC_ID, type DailyHealthSummary, type DailyLogStatus, type LocalProfile, type MealEntry, type WeightEntry, type WorkoutSession } from '@shared/contracts';
import { DEMO_DAY_PLAN, DEMO_PROFILES, demoFoods, demoPresets, demoProgram, demoRecipes } from '@shared/fixtures/demo';
import { fixtureId } from '@shared/fixtures/ids';
import { snapshotPreset } from '@/domain/nutrition/calc';
import { addDays } from '@/domain/metrics/metrics';
import { completeSet, finishSession, skipSet, startSession } from '@/domain/training/session';
import type { Journal } from './journal';

/** Small deterministic PRNG so the demo history is identical on every device. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED_VERSION = 2;
const T_SEED = '2026-01-01T00:00:00.000Z';

/**
 * Seed the synthetic demo profile, library, and ~5 weeks of synthetic history.
 * History is written directly (not via the outbox) because synthetic records are never synced.
 * Today is left mostly empty so the owner can try logging.
 */
export async function seedDemoIfEmpty(journal: Journal, profileId: string, today: string, timezone: string): Promise<boolean> {
  if ((await journal.getMeta<number>('seed_version')) === SEED_VERSION) return false;
  const template = DEMO_PROFILES.find((p) => p.id === profileId);
  if (!template) throw new Error(`Unknown demo profile ${profileId}`);
  const profile: LocalProfile = { ...template, timezone };
  const owner = profile.id;
  const foods = demoFoods(owner);
  const recipes = demoRecipes(owner);
  const presets = demoPresets(owner);
  const program = demoProgram(owner);
  const lib = { foods: new Map(foods.map((f) => [f.id, f])), recipes: new Map(recipes.map((r) => [r.id, r])) };
  const presetByKey = new Map(presets.map((p) => [p.id, p]));
  const rand = mulberry32(profileId === 'demo-a' ? 42 : 7);
  let idCounter = 0;
  const newId = () => fixtureId(`${owner}:gen:${idCounter++}`);

  const meals: MealEntry[] = [];
  const weights: WeightEntry[] = [];
  const health: DailyHealthSummary[] = [];
  const statuses: DailyLogStatus[] = [];
  const sessions: WorkoutSession[] = [];

  const HISTORY_DAYS = 35;
  let weight = profile.units === 'kg' ? 82 : 181;
  let dayIdx = 0;
  for (let i = HISTORY_DAYS; i >= 1; i--) {
    const date = addDays(today, -i);
    const at = (h: number, m = 0) => `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
    const stamp = { owner_id: owner, local_version: 1, created_at: at(21), updated_at: at(21), deleted_at: null, synthetic: true };

    // Meals: some days unlogged entirely, some partially.
    const r = rand();
    if (r > 0.15) {
      const partial = r < 0.35;
      for (const plan of DEMO_DAY_PLAN) {
        if (partial && plan.slot === 'dinner') continue;
        const preset = presetByKey.get(fixtureId(`preset:${plan.preset}`))!;
        const mult = rand() < 0.2 ? 1.5 : 1;
        meals.push({
          ...stamp,
          id: newId(),
          preset_id: preset.id,
          name: preset.name,
          icon: preset.icon,
          slot: plan.slot,
          local_date: date,
          timezone,
          logged_at: at(plan.hour, Math.floor(rand() * 50)),
          quantity: mult,
          items: snapshotPreset(preset, mult, lib),
        });
      }
      if (!partial && rand() < 0.6) statuses.push({ local_date: date, owner_id: owner, intake_complete: true, updated_at: at(22) });
    }

    // Weight: roughly every other day, gentle synthetic drift with noise.
    weight += (profile.units === 'kg' ? -0.04 : -0.09) + (rand() - 0.5) * (profile.units === 'kg' ? 0.5 : 1.1);
    if (rand() < 0.55) {
      weights.push({ ...stamp, id: newId(), local_date: date, timezone, measured_at: at(7), value: Math.round(weight * 10) / 10, unit: profile.units });
    }

    // Steps: manual entries on most days; missing days remain missing.
    if (rand() < 0.7) {
      health.push({
        id: `steps:${date}`, owner_id: owner, metric: 'steps', local_date: date, timezone,
        value: Math.round(4000 + rand() * 8000), source: 'manual', recorded_at: at(21), synthetic: true,
      });
    }

    // Workouts every ~2 days, rotating Push/Pull/Legs, with small synthetic progressions.
    if (i % 2 === 0) {
      const day = program.days[dayIdx % program.days.length]!;
      dayIdx++;
      let s = startSession({ id: newId(), ownerId: owner, program, day, localDate: date, timezone, now: at(18), newId, history: sessions, unit: profile.units, synthetic: true });
      let minute = 0;
      for (const ex of s.exercises) {
        for (const set of ex.sets) {
          minute += 3;
          if (rand() < 0.05) {
            s = skipSet(s, set.id);
            continue;
          }
          const p = set.planned;
          const baseLoad = p.target_load ?? 0; // fixture targets are in kg
          const progress = Math.floor((HISTORY_DAYS - i) / 10) * (ex.load_convention === 'per_dumbbell' ? 1 : 2.5);
          const load = ex.load_convention === 'bodyweight' ? 0 : set.type === 'warmup' ? baseLoad : baseLoad + progress;
          const reps = p.rep_min + Math.floor(rand() * (p.rep_max - p.rep_min + 1));
          s = completeSet(s, set.id, {
            reps,
            load: profile.units === 'lb' && load ? Math.round(load * 2.2 / 2.5) * 2.5 : load,
            unit: profile.units === 'lb' && load ? 'lb' : 'kg',
            rir: set.type === 'working' ? 1 + Math.floor(rand() * 3) : null,
            discomfort: false,
          }, at(18, Math.min(minute, 59)));
        }
      }
      sessions.push(finishSession(s, at(19, 10)));
    }
  }

  const tx = journal.db.transaction(
    ['meta', 'settings', 'foods', 'recipes', 'presets', 'programs', 'meal_entries', 'weight_entries', 'daily_health', 'daily_log_status', 'workout_sessions'],
    'readwrite',
  );
  await Promise.all([
    ...foods.map((f) => tx.objectStore('foods').put(f)),
    ...recipes.map((r) => tx.objectStore('recipes').put(r)),
    ...presets.map((p) => tx.objectStore('presets').put(p)),
    tx.objectStore('programs').put(program),
    ...meals.map((m) => tx.objectStore('meal_entries').put(m)),
    ...weights.map((w) => tx.objectStore('weight_entries').put(w)),
    ...health.map((h) => tx.objectStore('daily_health').put(h)),
    ...statuses.map((s) => tx.objectStore('daily_log_status').put(s)),
    ...sessions.map((s) => tx.objectStore('workout_sessions').put(s)),
    tx.objectStore('settings').put({
      id: PROFILE_DOC_ID, owner_id: owner, local_version: 1, created_at: T_SEED, updated_at: T_SEED, deleted_at: null, synthetic: true, profile,
    }),
    tx.objectStore('meta').put(SEED_VERSION, 'seed_version'),
  ]);
  await tx.done;
  return true;
}
