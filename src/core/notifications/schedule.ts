/**
 * Reminder preferences and "when is the next one" — pure, so the panel can show exactly when
 * each notification will arrive. Notifications v2 (the `notify` function decides): three kinds only
 * (a routine nudge, the gym reminder, "your milestone / weekly insight is ready"), at most 2 a day,
 * never between 22:00 and 07:00 local, and a kind dismissed 3 times stops for good.
 */
export type NotifyKind = 'routine' | 'gym' | 'insight';

export interface NotificationPrefs {
  /** "Time for your usual chai?" when you usually log something and haven't yet. */
  routine_enabled: boolean;
  /** "Your weekly insight is ready" / milestone reached. */
  insight_enabled: boolean;
  gym_enabled: boolean;
  /** learned: from when you usually start workouts; fixed: the days and time below. */
  gym_mode: 'learned' | 'fixed';
  /** 0 = Sunday … 6 = Saturday (fixed mode). */
  gym_days: number[];
  gym_time: string;
  lead_minutes: number;
  hide_details: boolean;
  timezone: string;
  /** Retired v1 daily motivation: always off, kept so old rows stay readable. */
  motivation_enabled: false;
  motivation_time: string;
}

export const DAILY_MAX = 2;
export const QUIET_FROM = '22:00';
export const QUIET_UNTIL = '07:00';
/** Same rule as the server: a kind dismissed this many times stops for good. */
export const DISMISS_STOP = 3;

export const LEAD_CHOICES = [10, 15, 30, 45] as const;

export function defaultPrefs(timezone: string, daysAvailable: readonly number[] = []): NotificationPrefs {
  return {
    routine_enabled: true,
    insight_enabled: true,
    gym_enabled: true,
    gym_mode: 'learned',
    motivation_enabled: false,
    motivation_time: '08:00',
    gym_days: daysAvailable.length ? [...daysAvailable].sort() : [1, 3, 5],
    gym_time: '18:00',
    lead_minutes: 15,
    hide_details: false,
    timezone,
  };
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const validTime = (t: string) => HHMM.test(t);

/** Wall-clock parts of an instant in a time zone. */
function partsIn(tz: string, d: Date) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!, s: +p.second! };
}

/** The instant when the wall clock in `tz` shows y-m-d h:mi (two passes handle DST changes). */
export function zonedInstant(tz: string, y: number, m: number, d: number, h: number, mi: number): Date {
  const want = Date.UTC(y, m - 1, d, h, mi);
  let t = want;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(tz, new Date(t));
    t += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  }
  return new Date(t);
}

export interface Upcoming { kind: NotifyKind; at: Date }

/** Local "HH:MM" inside 22:00–07:00 (nothing is sent then). */
export function inQuietHours(time: string): boolean {
  return validTime(time) && (time >= QUIET_FROM || time < QUIET_UNTIL);
}

/**
 * The next fixed-time gym reminder after `now` (within 8 days). Routine nudges, learned gym times
 * and insights depend on your logs, so they have no fixed time to show.
 */
export function nextReminders(prefs: NotificationPrefs, now: Date): Upcoming[] {
  const out: Upcoming[] = [];
  const today = partsIn(prefs.timezone, now);
  const base = Date.UTC(today.y, today.m - 1, today.d);
  const find = (kind: Upcoming['kind'], time: string, days: readonly number[] | null, leadMin: number) => {
    const [h, mi] = time.split(':').map(Number) as [number, number];
    for (let i = 0; i <= 8; i++) {
      const day = new Date(base + i * 86_400_000);
      if (days && !days.includes(day.getUTCDay())) continue;
      const at = new Date(zonedInstant(prefs.timezone, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, mi).getTime() - leadMin * 60_000);
      if (at > now) return out.push({ kind, at });
    }
  };
  if (prefs.gym_enabled && prefs.gym_mode === 'fixed' && prefs.gym_days.length && validTime(prefs.gym_time)
    && !inQuietHours(minusMinutes(prefs.gym_time, prefs.lead_minutes))) find('gym', prefs.gym_time, prefs.gym_days, prefs.lead_minutes);
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** "Today 5:45 PM", "Tomorrow 8:00 AM" or "Wed 5:45 PM", in the person's time zone. */
export function describeWhen(at: Date, now: Date, tz: string): string {
  const day = (d: Date) => { const p = partsIn(tz, d); return Date.UTC(p.y, p.m - 1, p.d); };
  const diff = Math.round((day(at) - day(now)) / 86_400_000);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(at);
  const label = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(at);
  return `${label} ${time}`;
}

/** "18:00" minus 15 minutes → "17:45" (for the panel's explanation). */
export function minusMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const t = (((h * 60 + m - minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
