import { z } from 'zod';
import { AggregateBase, Id, Instant, LoadUnit, LocalDate, PositiveQty, TimeZone } from './common';

export const SetType = z.enum(['warmup', 'working']);
export type SetType = z.infer<typeof SetType>;

/**
 * How a recorded load is measured. Comparisons are only made within the same convention.
 * - total: barbell/machine total load
 * - per_dumbbell: weight of ONE dumbbell (pair implied for bilateral moves)
 * - per_side: plates added to each side (bar weight excluded)
 * - bodyweight: no external load; load field records added load (0 allowed)
 */
export const LoadConvention = z.enum(['total', 'per_dumbbell', 'per_side', 'bodyweight']);
export type LoadConvention = z.infer<typeof LoadConvention>;

export const MuscleGroup = z.enum(['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'full']);
export type MuscleGroup = z.infer<typeof MuscleGroup>;

/** What a set records. Only strength-style measurements are supported in this release. */
export const Measurement = z.enum(['weight_reps', 'reps', 'duration']);
export type Measurement = z.infer<typeof Measurement>;

/** Equipment drives the exercise illustration and sensible load increments. */
export const Equipment = z.enum(['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell', 'band', 'other']);
export type Equipment = z.infer<typeof Equipment>;

export const PrescribedSet = z
  .object({
    type: SetType,
    rep_min: z.number().int().positive(),
    rep_max: z.number().int().positive(),
    target_load: PositiveQty.nullable(),
    target_unit: LoadUnit,
    rest_seconds: z.number().int().nonnegative().max(900),
    rir_target: z.number().int().min(0).max(5).nullable(),
  })
  .refine((s) => s.rep_max >= s.rep_min, 'rep_max must be >= rep_min');
export type PrescribedSet = z.infer<typeof PrescribedSet>;

export const PlannedExercise = z.object({
  id: Id,
  exercise_key: z.string().min(1).max(60),
  name: z.string().min(1).max(80),
  /** Equipment variant, e.g. "barbell", "dumbbell", "machine". */
  variant: z.string().min(1).max(40),
  load_convention: LoadConvention,
  unilateral: z.boolean(),
  muscle_group: MuscleGroup,
  measurement: Measurement.default('weight_reps'),
  sets: z.array(PrescribedSet).min(1),
});
export type PlannedExercise = z.infer<typeof PlannedExercise>;

export const ProgramDay = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  muscle_groups: z.array(MuscleGroup),
  /** Optional weekday (0 = Sunday … 6 = Saturday) when the plan follows weekdays. */
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  exercises: z.array(PlannedExercise).min(1),
});
export type ProgramDay = z.infer<typeof ProgramDay>;

/** Immutable program version. Plan changes create a new version. */
export const ProgramVersion = AggregateBase.extend({
  program_id: Id,
  version: z.number().int().positive(),
  name: z.string().min(1).max(60),
  /** 'rotation' = next day in order after the last workout; 'weekdays' = by assigned weekday. */
  schedule: z.enum(['rotation', 'weekdays']).default('rotation'),
  days: z.array(ProgramDay).min(1),
});
export type ProgramVersion = z.infer<typeof ProgramVersion>;

export const SetStatus = z.enum(['pending', 'completed', 'skipped']);
export type SetStatus = z.infer<typeof SetStatus>;

export const ActualSet = z.object({
  reps: z.number().int().nonnegative().max(200),
  load: z.number().finite().nonnegative().max(1000),
  unit: LoadUnit,
  rir: z.number().int().min(0).max(10).nullable(),
  discomfort: z.boolean(),
});
export type ActualSet = z.infer<typeof ActualSet>;

export const SessionSet = z.object({
  id: Id,
  index: z.number().int().nonnegative(),
  type: SetType,
  /** Copied from the prescription at session start. Never mutated by logging. */
  planned: PrescribedSet,
  /** Editable draft values shown in inputs; not performance until completed. */
  draft: z.object({ reps: z.number().int().nonnegative().nullable(), load: z.number().nonnegative().nullable() }),
  /** Recorded performance; present only when status === 'completed'. */
  actual: ActualSet.nullable(),
  status: SetStatus,
  completed_at: Instant.nullable(),
  /** True when the set was added during the workout (not part of the plan). */
  added: z.boolean().default(false),
});
export type SessionSet = z.infer<typeof SessionSet>;

export const SessionExercise = z.object({
  planned_exercise_id: Id,
  exercise_key: z.string(),
  name: z.string(),
  variant: z.string(),
  load_convention: LoadConvention,
  unilateral: z.boolean(),
  muscle_group: MuscleGroup,
  measurement: Measurement.default('weight_reps'),
  sets: z.array(SessionSet).min(1),
});
export type SessionExercise = z.infer<typeof SessionExercise>;

export const WorkoutSession = AggregateBase.extend({
  program_version_id: Id,
  program_version: z.number().int().positive(),
  day_id: Id,
  day_name: z.string(),
  local_date: LocalDate,
  timezone: TimeZone,
  started_at: Instant,
  finished_at: Instant.nullable(),
  status: z.enum(['active', 'finished']),
  exercises: z.array(SessionExercise).min(1),
});
export type WorkoutSession = z.infer<typeof WorkoutSession>;

/** Rest timer persisted as an absolute end timestamp so it survives reloads/backgrounding. */
export const RestTimer = z.object({
  session_id: Id,
  set_id: Id,
  ends_at_ms: z.number().int().positive(),
  duration_seconds: z.number().int().positive(),
});
export type RestTimer = z.infer<typeof RestTimer>;

/** Owner-created exercise definition (library entries are built in and not stored). */
export const ExerciseDefinition = AggregateBase.extend({
  key: z.string().min(1).max(60),
  name: z.string().min(1).max(60),
  equipment: Equipment,
  muscle_group: MuscleGroup,
  load_convention: LoadConvention,
  unilateral: z.boolean(),
  measurement: Measurement,
});
export type ExerciseDefinition = z.infer<typeof ExerciseDefinition>;
