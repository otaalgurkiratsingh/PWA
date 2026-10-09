import { describe, expect, it } from 'vitest';
import { EXERCISE_LIBRARY } from '@shared/fixtures/exerciseLibrary';
import { ProgramVersion, type WorkoutSession } from '@shared/contracts';
import {
  addDay, addExercise, addPlannedSet, commitPlan, describeChanges, draftFrom, duplicateDay, duplicateExercise,
  moveDay, moveExercise, plannedFromDefinition, removeDay, removePlannedSet, renameDay, replaceExercise,
  setWeekday, suggestedDay, updatePlannedSet, validatePlan,
} from './plan';
import { addSessionSet, completeSet, finishSession, removeAddedSet, sessionSummary, startSession } from './session';

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const lib = (name: string) => EXERCISE_LIBRARY.find((e) => e.name === name)!;

function buildPlan() {
  let d = draftFrom(null);
  d = addDay(d, 'Upper', newId);
  d = addDay(d, 'Lower', newId);
  const [upper, lower] = d.days;
  d = addExercise(d, upper!.id, plannedFromDefinition(lib('Bench press'), 'kg', newId));
  d = addExercise(d, upper!.id, plannedFromDefinition(lib('Pull-up'), 'kg', newId));
  d = addExercise(d, lower!.id, plannedFromDefinition(lib('Back squat'), 'kg', newId));
  return d;
}

describe('plan editing', () => {
  it('creates days, exercises, and default sets matching the measurement', () => {
    const d = buildPlan();
    expect(validatePlan(d)).toEqual([]);
    expect(d.days[0]!.muscle_groups).toEqual(['chest', 'back']);
    expect(d.days[0]!.exercises[1]!.measurement).toBe('reps');
    const plank = plannedFromDefinition(lib('Plank'), 'kg', newId);
    expect(plank.sets[0]).toMatchObject({ rep_min: 30, rep_max: 30 });
  });

  it('rename, reorder, duplicate, remove days', () => {
    let d = buildPlan();
    const [upper, lower] = d.days;
    d = renameDay(d, upper!.id, 'Push');
    d = moveDay(d, lower!.id, -1);
    expect(d.days.map((x) => x.name)).toEqual(['Lower', 'Push']);
    d = duplicateDay(d, upper!.id, newId);
    expect(d.days.map((x) => x.name)).toEqual(['Lower', 'Push', 'Push copy']);
    expect(d.days[2]!.id).not.toBe(upper!.id);
    expect(d.days[2]!.exercises[0]!.id).not.toBe(d.days[1]!.exercises[0]!.id);
    d = removeDay(d, d.days[2]!.id);
    expect(d.days).toHaveLength(2);
    expect(moveDay(d, d.days[0]!.id, -1)).toEqual(d); // out of range = no change
  });

  it('edits exercises and sets', () => {
    let d = buildPlan();
    const day = d.days[0]!;
    const bench = day.exercises[0]!;
    d = addPlannedSet(d, day.id, bench.id);
    d = updatePlannedSet(d, day.id, bench.id, 0, { type: 'warmup', rep_min: 10, rep_max: 5, target_load: 20 });
    let ex = d.days[0]!.exercises[0]!;
    expect(ex.sets).toHaveLength(4);
    expect(ex.sets[0]).toMatchObject({ type: 'warmup', rep_min: 10, rep_max: 10, target_load: 20 }); // max clamped >= min
    d = removePlannedSet(d, day.id, bench.id, 0);
    ex = d.days[0]!.exercises[0]!;
    expect(ex.sets).toHaveLength(3);
    d = moveExercise(d, day.id, bench.id, 1);
    expect(d.days[0]!.exercises.map((e) => e.name)).toEqual(['Pull-up', 'Bench press']);
    d = duplicateExercise(d, day.id, bench.id, newId);
    expect(d.days[0]!.exercises).toHaveLength(3);
    d = replaceExercise(d, day.id, bench.id, lib('Dumbbell bench press'), 'kg');
    const replaced = d.days[0]!.exercises.find((e) => e.id === bench.id)!;
    expect(replaced).toMatchObject({ name: 'Dumbbell bench press', variant: 'dumbbell', load_convention: 'per_dumbbell' });
    expect(replaced.sets.every((s) => s.target_load === null)).toBe(true);
  });

  it('validates empty days, empty plans and weekday clashes', () => {
    expect(validatePlan(draftFrom(null))).toContain('Add at least one workout day.');
    let d = addDay(buildPlan(), 'Empty', newId);
    expect(validatePlan(d).join()).toMatch(/Empty/);
    d = { ...buildPlan(), schedule: 'weekdays' };
    d = setWeekday(d, d.days[0]!.id, 1);
    d = setWeekday(d, d.days[1]!.id, 1);
    expect(validatePlan(d)).toContain('Two days share the same weekday.');
  });

  it('saving creates a new immutable version; old sessions keep their prescriptions', () => {
    const v1 = commitPlan({ draft: buildPlan(), previous: null, ownerId: 'o', newId, now: '2026-10-09T10:00:00Z', synthetic: false });
    ProgramVersion.parse(v1);
    const day = v1.days[0]!;
    const session = startSession({ id: newId(), ownerId: 'o', program: v1, day, localDate: '2026-10-09', timezone: 'UTC', now: '2026-10-09T10:00:00Z', newId, history: [], unit: 'kg', synthetic: false });
    const frozen = structuredClone(session);

    let d2 = draftFrom(v1);
    d2 = updatePlannedSet(d2, day.id, day.exercises[0]!.id, 0, { rep_min: 3, rep_max: 5 });
    d2 = renameDay(d2, day.id, 'Upper A');
    const v2 = commitPlan({ draft: d2, previous: v1, ownerId: 'o', newId, now: '2026-10-10T10:00:00Z', synthetic: false });

    expect(v2.version).toBe(2);
    expect(v2.program_id).toBe(v1.program_id);
    expect(v2.id).not.toBe(v1.id);
    expect(v1.days[0]!.name).toBe('Upper'); // v1 object untouched
    expect(session).toEqual(frozen);
    expect(describeChanges(draftFrom(v1), d2)).toEqual(expect.arrayContaining(['Renamed Upper to Upper A', expect.stringMatching(/Bench press sets changed/)]));
    expect(() => commitPlan({ draft: draftFrom(null), previous: v1, ownerId: 'o', newId, now: 'x', synthetic: false })).toThrow();
  });

  it('suggests a day by rotation or by weekday', () => {
    const v1 = commitPlan({ draft: buildPlan(), previous: null, ownerId: 'o', newId, now: '2026-10-09T10:00:00Z', synthetic: false });
    expect(suggestedDay(v1, [], 3)!.name).toBe('Upper');
    const finished = { day_id: v1.days[0]!.id, status: 'finished' } as unknown as WorkoutSession;
    expect(suggestedDay(v1, [finished], 3)!.name).toBe('Lower');
    const wk = { ...v1, schedule: 'weekdays' as const, days: v1.days.map((d, i) => ({ ...d, weekday: i === 0 ? 1 : 4 })) };
    expect(suggestedDay(wk, [], 4)!.name).toBe('Lower');
    expect(suggestedDay(wk, [], 0)).toBeNull();
  });
});

describe('workout additions', () => {
  it('adds a set mid-workout, removes it if unused, and summarises comparable progress', () => {
    const v1 = commitPlan({ draft: buildPlan(), previous: null, ownerId: 'o', newId, now: '2026-10-09T10:00:00Z', synthetic: false });
    const day = v1.days[0]!;
    const mk = (now: string, history: WorkoutSession[]) =>
      startSession({ id: newId(), ownerId: 'o', program: v1, day, localDate: now.slice(0, 10), timezone: 'UTC', now, newId, history, unit: 'kg', synthetic: false });
    let s1 = mk('2026-10-01T10:00:00Z', []);
    const b1 = s1.exercises[0]!;
    s1 = completeSet(s1, b1.sets[0]!.id, { reps: 8, load: 60, unit: 'kg', rir: null, discomfort: false }, '2026-10-01T10:05:00Z');
    s1 = finishSession(s1, '2026-10-01T10:40:00Z');

    let s2 = mk('2026-10-03T10:00:00Z', [s1]);
    const pe = s2.exercises[0]!.planned_exercise_id;
    s2 = addSessionSet(s2, pe, newId);
    const added = s2.exercises[0]!.sets.at(-1)!;
    expect(added).toMatchObject({ added: true, status: 'pending', index: 3 });
    expect(removeAddedSet(s2, added.id).exercises[0]!.sets).toHaveLength(3);
    s2 = completeSet(s2, added.id, { reps: 8, load: 62.5, unit: 'kg', rir: null, discomfort: true }, '2026-10-03T10:20:00Z');
    s2 = finishSession(s2, '2026-10-03T10:45:00Z');
    const sum = sessionSummary(s2, [s1], 'kg');
    expect(sum).toMatchObject({ durationMinutes: 45, exercisesDone: 1, workingSets: 1, discomfortFlags: 1 });
    expect(sum.comparisons[0]).toMatchObject({ name: 'Bench press', change: 'heavier' });
  });
});
