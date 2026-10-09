/**
 * Built-in strength exercise library (names and sensible defaults only — no health data).
 * `key` identifies the movement; equipment + load convention make a comparable variant.
 */
import type { Equipment, LoadConvention, Measurement, MuscleGroup } from '../contracts';

export interface LibraryExercise {
  key: string;
  name: string;
  equipment: Equipment;
  muscle_group: MuscleGroup;
  load_convention: LoadConvention;
  unilateral: boolean;
  measurement: Measurement;
}

const e = (
  key: string, name: string, equipment: Equipment, muscle_group: MuscleGroup,
  load_convention: LoadConvention = equipment === 'dumbbell' ? 'per_dumbbell' : equipment === 'bodyweight' ? 'bodyweight' : 'total',
  unilateral = false, measurement: Measurement = equipment === 'bodyweight' ? 'reps' : 'weight_reps',
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
];

export function searchLibrary(query: string, extra: readonly LibraryExercise[] = []): LibraryExercise[] {
  const q = query.trim().toLowerCase();
  const all = [...extra, ...EXERCISE_LIBRARY];
  if (!q) return all;
  return all.filter((x) => `${x.name} ${x.muscle_group} ${x.equipment}`.toLowerCase().includes(q));
}
