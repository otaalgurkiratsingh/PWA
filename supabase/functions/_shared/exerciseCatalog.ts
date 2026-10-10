/**
 * Built-in strength exercise catalogue (names and sensible defaults only — no health data).
 * Shared by the app and the `ai` Edge Function: AI plans may only use these ids.
 * `key` identifies the movement; equipment + load convention make a comparable variant.
 * `id` (`key:equipment`) is the stable identifier used in plan drafts.
 */
export type CatalogEquipment = 'barbell' | 'dumbbell' | 'cable' | 'machine' | 'bodyweight' | 'kettlebell' | 'band' | 'other';
export type CatalogMuscle = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core' | 'full';
export type CatalogLoad = 'total' | 'per_dumbbell' | 'per_side' | 'bodyweight';
export type CatalogMeasurement = 'weight_reps' | 'reps' | 'duration';

export interface LibraryExercise {
  key: string;
  name: string;
  equipment: CatalogEquipment;
  muscle_group: CatalogMuscle;
  load_convention: CatalogLoad;
  unilateral: boolean;
  measurement: CatalogMeasurement;
}

const e = (
  key: string, name: string, equipment: CatalogEquipment, muscle_group: CatalogMuscle,
  load_convention: CatalogLoad = equipment === 'dumbbell' ? 'per_dumbbell' : equipment === 'bodyweight' ? 'bodyweight' : 'total',
  unilateral = false, measurement: CatalogMeasurement = equipment === 'bodyweight' ? 'reps' : 'weight_reps',
): LibraryExercise => ({ key, name, equipment, muscle_group, load_convention, unilateral, measurement });

export const EXERCISE_LIBRARY: readonly LibraryExercise[] = [
  e('bench_press', 'Bench press', 'barbell', 'chest'),
  e('bench_press', 'Dumbbell bench press', 'dumbbell', 'chest'),
  e('incline_press', 'Incline dumbbell press', 'dumbbell', 'chest'),
  e('chest_press', 'Chest press machine', 'machine', 'chest'),
  e('push_up', 'Push-up', 'bodyweight', 'chest'),
  e('cable_fly', 'Cable fly', 'cable', 'chest'),
  e('overhead_press', 'Overhead press', 'barbell', 'shoulders'),
  e('overhead_press', 'Dumbbell shoulder press', 'dumbbell', 'shoulders'),
  e('lateral_raise', 'Lateral raise', 'dumbbell', 'shoulders'),
  e('face_pull', 'Face pull', 'cable', 'shoulders'),
  e('pull_up', 'Pull-up', 'bodyweight', 'back'),
  e('lat_pulldown', 'Lat pulldown', 'cable', 'back'),
  e('row', 'Seated cable row', 'cable', 'back'),
  e('barbell_row', 'Barbell row', 'barbell', 'back'),
  e('one_arm_row', 'One-arm dumbbell row', 'dumbbell', 'back', 'per_dumbbell', true),
  e('deadlift', 'Deadlift', 'barbell', 'back'),
  e('squat', 'Back squat', 'barbell', 'legs'),
  e('goblet_squat', 'Goblet squat', 'dumbbell', 'legs', 'total'),
  e('leg_press', 'Leg press', 'machine', 'legs'),
  e('romanian_deadlift', 'Romanian deadlift', 'barbell', 'legs'),
  e('split_squat', 'Split squat', 'dumbbell', 'legs', 'per_dumbbell', true),
  e('lunge', 'Walking lunge', 'dumbbell', 'legs', 'per_dumbbell', true),
  e('leg_curl', 'Leg curl', 'machine', 'legs'),
  e('leg_extension', 'Leg extension', 'machine', 'legs'),
  e('calf_raise', 'Calf raise', 'machine', 'legs'),
  e('hip_thrust', 'Hip thrust', 'barbell', 'legs'),
  e('curl', 'Dumbbell curl', 'dumbbell', 'arms'),
  e('barbell_curl', 'Barbell curl', 'barbell', 'arms'),
  e('hammer_curl', 'Hammer curl', 'dumbbell', 'arms'),
  e('triceps_pushdown', 'Triceps pushdown', 'cable', 'arms'),
  e('dips', 'Dips', 'bodyweight', 'arms'),
  e('skull_crusher', 'Skull crusher', 'barbell', 'arms'),
  e('plank', 'Plank', 'bodyweight', 'core', 'bodyweight', false, 'duration'),
  e('hanging_leg_raise', 'Hanging leg raise', 'bodyweight', 'core'),
  e('cable_crunch', 'Cable crunch', 'cable', 'core'),
  e('kettlebell_swing', 'Kettlebell swing', 'kettlebell', 'full'),
  // Home and band options (added 2026-10-10 so home plans have enough allowed moves).
  e('bodyweight_squat', 'Bodyweight squat', 'bodyweight', 'legs'),
  e('glute_bridge', 'Glute bridge', 'bodyweight', 'legs'),
  e('reverse_lunge', 'Reverse lunge', 'bodyweight', 'legs', 'bodyweight', true),
  e('step_up', 'Dumbbell step-up', 'dumbbell', 'legs', 'per_dumbbell', true),
  e('romanian_deadlift', 'Dumbbell Romanian deadlift', 'dumbbell', 'legs'),
  e('goblet_squat', 'Kettlebell goblet squat', 'kettlebell', 'legs', 'total'),
  e('incline_push_up', 'Incline push-up', 'bodyweight', 'chest'),
  e('band_row', 'Band row', 'band', 'back', 'bodyweight', false, 'reps'),
  e('band_pull_apart', 'Band pull-apart', 'band', 'shoulders', 'bodyweight', false, 'reps'),
  e('band_chest_press', 'Band chest press', 'band', 'chest', 'bodyweight', false, 'reps'),
  e('dead_bug', 'Dead bug', 'bodyweight', 'core', 'bodyweight', false, 'reps'),
  e('bird_dog', 'Bird dog', 'bodyweight', 'core', 'bodyweight', true, 'reps'),
  e('side_plank', 'Side plank', 'bodyweight', 'core', 'bodyweight', true, 'duration'),
];


export const exerciseId = (x: Pick<LibraryExercise, 'key' | 'equipment'>): string => `${x.key}:${x.equipment}`;
