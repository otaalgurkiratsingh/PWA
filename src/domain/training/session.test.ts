import { describe, expect, it } from 'vitest';
import type { ProgramVersion, WorkoutSession } from '@shared/contracts';
import {
  KG_PER_LB,
  comparableKey,
  completeSet,
  convertLoad,
  estimateOneRepMax,
  finishSession,
  lastComparable,
  reopenSession,
  skipSet,
  startSession,
  undoSet,
  workingSummary,
} from './session';
import { extendTimer, remainingSeconds, startTimer } from './timer';

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const base = { owner_id: 't', local_version: 1, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', deleted_at: null, synthetic: true };
const program: ProgramVersion = {
  ...base, id: newId(), program_id: newId(), version: 1, name: 'Demo', schedule: 'rotation',
  days: [{
    id: newId(), name: 'Push', muscle_groups: ['chest'], weekday: null,
    exercises: [
      { id: newId(), exercise_key: 'bench_press', name: 'Bench press', variant: 'barbell', load_convention: 'total', unilateral: false, muscle_group: 'chest', measurement: 'weight_reps',
        sets: [
          { type: 'warmup', rep_min: 10, rep_max: 10, target_load: 20, target_unit: 'kg', rest_seconds: 60, rir_target: null },
          { type: 'working', rep_min: 6, rep_max: 8, target_load: 50, target_unit: 'kg', rest_seconds: 120, rir_target: 2 },
          { type: 'working', rep_min: 6, rep_max: 8, target_load: 50, target_unit: 'kg', rest_seconds: 120, rir_target: 2 },
        ] },
      { id: newId(), exercise_key: 'bench_press', name: 'DB bench press', variant: 'dumbbell', load_convention: 'per_dumbbell', unilateral: false, muscle_group: 'chest', measurement: 'weight_reps',
        sets: [{ type: 'working', rep_min: 10, rep_max: 12, target_load: 16, target_unit: 'kg', rest_seconds: 90, rir_target: null }] },
    ],
  }],
};
const day = program.days[0]!;
const start = (history: WorkoutSession[] = [], now = '2026-10-02T10:00:00Z') =>
  startSession({ id: newId(), ownerId: 't', program, day, localDate: now.slice(0, 10), timezone: 'UTC', now, newId, history, unit: 'kg', synthetic: true });

describe('planned vs actual', () => {
  it('snapshots the prescription and starts with nothing completed', () => {
    const s = start();
    const bench = s.exercises[0]!;
    expect(bench.sets.map((x) => x.status)).toEqual(['pending', 'pending', 'pending']);
    expect(bench.sets[1]!.planned).toMatchObject({ rep_min: 6, rep_max: 8, target_load: 50 });
    expect(bench.sets[1]!.actual).toBeNull();
  });

  it('completing a set records actual separately from planned', () => {
    let s = start();
    const id = s.exercises[0]!.sets[1]!.id;
    s = completeSet(s, id, { reps: 5, load: 50, unit: 'kg', rir: 1, discomfort: false }, '2026-10-02T10:05:00Z');
    const set = s.exercises[0]!.sets[1]!;
    expect(set.actual!.reps).toBe(5);
    expect(set.planned.rep_min).toBe(6); // target unchanged even though actual fell short
    expect(set.status).toBe('completed');
  });

  it('undo removes performance; skip is not zero-rep performance', () => {
    let s = start();
    const [, w1, w2] = s.exercises[0]!.sets;
    s = completeSet(s, w1!.id, { reps: 8, load: 50, unit: 'kg', rir: null, discomfort: false }, '2026-10-02T10:05:00Z');
    s = undoSet(s, w1!.id);
    expect(s.exercises[0]!.sets[1]!.status).toBe('pending');
    expect(s.exercises[0]!.sets[1]!.actual).toBeNull();
    s = skipSet(s, w2!.id);
    const sum = workingSummary(s.exercises[0]!, 'kg');
    expect(sum.completedWorkingSets).toBe(0);
    expect(sum.skippedSets).toBe(1);
    expect(sum.volume).toBeNull(); // not 0
  });

  it('finished sessions reject edits until reopened', () => {
    let s = finishSession(start(), '2026-10-02T11:00:00Z');
    const id = s.exercises[0]!.sets[1]!.id;
    expect(() => completeSet(s, id, { reps: 8, load: 50, unit: 'kg', rir: null, discomfort: false }, '2026-10-02T11:01:00Z')).toThrow();
    s = reopenSession(s);
    expect(() => completeSet(s, id, { reps: 8, load: 50, unit: 'kg', rir: null, discomfort: false }, '2026-10-02T11:01:00Z')).not.toThrow();
  });
});

describe('history and comparisons', () => {
  it('summaries exclude warm-ups', () => {
    let s = start();
    const [warm, w1] = s.exercises[0]!.sets;
    s = completeSet(s, warm!.id, { reps: 10, load: 20, unit: 'kg', rir: null, discomfort: false }, '2026-10-02T10:01:00Z');
    s = completeSet(s, w1!.id, { reps: 8, load: 50, unit: 'kg', rir: null, discomfort: false }, '2026-10-02T10:05:00Z');
    expect(workingSummary(s.exercises[0]!, 'kg')).toMatchObject({ completedWorkingSets: 1, volume: 400 });
  });

  it('previous performance only matches the same variant and load convention', () => {
    let s1 = start([], '2026-10-01T10:00:00Z');
    const dbSet = s1.exercises[1]!.sets[0]!;
    s1 = completeSet(s1, dbSet.id, { reps: 12, load: 18, unit: 'kg', rir: null, discomfort: false }, '2026-10-01T10:10:00Z');
    s1 = finishSession(s1, '2026-10-01T11:00:00Z');
    const barbellKey = comparableKey(s1.exercises[0]!);
    const dbKey = comparableKey(s1.exercises[1]!);
    expect(barbellKey).not.toBe(dbKey);
    expect(lastComparable([s1], barbellKey)).toBeNull(); // barbell had no completed sets
    expect(lastComparable([s1], dbKey)!.sets[0]!.actual!.load).toBe(18);
    // Copy-last: the next session pre-fills drafts from it but completes nothing.
    const s2 = start([s1]);
    expect(s2.exercises[1]!.sets[0]!.draft).toEqual({ reps: 12, load: 18 });
    expect(s2.exercises[1]!.sets[0]!.status).toBe('pending');
  });

  it('prefills drafts in the user\'s unit', () => {
    const lb = startSession({ id: newId(), ownerId: 't', program, day, localDate: '2026-10-02', timezone: 'UTC', now: '2026-10-02T10:00:00Z', newId, history: [], unit: 'lb', synthetic: true });
    expect(lb.exercises[0]!.sets[1]!.draft.load).toBe(110); // 50 kg target ≈ 110.2 lb, rounded to 1 lb
    expect(lb.exercises[0]!.sets[1]!.planned.target_unit).toBe('kg'); // prescription itself untouched
  });

  it('active (unfinished) sessions are not used as history', () => {
    const active = start([], '2026-10-01T10:00:00Z');
    expect(lastComparable([active], comparableKey(active.exercises[0]!))).toBeNull();
  });
});

describe('units and estimates', () => {
  it('converts lb/kg exactly and round-trips', () => {
    expect(convertLoad(100, 'lb', 'kg')).toBeCloseTo(100 * KG_PER_LB, 10);
    expect(convertLoad(convertLoad(60, 'kg', 'lb'), 'lb', 'kg')).toBeCloseTo(60, 10);
  });
  it('e1RM is only produced within the supported rep range', () => {
    expect(estimateOneRepMax(100, 5)).toBeCloseTo(116.7, 1);
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 15)).toBeNull();
    expect(estimateOneRepMax(0, 5)).toBeNull();
  });
});

describe('rest timer', () => {
  it('derives remaining time from an absolute end timestamp', () => {
    const t = startTimer(newId(), newId(), 90, 1_000_000);
    expect(remainingSeconds(t, 1_000_000)).toBe(90);
    // Simulate the tab being backgrounded for 60 s: no interval needed.
    expect(remainingSeconds(t, 1_060_000)).toBe(30);
    expect(remainingSeconds(t, 2_000_000)).toBe(0);
    expect(remainingSeconds(extendTimer(t, 30, 1_060_000), 1_060_000)).toBe(60);
  });
});
