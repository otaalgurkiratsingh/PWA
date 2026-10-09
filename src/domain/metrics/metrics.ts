import type { DailyHealthSummary, DailyLogStatus, LoadUnit, MealEntry, WeightEntry } from '@shared/contracts';
import { convertLoad } from '../training/session';

/** Inclusive list of local dates ending at `end`, `days` long. Pure date arithmetic in UTC to avoid DST drift. */
export function dateRange(end: string, days: number): string[] {
  const [y, m, d] = end.split('-').map(Number) as [number, number, number];
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - 1, d - i));
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export interface DayPoint<T> {
  date: string;
  value: T | null; // null = missing, never 0
}

/** Steps (or sleep) per day; days without a record are null (missing), not zero. */
export function healthSeries(rows: readonly DailyHealthSummary[], metric: DailyHealthSummary['metric'], dates: readonly string[]): DayPoint<number>[] {
  const byDate = new Map(rows.filter((r) => r.metric === metric).map((r) => [r.local_date, r.value]));
  return dates.map((date) => ({ date, value: byDate.get(date) ?? null }));
}

/** Weight per day (latest measurement that day), converted to the display unit. */
export function weightSeries(rows: readonly WeightEntry[], dates: readonly string[], unit: LoadUnit): DayPoint<number>[] {
  const latest = new Map<string, WeightEntry>();
  for (const w of rows) {
    if (w.deleted_at) continue;
    const cur = latest.get(w.local_date);
    if (!cur || cur.measured_at < w.measured_at) latest.set(w.local_date, w);
  }
  return dates.map((date) => {
    const w = latest.get(date);
    return { date, value: w ? Math.round(convertLoad(w.value, w.unit, unit) * 10) / 10 : null };
  });
}

export interface WeightTrend {
  points: number;
  /** Change between the mean of the first and last available weeks; null when data is too sparse. */
  change: number | null;
  sparse: boolean;
  message: string;
}

/**
 * A conservative trend: needs >= 3 measurements in both the first and last 7-day windows of the period.
 * Otherwise reports "not enough comparable measurements" rather than guessing.
 */
export function weightTrend(series: readonly DayPoint<number>[], unit: LoadUnit): WeightTrend {
  const known = series.filter((p) => p.value !== null);
  if (series.length < 14) {
    return { points: known.length, change: null, sparse: true, message: 'Choose 28 or 90 days to see a weight trend.' };
  }
  const first = series.slice(0, 7).filter((p) => p.value !== null).map((p) => p.value!);
  const last = series.slice(-7).filter((p) => p.value !== null).map((p) => p.value!);
  if (first.length < 3 || last.length < 3) {
    return {
      points: known.length,
      change: null,
      sparse: true,
      message:
        `${known.length} weigh-in${known.length === 1 ? '' : 's'} in this period, but a trend needs at least 3 in both the first week (have ${first.length}) ` +
        `and the last week (have ${last.length}). No trend is shown rather than guessing.`,
    };
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const change = Math.round((mean(last) - mean(first)) * 10) / 10;
  const dir = change === 0 ? 'about the same' : change < 0 ? `down ${Math.abs(change)} ${unit}` : `up ${change} ${unit}`;
  return {
    points: known.length,
    change,
    sparse: false,
    message: `Weekly average is ${dir} from the first to the last week of this period (${known.length} weigh-ins). Day-to-day changes are normal.`,
  };
}

export interface LoggingConsistency {
  days: number;
  daysWithMeals: number;
  daysMarkedComplete: number;
  message: string;
}

export function loggingConsistency(entries: readonly MealEntry[], statuses: readonly DailyLogStatus[], dates: readonly string[]): LoggingConsistency {
  const set = new Set(dates);
  const withMeals = new Set(entries.filter((e) => !e.deleted_at && set.has(e.local_date)).map((e) => e.local_date));
  const complete = statuses.filter((s) => s.intake_complete && set.has(s.local_date)).length;
  return {
    days: dates.length,
    daysWithMeals: withMeals.size,
    daysMarkedComplete: complete,
    message:
      `Meals logged on ${withMeals.size} of ${dates.length} days; ${complete} day${complete === 1 ? '' : 's'} marked complete. ` +
      'Days not marked complete are treated as partial — unlogged food is not assumed to be zero.',
  };
}
