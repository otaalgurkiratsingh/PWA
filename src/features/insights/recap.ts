import type { MealEntry, MealSlot, WorkoutSession } from '@shared/contracts';
import { totalsOfItems } from '@/domain/nutrition/calc';
import { loggingStreak, shiftDate, weekStart as mondayOf } from '../../../supabase/functions/_shared/retention';

/**
 * Luma Insights: the weekly recap, the year recap and the copy they use. Pure functions over the
 * person's own journal records. Every number comes from logged data; unknown nutrients stay
 * unknown (never counted as 0) and nothing here is invented. Copy is warm and never shaming.
 */

export interface PersonalBest {
  name: string;
  load: number;
  unit: string;
}

export interface WeekRecap {
  weekStart: string;
  weekEnd: string;
  /** Days with any meal entry or finished workout (up to today). */
  daysLogged: number;
  /** Days of the week that have started (1–7; 0 for a future week). */
  daysElapsed: number;
  /** Logged days / elapsed days, 0–100 integer. */
  consistencyPct: number;
  workouts: number;
  /** Completed sets in finished workouts. */
  sets: number;
  /** New heaviest completed load vs every earlier session (same exercise and unit). */
  prs: PersonalBest[];
  protein: {
    /** Average grams per day, only from days whose protein total is complete. */
    avgPerLoggedDay: number | null;
    daysWithKnownProtein: number;
    /** Days with meals whose protein total is partial or unknown. */
    daysWithUnknownProtein: number;
    trend: 'up' | 'down' | 'flat' | null;
    target: number | null;
    /** Complete days at or above the target (null without a target). */
    daysAtTarget: number | null;
  };
  /** One true fact Luma noticed, or null when there's nothing true to say. */
  surprise: string | null;
  /** The recap is "earned" with at least 3 logged days that week. */
  earned: boolean;
}

export interface YearRecap {
  year: number;
  daysLogged: number;
  workouts: number;
  totalSets: number;
  bestStreak: number;
  topExercises: { name: string; sets: number }[];
  prs: number;
  favouriteMeal: string | null;
  favouriteMealCount: number;
  firstLogDate: string | null;
  identityLine: string;
}

export const EARN_DAYS = 3;
const SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Every sentence this module can produce. Kept in one place so tests can scan it for unkind words. */
export const COPY = {
  progression: (name: string, gain: string, unit: string, weeks: number) => `Your ${name} is up ${gain} ${unit} in ${weeks} weeks.`,
  proteinTarget: (days: number) => `You reached your protein target on ${days} days this week.`,
  slot: (slot: MealSlot, days: number) => `You logged ${slot === 'snack' ? 'a snack' : slot} ${days} days this week.`,
  favourite: (name: string, times: number) => `${name} was your go-to meal this week: ${times} times.`,
  consistentDay: (weekday: string) => `Most consistent day: ${weekday}.`,
  identityTrainer: 'You are someone who trains.',
  identityStarter: 'Every log counts. Here’s to next year.',
  identityLogger: 'You showed up for yourself, again and again. Here’s to next year.',
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** "2.5" not "2.50"; whole numbers stay whole. */
export function formatLoad(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** "Oct 5 – 11", or "Sep 28 – Oct 4" across a month boundary. Read from the string (no time zone). */
export function weekLabel(start: string, end: string): string {
  const [, sm, sd] = start.split('-').map(Number) as [number, number, number];
  const [, em, ed] = end.split('-').map(Number) as [number, number, number];
  const s = `${MONTHS[sm - 1]} ${sd}`;
  return sm === em ? `${s} – ${ed}` : `${s} – ${MONTHS[em - 1]} ${ed}`;
}

function liveMeals(meals: readonly MealEntry[]): MealEntry[] {
  return meals
    .filter((m) => !m.deleted_at && DATE_RE.test(m.local_date))
    .sort((a, b) => a.local_date.localeCompare(b.local_date) || a.logged_at.localeCompare(b.logged_at) || a.id.localeCompare(b.id));
}

function finishedSessions(sessions: readonly WorkoutSession[]): WorkoutSession[] {
  return sessions
    .filter((s) => s.status === 'finished' && !s.deleted_at && DATE_RE.test(s.local_date))
    .sort((a, b) => a.local_date.localeCompare(b.local_date) || a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id));
}

function completedSets(s: WorkoutSession): number {
  return s.exercises.reduce((a, e) => a + e.sets.filter((x) => x.status === 'completed').length, 0);
}

/** Top completed load per exercise+unit in one session. */
function sessionTops(s: WorkoutSession): Map<string, PersonalBest> {
  const tops = new Map<string, PersonalBest>();
  for (const e of s.exercises) {
    for (const x of e.sets) {
      if (x.status !== 'completed' || !x.actual || !(x.actual.load > 0)) continue;
      const k = `${e.exercise_key}|${x.actual.unit}`;
      if ((tops.get(k)?.load ?? 0) < x.actual.load) tops.set(k, { name: e.name, load: x.actual.load, unit: x.actual.unit });
    }
  }
  return tops;
}

/**
 * Walk finished sessions in order and report each time an exercise beats every earlier session's
 * heaviest completed load. A first-ever load is a starting point, not a best.
 */
function bestEvents(sorted: readonly WorkoutSession[]): { date: string; key: string; best: PersonalBest }[] {
  const maxSoFar = new Map<string, number>();
  const events: { date: string; key: string; best: PersonalBest }[] = [];
  for (const s of sorted) {
    const tops = sessionTops(s);
    for (const [k, t] of tops) {
      const prev = maxSoFar.get(k);
      if (prev !== undefined && t.load > prev) events.push({ date: s.local_date, key: k, best: t });
    }
    for (const [k, t] of tops) maxSoFar.set(k, Math.max(maxSoFar.get(k) ?? 0, t.load));
  }
  return events;
}

/** Days with any meal entry or finished workout. */
export function loggedDates(meals: readonly MealEntry[], sessions: readonly WorkoutSession[]): Set<string> {
  return new Set([...liveMeals(meals).map((m) => m.local_date), ...finishedSessions(sessions).map((s) => s.local_date)]);
}

interface ProteinWeek {
  avg: number | null;
  known: number;
  unknown: number;
  atTarget: number;
}

function proteinFor(meals: readonly MealEntry[], from: string, to: string, target: number | null): ProteinWeek {
  const byDay = new Map<string, MealEntry[]>();
  for (const m of meals) {
    if (m.local_date < from || m.local_date > to) continue;
    byDay.set(m.local_date, [...(byDay.get(m.local_date) ?? []), m]);
  }
  let sum = 0;
  let known = 0;
  let unknown = 0;
  let atTarget = 0;
  for (const entries of byDay.values()) {
    const p = totalsOfItems(entries.flatMap((e) => e.items)).protein_g;
    if (p.complete && p.value !== null) {
      known++;
      sum += p.value;
      if (target !== null && p.value >= target) atTarget++;
    } else {
      unknown++;
    }
  }
  return { avg: known ? Math.round(sum / known) : null, known, unknown, atTarget };
}

function trendOf(now: number | null, before: number | null): 'up' | 'down' | 'flat' | null {
  if (now === null || before === null) return null;
  const diff = now - before;
  const threshold = Math.max(5, before * 0.05);
  if (diff >= threshold) return 'up';
  if (diff <= -threshold) return 'down';
  return 'flat';
}

/** Biggest gain for an exercise trained this week vs a session at least 4 weeks earlier (within 12 weeks). */
function progressionFact(sorted: readonly WorkoutSession[], start: string, end: string): string | null {
  const history = new Map<string, { date: string; top: PersonalBest }[]>();
  for (const s of sorted) {
    if (s.local_date > end) continue;
    for (const [k, t] of sessionTops(s)) history.set(k, [...(history.get(k) ?? []), { date: s.local_date, top: t }]);
  }
  let pick: { gain: number; weeks: number; name: string; unit: string } | null = null;
  for (const [, rows] of [...history].sort(([a], [b]) => a.localeCompare(b))) {
    const latest = rows[rows.length - 1];
    if (!latest || latest.date < start) continue;
    const floor = shiftDate(latest.date, -84);
    const earliest = rows.find((r) => r.date >= floor && daysBetween(r.date, latest.date) >= 28);
    if (!earliest) continue;
    const gain = latest.top.load - earliest.top.load;
    if (!(gain > 0)) continue;
    const weeks = Math.round(daysBetween(earliest.date, latest.date) / 7);
    if (!pick || gain > pick.gain || (gain === pick.gain && latest.top.name < pick.name)) {
      pick = { gain, weeks, name: latest.top.name, unit: latest.top.unit };
    }
  }
  return pick ? COPY.progression(pick.name, formatLoad(pick.gain), pick.unit, pick.weeks) : null;
}

/** The weekday with the most logged days over the 8 weeks ending this week, when it clearly leads. */
function consistentDayFact(days: ReadonlySet<string>, start: string, end: string): string | null {
  const from = shiftDate(start, -49);
  const counts = new Array<number>(7).fill(0);
  for (const d of days) if (d >= from && d <= end) counts[weekdayOf(d)]!++;
  const ranked = counts.map((n, i) => ({ n, i })).sort((a, b) => b.n - a.n || a.i - b.i);
  const [top, second] = ranked;
  if (!top || !second || top.n < 3 || top.n === second.n) return null;
  return COPY.consistentDay(WEEKDAYS[top.i]!);
}

export function weekRecap(input: {
  weekStart: string;
  today: string;
  meals: MealEntry[];
  sessions: WorkoutSession[];
  proteinTarget: number | null;
}): WeekRecap {
  const { today } = input;
  const start = mondayOf(input.weekStart);
  const end = shiftDate(start, 6);
  const upTo = today < end ? today : end;
  const target = input.proteinTarget && input.proteinTarget > 0 ? input.proteinTarget : null;

  const meals = liveMeals(input.meals).filter((m) => m.local_date <= today);
  const sorted = finishedSessions(input.sessions).filter((s) => s.local_date <= today);
  const allDays = loggedDates(meals, sorted);

  const weekMeals = meals.filter((m) => m.local_date >= start && m.local_date <= upTo);
  const weekSessions = sorted.filter((s) => s.local_date >= start && s.local_date <= upTo);
  const days = [...allDays].filter((d) => d >= start && d <= upTo);
  const daysElapsed = today < start ? 0 : Math.min(7, daysBetween(start, today) + 1);
  const daysLogged = days.length;
  const consistencyPct = daysElapsed ? Math.min(100, Math.round((daysLogged / daysElapsed) * 100)) : 0;

  const bests = new Map<string, PersonalBest>();
  for (const e of bestEvents(sorted)) {
    if (e.date < start || e.date > upTo) continue;
    if ((bests.get(e.key)?.load ?? 0) < e.best.load) bests.set(e.key, e.best);
  }
  const prs = [...bests.values()].sort((a, b) => b.load - a.load || a.name.localeCompare(b.name));

  const protein = proteinFor(meals, start, upTo, target);
  const before = proteinFor(meals, shiftDate(start, -7), shiftDate(start, -1), target);

  // One fact, in a fixed order of preference, only when it is true.
  let surprise = progressionFact(sorted, start, upTo);
  if (!surprise && target !== null && protein.atTarget >= 3) surprise = COPY.proteinTarget(protein.atTarget);
  if (!surprise) {
    const slotDays = SLOTS.map((slot) => ({ slot, n: new Set(weekMeals.filter((m) => m.slot === slot).map((m) => m.local_date)).size }));
    const top = [...slotDays].sort((a, b) => b.n - a.n)[0];
    if (top && top.n >= 4) surprise = COPY.slot(top.slot, top.n);
  }
  if (!surprise) {
    const counts = new Map<string, number>();
    for (const m of weekMeals) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
    const top = [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0];
    if (top && top[1] >= 3) surprise = COPY.favourite(top[0], top[1]);
  }
  if (!surprise) surprise = consistentDayFact(allDays, start, upTo);

  return {
    weekStart: start,
    weekEnd: end,
    daysLogged,
    daysElapsed,
    consistencyPct,
    workouts: weekSessions.length,
    sets: weekSessions.reduce((a, s) => a + completedSets(s), 0),
    prs,
    protein: {
      avgPerLoggedDay: protein.avg,
      daysWithKnownProtein: protein.known,
      daysWithUnknownProtein: protein.unknown,
      trend: trendOf(protein.avg, before.avg),
      target,
      daysAtTarget: target === null ? null : protein.atTarget,
    },
    surprise,
    earned: daysLogged >= EARN_DAYS,
  };
}

export function yearRecap(input: { year: number; today: string; meals: MealEntry[]; sessions: WorkoutSession[] }): YearRecap {
  const { year, today } = input;
  const from = `${String(year).padStart(4, '0')}-01-01`;
  const yearEnd = `${String(year).padStart(4, '0')}-12-31`;
  const to = today < yearEnd ? today : yearEnd;
  const inYear = (d: string) => d >= from && d <= to;

  const allSessions = finishedSessions(input.sessions).filter((s) => s.local_date <= to);
  const sessions = allSessions.filter((s) => inYear(s.local_date));
  const meals = liveMeals(input.meals).filter((m) => inYear(m.local_date));
  const days = [...loggedDates(meals, sessions)].sort();

  const exercises = new Map<string, { name: string; sets: number }>();
  for (const s of sessions) {
    for (const e of s.exercises) {
      const n = e.sets.filter((x) => x.status === 'completed').length;
      if (!n) continue;
      const cur = exercises.get(e.exercise_key);
      exercises.set(e.exercise_key, { name: e.name, sets: (cur?.sets ?? 0) + n });
    }
  }
  const topExercises = [...exercises.values()].sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name)).slice(0, 3);

  const mealCounts = new Map<string, number>();
  for (const m of meals) mealCounts.set(m.name, (mealCounts.get(m.name) ?? 0) + 1);
  const fav = [...mealCounts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0] ?? null;

  const workouts = sessions.length;
  return {
    year,
    daysLogged: days.length,
    workouts,
    totalSets: sessions.reduce((a, s) => a + completedSets(s), 0),
    bestStreak: days.length ? loggingStreak(days, to).best : 0,
    topExercises,
    prs: bestEvents(allSessions).filter((e) => inYear(e.date)).length,
    favouriteMeal: fav ? fav[0] : null,
    favouriteMealCount: fav ? fav[1] : 0,
    firstLogDate: days[0] ?? null,
    identityLine: workouts >= 12 ? COPY.identityTrainer : days.length >= 30 ? COPY.identityLogger : COPY.identityStarter,
  };
}
