/**
 * Gentle streaks (T17), shared by the app and the `notify` function.
 *
 * - A logged day is any day with a food entry or a finished workout.
 * - One streak freeze per ISO week (Monday–Sunday) is applied automatically: a single missed day
 *   in a week never breaks the streak, it just spends that week's freeze. Frozen days don't add
 *   to the count.
 * - Today is still open: if nothing is logged yet today, the streak counts up to yesterday.
 * - Nothing here ever produces shame copy; a broken streak is "Life happens. Start a new one today."
 */

/** YYYY-MM-DD plus whole days (calendar arithmetic, no time zone involved). */
export function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `date`. */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return shiftDate(date, -((dow + 6) % 7));
}

export const MILESTONES = [7, 30, 100] as const;
export type Milestone = (typeof MILESTONES)[number];

export interface Streak {
  /** Logged days in the current run (frozen days don't count). */
  current: number;
  /** Longest run in the given history. */
  best: number;
  /** Days covered by an automatic freeze inside the current run (newest first). */
  frozen: string[];
  /** True when there was a run that has now ended (used for the kind "start a new one" line). */
  broken: boolean;
  /** Whether today is already logged. */
  loggedToday: boolean;
}

/** Walk back from `from` while days are logged or covered by that week's single freeze. */
function runEndingAt(days: ReadonlySet<string>, from: string, floor: string): { count: number; frozen: string[] } {
  let count = 0;
  const frozen: string[] = [];
  const freezeUsed = new Set<string>();
  let d = from;
  while (d >= floor) {
    if (days.has(d)) {
      count++;
    } else {
      const wk = weekStart(d);
      // A freeze only bridges a gap: the day before must continue the run.
      if (freezeUsed.has(wk) || !days.has(shiftDate(d, -1))) break;
      freezeUsed.add(wk);
      frozen.push(d);
    }
    d = shiftDate(d, -1);
  }
  return { count, frozen };
}

export function loggingStreak(loggedDates: Iterable<string>, today: string): Streak {
  const days = new Set([...loggedDates].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today));
  const sorted = [...days].sort();
  const floor = sorted[0] ?? today;
  const loggedToday = days.has(today);
  const start = loggedToday ? today : shiftDate(today, -1);
  const cur = sorted.length ? runEndingAt(days, start, floor) : { count: 0, frozen: [] };
  // Best: the longest run ending on any logged day (freezes apply the same way).
  let best = cur.count;
  for (const d of sorted) {
    if (days.has(shiftDate(d, 1))) continue; // only run ends
    best = Math.max(best, runEndingAt(days, d, floor).count);
  }
  const lastLogged = sorted[sorted.length - 1] ?? null;
  return { current: cur.count, best, frozen: cur.frozen, broken: cur.count === 0 && lastLogged !== null, loggedToday };
}

/** The milestone reached exactly today, if any (7, 30 or 100 logged days in the current run). */
export function milestoneToday(s: Streak): Milestone | null {
  return s.loggedToday ? (MILESTONES.find((m) => m === s.current) ?? null) : null;
}

/** Highest milestone in the current run. */
export function highestMilestone(current: number): Milestone | null {
  return [...MILESTONES].reverse().find((m) => current >= m) ?? null;
}

/** Consecutive weeks (Mon–Sun) with at least one finished workout; this week counts once it has one. */
export function workoutWeekStreak(workoutDates: Iterable<string>, today: string): number {
  const weeks = new Set([...workoutDates].filter((d) => d <= today).map(weekStart));
  let wk = weekStart(today);
  if (!weeks.has(wk)) wk = shiftDate(wk, -7);
  let n = 0;
  while (weeks.has(wk)) {
    n++;
    wk = shiftDate(wk, -7);
  }
  return n;
}

/** Warm, never-shaming streak line for the UI and notifications. */
export function streakLine(s: Streak): string {
  if (s.current === 0) return s.broken ? 'Life happens. Start a new one today 💪' : 'Log something today to start a streak.';
  const freeze = s.frozen.length ? ' A streak freeze covered a missed day this week.' : '';
  return `${s.current}-day streak.${freeze}`;
}
