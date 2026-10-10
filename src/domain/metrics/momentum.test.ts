import { describe, expect, it } from 'vitest';
import type { MealEntry, WorkoutSession } from '@shared/contracts';
import { momentum } from './momentum';

const today = '2026-10-10';

function session(date: string, loads: number[] = [], key = 'squat', status: 'finished' | 'active' = 'finished'): WorkoutSession {
  return {
    local_date: date, status, deleted_at: null,
    exercises: [{
      exercise_key: key, name: 'Squat',
      sets: (loads.length ? loads : [0]).map((load) => ({ status: 'completed', actual: { reps: 5, load, unit: 'kg', rir: null, discomfort: false } })),
    }],
  } as unknown as WorkoutSession;
}
const meal = (date: string) => ({ local_date: date, deleted_at: null }) as unknown as MealEntry;

describe('momentum', () => {
  it('welcomes a brand-new person without numbers to shame', () => {
    const m = momentum({ today, sessions: [], meals: [], target: 3 });
    expect(m.tone).toBe('start');
    expect(m.headline).toMatch(/first one/);
  });

  it('celebrates a new personal best over earlier weeks only', () => {
    const m = momentum({ today, sessions: [session('2026-09-20', [60]), session('2026-10-08', [62.5, 65])], meals: [], target: 3 });
    expect(m.tone).toBe('win');
    expect(m.bests).toEqual([{ name: 'Squat', load: 65, unit: 'kg' }]);
    expect(m.detail).toContain('65 kg');
  });

  it('does not count a first-ever load as a best', () => {
    const m = momentum({ today, sessions: [session('2026-10-08', [40])], meals: [], target: 3 });
    expect(m.bests).toEqual([]);
    expect(m.headline).toBe('You’re on track');
    expect(m.detail).toBe('1 of 3 workouts this week. 2 more to hit your goal.');
  });

  it('marks the weekly goal reached and ignores active sessions', () => {
    const s = ['2026-10-05', '2026-10-07', '2026-10-09'].map((d) => session(d));
    const m = momentum({ today, sessions: [...s, session(today, [], 'squat', 'active')], meals: [], target: 3 });
    expect(m.workouts7).toBe(3);
    expect(m.headline).toBe('Weekly goal reached');
  });

  it('compares with the week before', () => {
    const m = momentum({ today, sessions: [session('2026-10-01'), session('2026-10-06'), session('2026-10-09')], meals: [], target: null });
    expect(m.headline).toBe('More than last week');
  });

  it('counts a logging streak that may end yesterday, and frames a gap kindly', () => {
    const meals = ['2026-10-07', '2026-10-08', '2026-10-09'].map(meal);
    expect(momentum({ today, sessions: [], meals, target: 3 }).logStreak).toBe(3);
    expect(momentum({ today, sessions: [], meals: [...meals, meal('2026-10-05')], target: 3 }).headline).toBe('3-day logging streak');
    const gap = momentum({ today, sessions: [session('2026-09-01')], meals: [], target: 3 });
    expect(gap.headline).toBe('Fresh week, fresh start');
  });
});
