/**
 * SYNTHETIC DEMO FIXTURES.
 *
 * Every nutrient number below is a round placeholder chosen for demonstrating the
 * calculations. They are NOT verified nutrition data and must be replaced by the owner's
 * label data, USDA FoodData Central records, or confirmed recipes before real use.
 * Profiles, targets, and the workout plan are fictional as well.
 */
import type {
  FoodVersion,
  LocalProfile,
  MealPreset,
  Nutrients,
  PreparationState,
  ProgramVersion,
  RecipeRevision,
} from '../contracts';
import { fixtureId } from './ids';

const T0 = '2026-01-01T00:00:00.000Z';
const SYN_SOURCE = {
  kind: 'synthetic_demo' as const,
  ref: null,
  version: 'demo-fixtures-v1',
  license: null,
  note: 'Synthetic placeholder value — not real nutrition data.',
};

export const DEMO_PROFILES: readonly LocalProfile[] = [
  {
    id: 'demo-a',
    nickname: 'Demo A',
    units: 'kg',
    timezone: 'UTC', // replaced at runtime with the device timezone
    goal: 'consistency',
    targets: { energy_kcal: 2200, protein_g: 140, source: 'Demo target' },
    synthetic: true,
    adult_confirmed: true,
    height_cm: null,
    consent: { cloud_backup: false, ai_processing: false, updated_at: null },
    onboarded_at: '2026-01-01T00:00:00.000Z',
    updated_at: null,
  },
  {
    id: 'demo-b',
    nickname: 'Demo B',
    units: 'lb',
    timezone: 'UTC',
    goal: 'strength',
    targets: null, // demonstrates journaling without any target
    synthetic: true,
    adult_confirmed: true,
    height_cm: null,
    consent: { cloud_backup: false, ai_processing: false, updated_at: null },
    onboarded_at: '2026-01-01T00:00:00.000Z',
    updated_at: null,
  },
];

function base(owner: string, id: string) {
  return { id, owner_id: owner, local_version: 1, created_at: T0, updated_at: T0, deleted_at: null, synthetic: true };
}

const N = (energy_kcal: number | null, protein_g: number | null, carbs_g: number | null, fat_g: number | null, fiber_g: number | null): Nutrients => ({
  energy_kcal, protein_g, carbs_g, fat_g, fiber_g,
});

interface FoodDef {
  key: string;
  name: string;
  state: PreparationState;
  per: Nutrients;
  kind?: FoodVersion['source']['kind'];
  note?: string;
}
const FOOD_DEFS: FoodDef[] = [
  { key: 'roti', name: 'Roti (cooked)', state: 'cooked', per: N(300, 10, 55, 4, 8) },
  { key: 'toor_dal_dry', name: 'Toor dal (dry)', state: 'dry', per: N(340, 22, 60, 1.5, 15) },
  { key: 'oil', name: 'Cooking oil', state: 'as_sold', per: N(900, 0, 0, 100, 0) },
  { key: 'ghee', name: 'Ghee', state: 'as_sold', per: N(900, 0, 0, 100, 0) },
  { key: 'onion', name: 'Onion (raw)', state: 'raw', per: N(40, 1, 9, 0, 2) },
  { key: 'tomato', name: 'Tomato (raw)', state: 'raw', per: N(20, 1, 4, 0, 1) },
  { key: 'dahi', name: 'Dahi (plain)', state: 'as_sold', per: N(60, 3.5, 4.5, 3.5, 0) },
  { key: 'milk', name: 'Milk', state: 'as_sold', per: N(60, 3.2, 4.8, 3.2, 0) },
  { key: 'sugar', name: 'Sugar', state: 'as_sold', per: N(400, 0, 100, 0, 0) },
  { key: 'egg', name: 'Egg (boiled)', state: 'cooked', per: N(155, 13, 1, 11, 0) },
  { key: 'paneer', name: 'Paneer', state: 'as_sold', per: N(300, 18, 4, 24, 0) },
  { key: 'rice', name: 'Rice (cooked)', state: 'cooked', per: N(130, 2.5, 28, 0.3, 0.4) },
  { key: 'chicken', name: 'Chicken (raw, boneless)', state: 'raw', per: N(120, 22, 0, 3, 0) },
  { key: 'whey', name: 'Whey powder', state: 'as_sold', per: N(400, 80, 8, 6, 0) },
  {
    key: 'sabzi_unknown',
    name: 'Mixed sabzi (recipe not recorded)',
    state: 'cooked',
    per: N(null, null, null, null, null),
    kind: 'unknown',
    note: 'Recipe unknown — nutrition stays unknown until the recipe is recorded.',
  },
];

export function demoFoods(owner: string): FoodVersion[] {
  return FOOD_DEFS.map((f) => ({
    ...base(owner, fixtureId(`food:${f.key}`)),
    food_id: fixtureId(`food-root:${f.key}`),
    revision: 1,
    name: f.name,
    preparation_state: f.state,
    per_100g: f.per,
    source: f.kind ? { ...SYN_SOURCE, kind: f.kind, note: f.note ?? null } : SYN_SOURCE,
    assumptions: f.kind === 'unknown' ? [] : ['Synthetic demo value'],
  }));
}

const fid = (k: string) => fixtureId(`food:${k}`);

export function demoRecipes(owner: string): RecipeRevision[] {
  const r = (key: string, name: string, ings: [string, number, PreparationState][], yieldG: number, assumptions: string[]): RecipeRevision => ({
    ...base(owner, fixtureId(`recipe:${key}:1`)),
    recipe_id: fixtureId(`recipe-root:${key}`),
    revision: 1,
    name,
    ingredients: ings.map(([k, g, state]) => ({ food_version_id: fid(k), grams: g, state })),
    batch_cooked_edible_yield_g: yieldG,
    assumptions,
  });
  return [
    r('dal', 'Toor dal (home batch)', [['toor_dal_dry', 200, 'dry'], ['oil', 15, 'as_sold'], ['onion', 100, 'raw'], ['tomato', 100, 'raw']], 900,
      ['Tadka oil counted once at batch level', 'Water added during cooking is included in the cooked yield']),
    r('chai', 'Chai (home)', [['milk', 150, 'as_sold'], ['sugar', 10, 'as_sold']], 200,
      ['Tea leaves and water not counted', 'Sugar per batch as recorded']),
    r('paneer_bhurji', 'Paneer bhurji', [['paneer', 200, 'as_sold'], ['oil', 10, 'as_sold'], ['onion', 80, 'raw']], 300,
      ['Oil counted once at batch level']),
    r('chicken_curry', 'Chicken curry', [['chicken', 500, 'raw'], ['oil', 30, 'as_sold'], ['onion', 150, 'raw'], ['tomato', 150, 'raw']], 800,
      ['Oil left in the pan is assumed eaten (not discarded)', 'Bones excluded; boneless chicken']),
  ];
}
const rid = (k: string) => fixtureId(`recipe:${k}:1`);

export function demoPresets(owner: string): MealPreset[] {
  const p = (key: string, name: string, icon: MealPreset['icon'], step: number, items: MealPreset['items'], favorite = false): MealPreset => ({
    ...base(owner, fixtureId(`preset:${key}`)),
    name,
    icon,
    quantity_step: step,
    items,
    favorite,
    photo: null,
  });
  return [
    p('roti', 'Roti', 'roti', 1, [{ kind: 'food', food_version_id: fid('roti'), unit_label: 'roti', grams_per_unit: 40, default_quantity: 2 }], true),
    p('dal', 'Dal', 'dal', 0.5, [{ kind: 'recipe', recipe_revision_id: rid('dal'), unit_label: 'bowl', grams_per_unit: 180, default_quantity: 1 }], true),
    p('chai', 'Chai', 'chai', 1, [{ kind: 'recipe', recipe_revision_id: rid('chai'), unit_label: 'cup', grams_per_unit: 150, default_quantity: 1 }], true),
    p('eggs', 'Boiled eggs', 'egg', 1, [{ kind: 'food', food_version_id: fid('egg'), unit_label: 'egg', grams_per_unit: 50, default_quantity: 2 }], true),
    p('dahi', 'Dahi', 'dahi', 0.5, [{ kind: 'food', food_version_id: fid('dahi'), unit_label: 'bowl', grams_per_unit: 150, default_quantity: 1 }]),
    p('rice', 'Rice', 'rice', 0.5, [{ kind: 'food', food_version_id: fid('rice'), unit_label: 'bowl', grams_per_unit: 150, default_quantity: 1 }]),
    p('paneer', 'Paneer bhurji', 'paneer', 0.5, [{ kind: 'recipe', recipe_revision_id: rid('paneer_bhurji'), unit_label: 'serving', grams_per_unit: 150, default_quantity: 1 }]),
    p('chicken', 'Chicken curry', 'curry', 0.5, [{ kind: 'recipe', recipe_revision_id: rid('chicken_curry'), unit_label: 'bowl', grams_per_unit: 200, default_quantity: 1 }]),
    p('whey', 'Whey shake', 'shake', 1, [{ kind: 'food', food_version_id: fid('whey'), unit_label: 'scoop', grams_per_unit: 30, default_quantity: 1 }]),
    p('sabzi', 'Sabzi', 'sabzi', 0.5, [{ kind: 'food', food_version_id: fid('sabzi_unknown'), unit_label: 'bowl', grams_per_unit: 150, default_quantity: 1 }]),
    p('ghee', 'Ghee on roti', 'ghee', 1, [{ kind: 'food', food_version_id: fid('ghee'), unit_label: 'tsp', grams_per_unit: 5, default_quantity: 1 }]),
  ];
}

/** Ordered keys of the presets the demo "usual day" is built from. */
export const DEMO_DAY_PLAN: { slot: 'breakfast' | 'lunch' | 'dinner' | 'snack'; preset: string; hour: number }[] = [
  { slot: 'breakfast', preset: 'eggs', hour: 8 },
  { slot: 'breakfast', preset: 'chai', hour: 8 },
  { slot: 'lunch', preset: 'roti', hour: 13 },
  { slot: 'lunch', preset: 'dal', hour: 13 },
  { slot: 'lunch', preset: 'dahi', hour: 13 },
  { slot: 'snack', preset: 'whey', hour: 17 },
  { slot: 'dinner', preset: 'rice', hour: 20 },
  { slot: 'dinner', preset: 'chicken', hour: 20 },
];

export function demoProgram(owner: string): ProgramVersion {
  const ex = (key: string, name: string, variant: string, conv: ProgramVersion['days'][number]['exercises'][number]['load_convention'],
    group: ProgramVersion['days'][number]['muscle_groups'][number], warm: number | null, load: number | null, repMin: number, repMax: number, sets: number, rest: number, unilateral = false) => ({
    id: fixtureId(`pe:${key}:${variant}`),
    exercise_key: key,
    name,
    variant,
    load_convention: conv,
    unilateral,
    muscle_group: group,
    measurement: (conv === 'bodyweight' ? (key === 'plank' ? 'duration' : 'reps') : 'weight_reps') as 'weight_reps' | 'reps' | 'duration',
    sets: [
      ...(warm !== null ? [{ type: 'warmup' as const, rep_min: 10, rep_max: 10, target_load: warm || null, target_unit: 'kg' as const, rest_seconds: 60, rir_target: null }] : []),
      ...Array.from({ length: sets }, () => ({ type: 'working' as const, rep_min: repMin, rep_max: repMax, target_load: load, target_unit: 'kg' as const, rest_seconds: rest, rir_target: 2 })),
    ],
  });
  return {
    ...base(owner, fixtureId('program:demo:v1')),
    program_id: fixtureId('program:demo'),
    version: 1,
    name: 'Demo plan',
    schedule: 'rotation',
    days: [
      {
        id: fixtureId('day:push'), name: 'Push', weekday: null, muscle_groups: ['chest', 'shoulders', 'arms'],
        exercises: [
          ex('bench_press', 'Bench press', 'barbell', 'total', 'chest', 20, 50, 6, 8, 3, 120),
          ex('overhead_press', 'Overhead press', 'dumbbell', 'per_dumbbell', 'shoulders', null, 14, 8, 10, 3, 90),
          ex('triceps_pushdown', 'Triceps pushdown', 'cable', 'total', 'arms', null, 20, 10, 12, 2, 60),
        ],
      },
      {
        id: fixtureId('day:pull'), name: 'Pull', weekday: null, muscle_groups: ['back', 'arms'],
        exercises: [
          ex('pull_up', 'Pull-up', 'bodyweight', 'bodyweight', 'back', null, null, 5, 8, 3, 120),
          ex('row', 'Seated cable row', 'cable', 'total', 'back', null, 45, 8, 10, 3, 90),
          ex('curl', 'Dumbbell curl', 'dumbbell', 'per_dumbbell', 'arms', null, 10, 10, 12, 2, 60),
        ],
      },
      {
        id: fixtureId('day:legs'), name: 'Legs', weekday: null, muscle_groups: ['legs', 'core'],
        exercises: [
          ex('squat', 'Back squat', 'barbell', 'total', 'legs', 20, 70, 5, 8, 3, 150),
          ex('split_squat', 'Split squat', 'dumbbell', 'per_dumbbell', 'legs', null, 12, 8, 10, 2, 90, true),
          ex('plank', 'Plank', 'bodyweight', 'bodyweight', 'core', null, null, 30, 45, 2, 60),
        ],
      },
    ],
  };
}
