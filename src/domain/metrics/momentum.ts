import type { MealEntry, WorkoutSession } from '@shared/contracts';
import { addDays } from './metrics';

/**
 * "How you're doing" on Today: a short, encouraging read of the person's own recent records.
 * Computed on the phone from local data only. Never shames a gap; a missed week is a fresh start.
 */
export interface Momentum {
  tone: 'win' | 'steady' | 'start';
  headline: string;
  detail: string;
  workouts7: number;
  /** Workouts the person planned per week, when known. */
  target: number | null;
  sets7: number;
  /** Consecutive days with at least one meal logged, ending today (or yesterday if today is still empty). */
  logStreak: number;
  bests: { name: string; load: number; unit: string }[];
}

export interface MomentumInput {
  today: string;
  sessions: readonly WorkoutSession[];
  meals: readonly MealEntry[];
  target: number | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function momentum({ today, sessions, meals, target }: MomentumInput): Momentum {
  const weekStart = addDays(today, -6);
  const prevStart = addDays(today, -13);
  const finished = sessions.filter((s) => s.status === 'finished' && !s.deleted_at && s.local_date <= today);
  const thisWeek = finished.filter((s) => s.local_date >= weekStart);
  const lastWeek = finished.filter((s) => s.local_date >= prevStart && s.local_date < weekStart);
  const workouts7 = thisWeek.length;
  const sets7 = thisWeek.reduce((a, s) => a + s.exercises.reduce((b, e) => b + e.sets.filter((x) => x.status === 'completed').length, 0), 0);

  // Personal bests: heaviest completed load this week above every earlier load for the same exercise and unit.
  const before = new Map<string, number>();
  for (const s of finished) {
    if (s.local_date >= weekStart) continue;
    for (const e of s.exercises) for (const x of e.sets) {
      if (x.status !== 'completed' || !x.actual || x.actual.load <= 0) continue;
      const k = `${e.exercise_key}|${x.actual.unit}`;
      before.set(k, Math.max(before.get(k) ?? 0, x.actual.load));
    }
  }
  const best = new Map<string, { name: string; load: number; unit: string }>();
  for (const s of thisWeek) {
    for (const e of s.exercises) for (const x of e.sets) {
      if (x.status !== 'completed' || !x.actual || x.actual.load <= 0) continue;
      const k = `${e.exercise_key}|${x.actual.unit}`;
      const prev = before.get(k);
      if (prev === undefined || x.actual.load <= prev) continue;
      if ((best.get(k)?.load ?? 0) < x.actual.load) best.set(k, { name: e.name, load: x.actual.load, unit: x.actual.unit });
    }
  }
  const bests = [...best.values()].sort((a, b) => b.load - a.load);

  const mealDays = new Set(meals.filter((m) => !m.deleted_at).map((m) => m.local_date));
  let day = mealDays.has(today) ? today : addDays(today, -1);
  let logStreak = 0;
  while (mealDays.has(day)) {
    logStreak++;
    day = addDays(day, -1);
  }

  const lastDate = finished.reduce<string | null>((a, s) => (a === null || s.local_date > a ? s.local_date : a), null);
  const base = { workouts7, target, sets7, logStreak, bests };

  if (bests.length) {
    const b = bests[0]!;
    const more = bests.length > 1 ? ` and ${plural(bests.length - 1, 'other best')}` : '';
    return { ...base, tone: 'win', headline: 'You’re getting stronger', detail: `New best this week: ${b.name} at ${b.load} ${b.unit}${more}.` };
  }
  if (target && workouts7 >= target) {
    return { ...base, tone: 'win', headline: 'Weekly goal reached', detail: `${workouts7} of ${target} workouts in the last 7 days. That’s the habit doing its work.` };
  }
  if (workouts7 > 0 && workouts7 > lastWeek.length && lastWeek.length > 0) {
    return { ...base, tone: 'win', headline: 'More than last week', detail: `${plural(workouts7, 'workout')} in the last 7 days, up from ${lastWeek.length}. Keep it rolling.` };
  }
  if (workouts7 > 0) {
    const left = target ? target - workouts7 : 0;
    return {
      ...base, tone: 'steady', headline: 'You’re on track',
      detail: left > 0 ? `${workouts7} of ${target} workouts this week. ${left} more to hit your goal.` : `${plural(workouts7, 'workout')} and ${plural(sets7, 'set')} in the last 7 days.`,
    };
  }
  if (logStreak >= 3) {
    return { ...base, tone: 'steady', headline: `${logStreak}-day logging streak`, detail: 'Your food log is building a clear picture. A short workout would round out the week.' };
  }
  if (lastDate) {
    return { ...base, tone: 'start', headline: 'Fresh week, fresh start', detail: 'Busy weeks happen. Even a 20-minute session today counts.' };
  }
  return { ...base, tone: 'start', headline: 'Let’s get the first one done', detail: 'Your first workout starts your streak. Log meals as you go and progress shows up here.' };
}
