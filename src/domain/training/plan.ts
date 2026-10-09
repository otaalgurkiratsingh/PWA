/**
 * Pure plan-editing operations. The editor works on a mutable-looking draft, but every function
 * returns a new object. Saving produces a NEW immutable ProgramVersion; old sessions keep their
 * own prescription snapshots, so editing never rewrites history.
 */
import type {
  LoadUnit,
  PlannedExercise,
  PrescribedSet,
  ProgramDay,
  ProgramVersion,
  WorkoutSession,
} from '@shared/contracts';
import type { LibraryExercise } from '@shared/fixtures/exerciseLibrary';

export type PlanDraft = Pick<ProgramVersion, 'name' | 'schedule' | 'days'>;

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function draftFrom(p: ProgramVersion | null | undefined): PlanDraft {
  if (!p) return { name: 'My plan', schedule: 'rotation', days: [] };
  return structuredClone({ name: p.name, schedule: p.schedule ?? 'rotation', days: p.days.map((d) => ({ ...d, weekday: d.weekday ?? null })) });
}

const mapDay = (d: PlanDraft, dayId: string, fn: (day: ProgramDay) => ProgramDay): PlanDraft => ({
  ...d,
  days: d.days.map((day) => (day.id === dayId ? fn(day) : day)),
});

function move<T>(arr: readonly T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || to < 0 || to >= arr.length) return [...arr];
  const out = [...arr];
  const [item] = out.splice(index, 1);
  out.splice(to, 0, item!);
  return out;
}

function muscleGroupsOf(exs: readonly PlannedExercise[]): ProgramDay['muscle_groups'] {
  return [...new Set(exs.map((e) => e.muscle_group))];
}

const withExercises = (day: ProgramDay, exercises: PlannedExercise[]): ProgramDay => ({
  ...day,
  exercises,
  muscle_groups: muscleGroupsOf(exercises),
});

// ---- days ---------------------------------------------------------------------
export function addDay(d: PlanDraft, name: string, newId: () => string): PlanDraft {
  const day: ProgramDay = { id: newId(), name: name.trim() || `Day ${d.days.length + 1}`, muscle_groups: [], weekday: null, exercises: [] };
  return { ...d, days: [...d.days, day] };
}
export const renameDay = (d: PlanDraft, dayId: string, name: string) => mapDay(d, dayId, (day) => ({ ...day, name: name.slice(0, 60) }));
export const moveDay = (d: PlanDraft, dayId: string, delta: number): PlanDraft => ({
  ...d,
  days: move(d.days, d.days.findIndex((x) => x.id === dayId), delta),
});
export function duplicateDay(d: PlanDraft, dayId: string, newId: () => string): PlanDraft {
  const i = d.days.findIndex((x) => x.id === dayId);
  const src = d.days[i];
  if (!src) return d;
  const copy: ProgramDay = {
    ...structuredClone(src),
    id: newId(),
    name: `${src.name} copy`.slice(0, 60),
    weekday: null,
    exercises: src.exercises.map((e) => ({ ...structuredClone(e), id: newId() })),
  };
  const days = [...d.days];
  days.splice(i + 1, 0, copy);
  return { ...d, days };
}
export const removeDay = (d: PlanDraft, dayId: string): PlanDraft => ({ ...d, days: d.days.filter((x) => x.id !== dayId) });
export const setWeekday = (d: PlanDraft, dayId: string, weekday: number | null): PlanDraft =>
  mapDay(d, dayId, (day) => ({ ...day, weekday }));

// ---- exercises ----------------------------------------------------------------
export function defaultSets(def: Pick<LibraryExercise, 'measurement'>, unit: LoadUnit): PrescribedSet[] {
  const base = { type: 'working' as const, target_load: null, target_unit: unit, rir_target: null };
  if (def.measurement === 'duration') return Array.from({ length: 3 }, () => ({ ...base, rep_min: 30, rep_max: 30, rest_seconds: 60 }));
  if (def.measurement === 'reps') return Array.from({ length: 3 }, () => ({ ...base, rep_min: 6, rep_max: 12, rest_seconds: 90 }));
  return Array.from({ length: 3 }, () => ({ ...base, rep_min: 8, rep_max: 12, rest_seconds: 90 }));
}

export function plannedFromDefinition(def: LibraryExercise, unit: LoadUnit, newId: () => string, sets?: PrescribedSet[]): PlannedExercise {
  return {
    id: newId(),
    exercise_key: def.key,
    name: def.name,
    variant: def.equipment,
    load_convention: def.load_convention,
    unilateral: def.unilateral,
    muscle_group: def.muscle_group,
    measurement: def.measurement,
    sets: sets ?? defaultSets(def, unit),
  };
}

export const addExercise = (d: PlanDraft, dayId: string, ex: PlannedExercise) =>
  mapDay(d, dayId, (day) => withExercises(day, [...day.exercises, ex]));

export const updateExercise = (d: PlanDraft, dayId: string, exId: string, patch: Partial<PlannedExercise>) =>
  mapDay(d, dayId, (day) => withExercises(day, day.exercises.map((e) => (e.id === exId ? { ...e, ...patch, id: e.id } : e))));

export const moveExercise = (d: PlanDraft, dayId: string, exId: string, delta: number) =>
  mapDay(d, dayId, (day) => withExercises(day, move(day.exercises, day.exercises.findIndex((e) => e.id === exId), delta)));

export function duplicateExercise(d: PlanDraft, dayId: string, exId: string, newId: () => string): PlanDraft {
  return mapDay(d, dayId, (day) => {
    const i = day.exercises.findIndex((e) => e.id === exId);
    if (i < 0) return day;
    const exs = [...day.exercises];
    exs.splice(i + 1, 0, { ...structuredClone(day.exercises[i]!), id: newId() });
    return withExercises(day, exs);
  });
}

export const removeExercise = (d: PlanDraft, dayId: string, exId: string) =>
  mapDay(d, dayId, (day) => withExercises(day, day.exercises.filter((e) => e.id !== exId)));

/** Replace the movement but keep the prescribed sets (when the measurement type matches). */
export function replaceExercise(d: PlanDraft, dayId: string, exId: string, def: LibraryExercise, unit: LoadUnit): PlanDraft {
  return mapDay(d, dayId, (day) =>
    withExercises(
      day,
      day.exercises.map((e) => {
        if (e.id !== exId) return e;
        const sameKind = (e.measurement ?? 'weight_reps') === def.measurement;
        const replaced = plannedFromDefinition(def, unit, () => e.id, sameKind ? e.sets : undefined);
        // Loads from a different movement are not meaningful; keep reps/rest only.
        return sameKind ? { ...replaced, sets: replaced.sets.map((s) => ({ ...s, target_load: null })) } : replaced;
      }),
    ),
  );
}

// ---- sets ---------------------------------------------------------------------
const mapSets = (d: PlanDraft, dayId: string, exId: string, fn: (sets: PrescribedSet[]) => PrescribedSet[]) =>
  mapDay(d, dayId, (day) =>
    withExercises(day, day.exercises.map((e) => (e.id === exId ? { ...e, sets: fn([...e.sets]) } : e))),
  );

export const addPlannedSet = (d: PlanDraft, dayId: string, exId: string) =>
  mapSets(d, dayId, exId, (sets) => [...sets, { ...(sets[sets.length - 1] ?? defaultSets({ measurement: 'weight_reps' }, 'kg')[0]!), type: 'working' }]);

export const duplicatePlannedSet = (d: PlanDraft, dayId: string, exId: string, index: number) =>
  mapSets(d, dayId, exId, (sets) => {
    if (!sets[index]) return sets;
    sets.splice(index + 1, 0, { ...sets[index]! });
    return sets;
  });

export const removePlannedSet = (d: PlanDraft, dayId: string, exId: string, index: number) =>
  mapSets(d, dayId, exId, (sets) => (sets.length > 1 ? sets.filter((_, i) => i !== index) : sets));

export function updatePlannedSet(d: PlanDraft, dayId: string, exId: string, index: number, patch: Partial<PrescribedSet>): PlanDraft {
  return mapSets(d, dayId, exId, (sets) =>
    sets.map((s, i) => {
      if (i !== index) return s;
      const next = { ...s, ...patch };
      if (next.rep_max < next.rep_min) next.rep_max = next.rep_min;
      return next;
    }),
  );
}

// ---- validation & saving --------------------------------------------------------
export function validatePlan(d: PlanDraft): string[] {
  const errors: string[] = [];
  if (d.days.length === 0) errors.push('Add at least one workout day.');
  for (const day of d.days) {
    if (!day.name.trim()) errors.push('Every day needs a name.');
    if (day.exercises.length === 0) errors.push(`Add an exercise to “${day.name || 'Untitled'}” or remove that day.`);
  }
  if (d.schedule === 'weekdays') {
    const used = d.days.map((x) => x.weekday).filter((w) => w !== null);
    if (new Set(used).size !== used.length) errors.push('Two days share the same weekday.');
  }
  return errors;
}

export function commitPlan(args: {
  draft: PlanDraft;
  previous: ProgramVersion | null;
  ownerId: string;
  newId: () => string;
  now: string;
  synthetic: boolean;
}): ProgramVersion {
  const errors = validatePlan(args.draft);
  if (errors.length) throw new Error(errors.join(' '));
  return {
    id: args.newId(),
    owner_id: args.ownerId,
    local_version: 0,
    created_at: args.now,
    updated_at: args.now,
    deleted_at: null,
    synthetic: args.synthetic,
    program_id: args.previous?.program_id ?? args.newId(),
    version: (args.previous?.version ?? 0) + 1,
    name: args.draft.name.trim() || 'My plan',
    schedule: args.draft.schedule,
    days: args.draft.days.map((day) => ({ ...day, name: day.name.trim(), muscle_groups: muscleGroupsOf(day.exercises) })),
  };
}

/** Human-readable change list for the save preview. */
export function describeChanges(prev: PlanDraft | null, next: PlanDraft): string[] {
  const out: string[] = [];
  const prevDays = new Map((prev?.days ?? []).map((d) => [d.id, d]));
  const nextIds = new Set(next.days.map((d) => d.id));
  for (const d of prev?.days ?? []) if (!nextIds.has(d.id)) out.push(`Removed ${d.name}`);
  next.days.forEach((d, i) => {
    const p = prevDays.get(d.id);
    if (!p) return void out.push(`Added ${d.name} (${d.exercises.length} exercise${d.exercises.length === 1 ? '' : 's'})`);
    if (p.name !== d.name) out.push(`Renamed ${p.name} to ${d.name}`);
    if ((prev?.days.findIndex((x) => x.id === d.id) ?? i) !== i) out.push(`Moved ${d.name}`);
    if ((p.weekday ?? null) !== (d.weekday ?? null)) out.push(`${d.name}: ${d.weekday === null ? 'no fixed weekday' : WEEKDAY_LONG[d.weekday]}`);
    const pe = new Map(p.exercises.map((e) => [e.id, e]));
    const ne = new Set(d.exercises.map((e) => e.id));
    for (const e of p.exercises) if (!ne.has(e.id)) out.push(`${d.name}: removed ${e.name}`);
    for (const e of d.exercises) {
      const old = pe.get(e.id);
      if (!old) out.push(`${d.name}: added ${e.name}`);
      else if (old.name !== e.name) out.push(`${d.name}: ${old.name} → ${e.name}`);
      else if (JSON.stringify(old.sets) !== JSON.stringify(e.sets)) out.push(`${d.name}: ${e.name} sets changed (${old.sets.length} → ${e.sets.length})`);
    }
    if (p.exercises.map((e) => e.id).join() !== d.exercises.map((e) => e.id).filter((id) => pe.has(id)).join() &&
        p.exercises.every((e) => ne.has(e.id))) out.push(`${d.name}: exercises reordered`);
  });
  if (prev && prev.schedule !== next.schedule) out.push(next.schedule === 'weekdays' ? 'Now follows weekdays' : 'Now follows the order of days');
  if (prev && prev.name !== next.name) out.push(`Plan renamed to ${next.name}`);
  return out;
}

/**
 * The day to suggest today. Weekday plans use today's weekday (null if nothing is scheduled);
 * rotation plans use the day after the most recently finished one.
 */
export function suggestedDay(p: ProgramVersion, finishedNewestFirst: readonly WorkoutSession[], weekday: number): ProgramDay | null {
  if ((p.schedule ?? 'rotation') === 'weekdays') return p.days.find((d) => d.weekday === weekday) ?? null;
  const last = finishedNewestFirst.find((s) => p.days.some((d) => d.id === s.day_id));
  if (!last) return p.days[0] ?? null;
  const i = p.days.findIndex((d) => d.id === last.day_id);
  return p.days[(i + 1) % p.days.length] ?? null;
}
