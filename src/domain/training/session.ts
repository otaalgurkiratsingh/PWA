import type {
  ActualSet,
  LoadUnit,
  ProgramDay,
  ProgramVersion,
  SessionExercise,
  SessionSet,
  WorkoutSession,
} from '@shared/contracts';

export const KG_PER_LB = 0.45359237; // exact international avoirdupois definition

/** Convert a load for comparison/display. Stored values keep their entered unit. */
export function convertLoad(value: number, from: LoadUnit, to: LoadUnit): number {
  if (from === to) return value;
  return from === 'lb' ? value * KG_PER_LB : value / KG_PER_LB;
}

export function formatLoad(value: number, unit: LoadUnit): string {
  const v = Math.round(value * 10) / 10;
  return `${v} ${unit}`;
}

/** Key that defines "the same exercise" for comparisons: movement + equipment variant + load convention. */
export function comparableKey(e: Pick<SessionExercise, 'exercise_key' | 'variant' | 'load_convention' | 'unilateral'>): string {
  return `${e.exercise_key}|${e.variant}|${e.load_convention}|${e.unilateral ? 'uni' : 'bi'}`;
}

export interface NewSessionArgs {
  id: string;
  ownerId: string;
  program: ProgramVersion;
  day: ProgramDay;
  localDate: string;
  timezone: string;
  now: string;
  newId: () => string;
  /** Last comparable finished sessions, newest first, used to prefill drafts. */
  history: readonly WorkoutSession[];
  /** Unit the user enters loads in; drafts are converted into it. */
  unit: LoadUnit;
  synthetic: boolean;
}

function roundLoad(v: number, unit: LoadUnit): number {
  const step = unit === 'kg' ? 0.5 : 1;
  return Math.round(v / step) * step;
}

/**
 * Start a session from a program day. The prescription is snapshotted into each set.
 * Drafts are prefilled from the last comparable session (copy-last), but nothing is completed.
 */
export function startSession(a: NewSessionArgs): WorkoutSession {
  const exercises: SessionExercise[] = a.day.exercises.map((pe) => {
    const prev = lastComparable(a.history, comparableKey(pe));
    const prevByIndex = prev?.sets.filter((s) => s.status === 'completed') ?? [];
    const sets: SessionSet[] = pe.sets.map((ps, index) => {
      const p = prevByIndex.find((s) => s.index === index)?.actual ?? null;
      return {
        id: a.newId(),
        index,
        type: ps.type,
        planned: { ...ps },
        draft: {
          reps: p?.reps ?? ps.rep_max,
          load: p
            ? roundLoad(convertLoad(p.load, p.unit, a.unit), a.unit)
            : ps.target_load === null
              ? null
              : roundLoad(convertLoad(ps.target_load, ps.target_unit, a.unit), a.unit),
        },
        actual: null,
        status: 'pending',
        completed_at: null,
      };
    });
    return {
      planned_exercise_id: pe.id,
      exercise_key: pe.exercise_key,
      name: pe.name,
      variant: pe.variant,
      load_convention: pe.load_convention,
      unilateral: pe.unilateral,
      muscle_group: pe.muscle_group,
      sets,
    };
  });
  return {
    id: a.id,
    owner_id: a.ownerId,
    local_version: 0,
    created_at: a.now,
    updated_at: a.now,
    deleted_at: null,
    synthetic: a.synthetic,
    program_version_id: a.program.id,
    program_version: a.program.version,
    day_id: a.day.id,
    day_name: a.day.name,
    local_date: a.localDate,
    timezone: a.timezone,
    started_at: a.now,
    finished_at: null,
    status: 'active',
    exercises,
  };
}

function mapSet(s: WorkoutSession, setId: string, fn: (set: SessionSet) => SessionSet): WorkoutSession {
  let found = false;
  const exercises = s.exercises.map((e) => ({
    ...e,
    sets: e.sets.map((set) => {
      if (set.id !== setId) return set;
      found = true;
      return fn(set);
    }),
  }));
  if (!found) throw new Error(`Set ${setId} not in session`);
  return { ...s, exercises };
}

export function completeSet(s: WorkoutSession, setId: string, actual: ActualSet, now: string): WorkoutSession {
  if (s.status !== 'active') throw new Error('Session is finished; reopen it to edit');
  return mapSet(s, setId, (set) => ({
    ...set,
    actual: { ...actual },
    draft: { reps: actual.reps, load: actual.load },
    status: 'completed',
    completed_at: now,
  }));
}

/** Undo completion: performance is removed; the draft keeps the typed values. */
export function undoSet(s: WorkoutSession, setId: string): WorkoutSession {
  if (s.status !== 'active') throw new Error('Session is finished; reopen it to edit');
  return mapSet(s, setId, (set) => ({ ...set, actual: null, status: 'pending', completed_at: null }));
}

/** Skipped is distinct from a zero-rep completed set. */
export function skipSet(s: WorkoutSession, setId: string): WorkoutSession {
  if (s.status !== 'active') throw new Error('Session is finished; reopen it to edit');
  return mapSet(s, setId, (set) => ({ ...set, actual: null, status: 'skipped', completed_at: null }));
}

export function updateDraft(s: WorkoutSession, setId: string, draft: Partial<SessionSet['draft']>): WorkoutSession {
  return mapSet(s, setId, (set) => ({ ...set, draft: { ...set.draft, ...draft } }));
}

export function finishSession(s: WorkoutSession, now: string): WorkoutSession {
  return { ...s, status: 'finished', finished_at: now };
}

export function reopenSession(s: WorkoutSession): WorkoutSession {
  return { ...s, status: 'active', finished_at: null };
}

/** The most recent finished session containing an exercise with the given comparable key. */
export function lastComparable(history: readonly WorkoutSession[], key: string): SessionExercise | null {
  const sorted = [...history]
    .filter((h) => h.status === 'finished' && h.deleted_at === null)
    .sort((a, b) => (b.started_at < a.started_at ? -1 : b.started_at > a.started_at ? 1 : 0));
  for (const h of sorted) {
    const ex = h.exercises.find((e) => comparableKey(e) === key);
    if (ex && ex.sets.some((x) => x.status === 'completed')) return ex;
  }
  return null;
}

export interface WorkingSummary {
  completedWorkingSets: number;
  skippedSets: number;
  /** Descriptive only; never compared across unlike exercises. Null if no completed working sets. */
  volume: number | null;
  unit: LoadUnit;
  bestSet: ActualSet | null;
}

/** Working-set summary for one exercise. Warmups are excluded; skipped sets are not zero performance. */
export function workingSummary(e: SessionExercise, unit: LoadUnit): WorkingSummary {
  const working = e.sets.filter((s) => s.type === 'working');
  const done = working.filter((s) => s.status === 'completed' && s.actual);
  let volume: number | null = null;
  let best: ActualSet | null = null;
  for (const s of done) {
    const a = s.actual!;
    const load = convertLoad(a.load, a.unit, unit);
    volume = (volume ?? 0) + load * a.reps;
    if (!best || load > convertLoad(best.load, best.unit, unit) ||
        (load === convertLoad(best.load, best.unit, unit) && a.reps > best.reps)) best = a;
  }
  return {
    completedWorkingSets: done.length,
    skippedSets: e.sets.filter((s) => s.status === 'skipped').length,
    volume: volume === null ? null : Math.round(volume * 10) / 10,
    unit,
    bestSet: best,
  };
}

export const E1RM_FORMULA = { name: 'Epley', version: 1, minReps: 1, maxReps: 10 } as const;

/** Estimated 1RM (Epley v1). Labelled an estimate; null outside the supported rep range. */
export function estimateOneRepMax(load: number, reps: number): number | null {
  if (!(load > 0) || reps < E1RM_FORMULA.minReps || reps > E1RM_FORMULA.maxReps) return null;
  if (reps === 1) return load;
  return Math.round(load * (1 + reps / 30) * 10) / 10;
}

export function sessionProgress(s: WorkoutSession): { done: number; skipped: number; total: number } {
  const sets = s.exercises.flatMap((e) => e.sets);
  return {
    done: sets.filter((x) => x.status === 'completed').length,
    skipped: sets.filter((x) => x.status === 'skipped').length,
    total: sets.length,
  };
}

export function describePrescription(sets: readonly SessionSet['planned'][]): string {
  const working = sets.filter((s) => s.type === 'working');
  const warm = sets.length - working.length;
  const first = working[0];
  if (!first) return `${sets.length} sets`;
  const reps = first.rep_min === first.rep_max ? `${first.rep_min}` : `${first.rep_min}–${first.rep_max}`;
  const load = first.target_load ? ` @ ${formatLoad(first.target_load, first.target_unit)}` : '';
  return `${warm ? `${warm} warm-up + ` : ''}${working.length} × ${reps}${load}`;
}
