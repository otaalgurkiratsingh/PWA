import { describe, expect, it } from 'vitest';
import { highestMilestone, loggingStreak, milestoneToday, shiftDate, streakLine, weekStart, workoutWeekStreak } from './retention.ts';

const run = (end: string, n: number) => Array.from({ length: n }, (_, i) => shiftDate(end, -i));

describe('gentle streaks', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday
  });

  it('counts consecutive logged days; today still open', () => {
    expect(loggingStreak(run('2026-10-12', 5), '2026-10-12')).toMatchObject({ current: 5, loggedToday: true });
    expect(loggingStreak(run('2026-10-11', 5), '2026-10-12')).toMatchObject({ current: 5, loggedToday: false });
  });

  it('one missed day per week is covered automatically; frozen days do not count', () => {
    // Mon 12 .. Fri 16 logged except Wed 14
    const days = ['2026-10-12', '2026-10-13', '2026-10-15', '2026-10-16'];
    const s = loggingStreak(days, '2026-10-16');
    expect(s.current).toBe(4);
    expect(s.frozen).toEqual(['2026-10-14']);
    expect(streakLine(s)).toMatch(/streak freeze covered/);
  });

  it('a second miss in the same week ends the run, kindly', () => {
    const days = ['2026-10-12', '2026-10-14', '2026-10-16'];
    const s = loggingStreak(days, '2026-10-16');
    expect(s.current).toBe(2); // Fri + Thu frozen + Wed; Tue missed (same week, freeze spent)
    const gone = loggingStreak(['2026-10-01'], '2026-10-12');
    expect(gone).toMatchObject({ current: 0, broken: true });
    expect(streakLine(gone)).toBe('Life happens. Start a new one today 💪');
    expect(streakLine(loggingStreak([], '2026-10-12'))).not.toMatch(/lost|miss|fail/i);
  });

  it('a freeze in each week lets a long run survive one gap per week', () => {
    const days = run('2026-10-25', 21).filter((d) => d !== '2026-10-14' && d !== '2026-10-21');
    expect(loggingStreak(days, '2026-10-25').current).toBe(19);
  });

  it('milestones only on the day they are reached', () => {
    expect(milestoneToday(loggingStreak(run('2026-10-12', 7), '2026-10-12'))).toBe(7);
    expect(milestoneToday(loggingStreak(run('2026-10-12', 8), '2026-10-12'))).toBeNull();
    expect(highestMilestone(45)).toBe(30);
    expect(highestMilestone(3)).toBeNull();
  });

  it('best run is remembered', () => {
    const days = [...run('2026-09-20', 10), ...run('2026-10-12', 3)];
    expect(loggingStreak(days, '2026-10-12')).toMatchObject({ current: 3, best: 10 });
  });

  it('workout streak counts weeks with at least one workout', () => {
    expect(workoutWeekStreak(['2026-10-13', '2026-10-07', '2026-09-30'], '2026-10-14')).toBe(3);
    expect(workoutWeekStreak(['2026-10-07', '2026-09-30'], '2026-10-14')).toBe(2); // this week still open
    expect(workoutWeekStreak(['2026-09-23'], '2026-10-14')).toBe(0);
  });
});
