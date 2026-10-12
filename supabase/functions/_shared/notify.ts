/**
 * Notification decisions for the `notify` Edge Function (pg_cron calls it every 5 minutes).
 * Pure and unit-tested; notify/index.ts only wires Supabase, secrets and Web Push.
 *
 * Notifications v2: three kinds only, each actionable in one tap, never guilt.
 * - routine: "Your usual X?" when a meal preset was logged in the same slot on at least 4
 *   consecutive days ending yesterday and isn't logged in that slot yet today, around the usual time;
 * - gym: a reminder `lead_minutes` before the person's gym time, LEARNED from when they usually
 *   start on that weekday (or their fixed days/time when they chose "fixed");
 * - insight: a streak milestone (7, 30, 100 days) in the evening, or the Sunday-evening weekly recap.
 *
 * Hard rules (also enforced in the database): at most 2 per person per local day, nothing in quiet
 * hours (22:00-07:00 local), a kind dismissed 3 times stops for good, the old daily "motivation"
 * message is retired. With "hide details" on, no records are read at all: only a fixed-time gym
 * reminder can be decided, and the lock screen shows a neutral line.
 */
import { loggingStreak, milestoneToday, shiftDate, weekStart } from './retention.ts';

export type NotifyKind = 'routine' | 'gym' | 'insight';

/** One row of `notify_candidates` (already outside quiet hours and under the daily cap). */
export interface CandidateRow {
  user_id: string;
  timezone: string;
  /** Local wall-clock time, e.g. "2026-10-12T18:05:00". */
  local_ts: string;
  routine_enabled: boolean;
  insight_enabled: boolean;
  gym_enabled: boolean;
  gym_mode: 'learned' | 'fixed';
  gym_days: number[];
  gym_time: string;
  lead_minutes: number;
  hide_details: boolean;
  sent_today: number;
  stopped_kinds: string[];
}

/** `notify_context`: the person's own plan, finished workouts, recent meals and logged dates. */
export interface NotifyContext {
  training?: unknown;
  sessions: unknown[];
  meals: unknown[];
  logged_dates: unknown[];
  program: { name?: unknown; schedule?: unknown; days?: unknown } | null;
  meal_dates?: unknown[];
}
export interface PushTarget { endpoint: string; p256dh: string; auth_secret: string }
export interface NotificationAction { action: string; title: string }
export interface NotificationPayload { title: string; body: string; tag: string; url: string; kind: NotifyKind; actions?: NotificationAction[] }
export interface Decision { kind: NotifyKind; claimDate: string; payload: NotificationPayload }

export const DAILY_MAX = 2;
export const QUIET_FROM = 22 * 60;
export const QUIET_UNTIL = 7 * 60;
/** Gym times are learned from this many weeks of finished sessions (at least 2 on the weekday). */
export const LEARN_WEEKS = 8;

/** Every line a notification can show. Warm, specific, never guilt, never urgency. */
export const COPY = {
  neutral: { title: 'TrainLuma', body: 'Something\'s ready for you.' },
  gym: { title: '{day} in {lead} minutes', titleNoPlan: 'Gym time in {lead} minutes', body: 'Get ready. Tap to open your workout and log each set as you go.' },
  routine: { title: 'Your usual {name}?', body: 'Tap Log it and it\'s done.', action: 'Log it' },
  milestone: { title: '{n} days in a row 🎉', body: 'Luma made you a little celebration card.' },
  weekly: { title: 'Luma found something in your week 👀', body: 'Your weekly recap is ready.' },
} as const;

/** Phrases that must never appear in anything we send (guilt, shame, comparison, urgency). */
export const BANNED_COPY = /we miss you|don['’]?t lose|you skipped|where were you|you missed|last place|worst|hurry|last chance|running out|too late|ends soon|expires?|countdown|only \d+ \w+ left|lazy|fail/i;

const fill = (t: string, vars: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export interface LocalNow { date: string; minutes: number; dow: number }

/** "2026-10-12T18:05:00" (or with a space) → local date, minutes since midnight, weekday. */
export function parseLocal(ts: unknown): LocalNow | null {
  const m = typeof ts === 'string' ? /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(ts) : null;
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  if (minutes >= 24 * 60) return null;
  return { date: m[1]!, minutes, dow: dow(m[1]!) };
}

/** "18:00" / "18:00:00" → minutes since midnight. */
export function parseClock(t: unknown): number | null {
  const m = typeof t === 'string' ? /^(\d{2}):(\d{2})/.exec(t) : null;
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v < 24 * 60 ? v : null;
}

export const isQuietHours = (minutes: number) => minutes >= QUIET_FROM || minutes < QUIET_UNTIL;

const formatters = new Map<string, Intl.DateTimeFormat | null>();
function formatter(tz: string): Intl.DateTimeFormat | null {
  if (!formatters.has(tz)) {
    try {
      formatters.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
    } catch {
      formatters.set(tz, null);
    }
  }
  return formatters.get(tz) ?? null;
}

/** An instant (ISO string) as local date + minutes in a time zone; null when either is invalid. */
export function zonedTime(iso: unknown, tz: unknown): { date: string; minutes: number } | null {
  if (typeof iso !== 'string' || typeof tz !== 'string' || !tz) return null;
  const t = Date.parse(iso);
  const f = formatter(tz);
  if (!Number.isFinite(t) || !f) return null;
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: hour * 60 + Number(p.minute) };
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

interface PlanDay { id: string; name: string; weekday: number | null }
function planDays(program: NotifyContext['program']): { schedule: string; days: PlanDay[] } | null {
  if (!program || !Array.isArray(program.days)) return null;
  const days = program.days.flatMap((d) => {
    const o = rec(d);
    if (!o || typeof o.id !== 'string' || typeof o.name !== 'string') return [];
    return [{ id: o.id, name: o.name.slice(0, 60), weekday: Number.isInteger(o.weekday) ? (o.weekday as number) : null }];
  });
  return days.length ? { schedule: program.schedule === 'weekdays' ? 'weekdays' : 'rotation', days } : null;
}

/** Which plan day the person is likely doing on `date` (by weekday, or the next one in rotation). */
export function plannedDayName(ctx: NotifyContext, date: string): string | null {
  const plan = planDays(ctx.program);
  if (!plan) return null;
  if (plan.schedule === 'weekdays') return plan.days.find((d) => d.weekday === dow(date))?.name ?? null;
  const last = ctx.sessions
    .map(rec)
    .filter((s): s is Record<string, unknown> => !!s && s.status === 'finished' && isDate(s.local_date) && s.local_date < date)
    .sort((a, b) => String(b.local_date).localeCompare(String(a.local_date)))[0];
  const i = last ? plan.days.findIndex((d) => d.id === last.day_id) : -1;
  return plan.days[(i + 1) % plan.days.length]!.name;
}

function neutral(kind: NotifyKind, claimDate: string, url: string): NotificationPayload {
  return { title: COPY.neutral.title, body: COPY.neutral.body, tag: `${kind}-${claimDate}`, url, kind };
}

// ---------------------------------------------------------------------------
// gym
// ---------------------------------------------------------------------------

/** Median local start time (minutes) on `today`'s weekday over the last 8 weeks; ≥ 2 sessions needed. */
export function learnedGymMinutes(sessions: unknown[], today: string, tz: string): number | null {
  const from = shiftDate(today, -7 * LEARN_WEEKS);
  const target = dow(today);
  const starts: number[] = [];
  for (const raw of sessions) {
    const s = rec(raw);
    if (!s || s.status !== 'finished' || !isDate(s.local_date) || s.local_date < from || s.local_date >= today || dow(s.local_date) !== target) continue;
    const t = zonedTime(s.started_at, typeof s.timezone === 'string' && formatter(s.timezone) ? s.timezone : tz);
    if (t) starts.push(t.minutes);
  }
  return starts.length >= 2 ? median(starts) : null;
}

export function gymMessage(ctx: NotifyContext | null, date: string, lead: number, hide: boolean): NotificationPayload {
  if (hide) return neutral('gym', date, '/#/workout');
  const day = ctx ? plannedDayName(ctx, date) : null;
  return {
    title: day ? fill(COPY.gym.title, { day, lead }) : fill(COPY.gym.titleNoPlan, { lead }),
    body: COPY.gym.body,
    tag: `gym-${date}`,
    url: '/#/workout',
    kind: 'gym',
  };
}

export function gymDecision(row: CandidateRow, ctx: NotifyContext | null, now: LocalNow): Decision | null {
  if (!row.gym_enabled || row.stopped_kinds.includes('gym')) return null;
  let at: number | null;
  if (row.gym_mode === 'fixed') {
    if (!row.gym_days.map(Number).includes(now.dow)) return null;
    at = parseClock(row.gym_time);
  } else {
    at = ctx ? learnedGymMinutes(ctx.sessions, now.date, row.timezone) : null;
  }
  if (at === null) return null;
  const lead = Math.min(60, Math.max(5, Math.round(Number(row.lead_minutes) || 15)));
  if (now.minutes < at - lead || now.minutes >= at) return null;
  // Already trained today: nothing to remind.
  if (ctx?.sessions.some((s) => rec(s)?.status === 'finished' && rec(s)?.local_date === now.date)) return null;
  return { kind: 'gym', claimDate: now.date, payload: gymMessage(ctx, now.date, lead, row.hide_details) };
}

// ---------------------------------------------------------------------------
// routine
// ---------------------------------------------------------------------------

interface CleanMeal { local_date: string; preset_id: string | null; name: string; slot: string; minutes: number | null }
function cleanMeals(raw: unknown[], tz: string): CleanMeal[] {
  return raw.flatMap((m) => {
    const o = rec(m);
    if (!o || !isDate(o.local_date) || typeof o.slot !== 'string' || !/^[a-z]{1,20}$/.test(o.slot)) return [];
    const at = zonedTime(o.logged_at, typeof o.timezone === 'string' && formatter(o.timezone) ? o.timezone : tz);
    return [{
      local_date: o.local_date,
      preset_id: typeof o.preset_id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(o.preset_id) ? o.preset_id : null,
      name: typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '',
      slot: o.slot,
      minutes: at ? at.minutes : null,
    }];
  });
}

/** The usual meal due now, if any: same preset + slot on ≥ 4 consecutive days ending yesterday. */
export function routineDue(ctx: NotifyContext, now: LocalNow, tz: string): { preset_id: string; slot: string; name: string } | null {
  const meals = cleanMeals(ctx.meals, tz);
  const loggedSlotsToday = new Set(meals.filter((m) => m.local_date === now.date).map((m) => m.slot));
  const groups = new Map<string, CleanMeal[]>();
  for (const m of meals) {
    if (!m.preset_id || m.local_date >= now.date) continue;
    const k = `${m.preset_id}|${m.slot}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const due: { preset_id: string; slot: string; name: string; at: number }[] = [];
  for (const list of groups.values()) {
    const first = list[0]!;
    if (loggedSlotsToday.has(first.slot)) continue;
    const dates = new Set(list.map((m) => m.local_date));
    if (![1, 2, 3, 4].every((n) => dates.has(shiftDate(now.date, -n)))) continue;
    const at = median(list.flatMap((m) => (m.minutes === null ? [] : [m.minutes])));
    if (at === null || now.minutes < at - 20 || now.minutes > at + 40) continue;
    const latest = [...list].sort((a, b) => a.local_date.localeCompare(b.local_date) || (a.minutes ?? 0) - (b.minutes ?? 0)).pop()!;
    if (!latest.name) continue;
    due.push({ preset_id: first.preset_id!, slot: first.slot, name: latest.name, at });
  }
  due.sort((a, b) => a.at - b.at || a.preset_id.localeCompare(b.preset_id));
  return due[0] ?? null;
}

export function routineMessage(r: { preset_id: string; slot: string; name: string }, date: string, hide: boolean): NotificationPayload {
  if (hide) return neutral('routine', date, '/#/today');
  return {
    title: fill(COPY.routine.title, { name: r.name }),
    body: COPY.routine.body,
    tag: `routine-${date}`,
    url: `/#/quicklog/${encodeURIComponent(r.preset_id)}/${encodeURIComponent(r.slot)}`,
    kind: 'routine',
    actions: [{ action: 'log', title: COPY.routine.action }],
  };
}

export function routineDecision(row: CandidateRow, ctx: NotifyContext | null, now: LocalNow): Decision | null {
  if (!row.routine_enabled || row.stopped_kinds.includes('routine') || !ctx) return null;
  const r = routineDue(ctx, now, row.timezone);
  return r ? { kind: 'routine', claimDate: now.date, payload: routineMessage(r, now.date, row.hide_details) } : null;
}

// ---------------------------------------------------------------------------
// insight
// ---------------------------------------------------------------------------

export function milestoneMessage(n: number, date: string, hide: boolean): NotificationPayload {
  if (hide) return neutral('insight', date, '/#/insights');
  return { title: fill(COPY.milestone.title, { n }), body: COPY.milestone.body, tag: `milestone-${date}`, url: '/#/insights', kind: 'insight' };
}

export function weeklyMessage(monday: string, hide: boolean): NotificationPayload {
  if (hide) return neutral('insight', monday, '/#/insights');
  return { title: COPY.weekly.title, body: COPY.weekly.body, tag: `weekly-${monday}`, url: '/#/insights', kind: 'insight' };
}

export function insightDecision(row: CandidateRow, ctx: NotifyContext | null, now: LocalNow): Decision | null {
  if (!row.insight_enabled || row.stopped_kinds.includes('insight') || !ctx) return null;
  const dates = ctx.logged_dates.filter(isDate);
  const milestone = milestoneToday(loggingStreak(dates, now.date));
  if (milestone && now.minutes >= 18 * 60 && now.minutes < 21 * 60 + 30) {
    return { kind: 'insight', claimDate: now.date, payload: milestoneMessage(milestone, now.date, row.hide_details) };
  }
  // Weekly recap: claimed under the week's Monday, so one per week. (A milestone that landed on
  // that Monday used the same claim key; that week the celebration stands in for the recap.)
  if (now.dow === 0 && now.minutes >= 18 * 60 && now.minutes < 21 * 60) {
    const monday = weekStart(now.date);
    const days = new Set(dates.filter((d) => d >= monday && d <= now.date));
    if (days.size >= 3) return { kind: 'insight', claimDate: monday, payload: weeklyMessage(monday, row.hide_details) };
  }
  return null;
}

/** Everything due for one person right now, highest priority first (insight > gym > routine). */
export function decide(row: CandidateRow, ctx: NotifyContext | null): Decision[] {
  const now = parseLocal(row.local_ts);
  if (!now || isQuietHours(now.minutes) || (Number(row.sent_today) || 0) >= DAILY_MAX) return [];
  return [insightDecision(row, ctx, now), gymDecision(row, ctx, now), routineDecision(row, ctx, now)].filter((d): d is Decision => d !== null);
}

/** Whether any kind could fire for this row (skips reading records when nothing could). */
export function anyKindPossible(row: CandidateRow): boolean {
  const on = (k: NotifyKind, enabled: boolean) => enabled && !row.stopped_kinds.includes(k);
  if (row.hide_details) return on('gym', row.gym_enabled) && row.gym_mode === 'fixed';
  return on('routine', row.routine_enabled) || on('insight', row.insight_enabled) || on('gym', row.gym_enabled);
}

export interface NotifyDeps {
  now: () => Date;
  candidates: (now: Date) => Promise<CandidateRow[]>;
  claim: (user: string, kind: NotifyKind, date: string) => Promise<boolean>;
  context: (user: string, date: string) => Promise<NotifyContext>;
  targets: (user: string) => Promise<PushTarget[]>;
  send: (target: PushTarget, payload: NotificationPayload) => Promise<{ status: number; gone: boolean }>;
  result: (endpoint: string, gone: boolean) => Promise<void>;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export interface NotifyRunResult { candidates: number; due: number; sent: number; failed: number; skipped: number }

/** One cron tick. Claims before sending, so overlapping ticks never double-send or exceed the cap. */
export async function runNotify(deps: NotifyDeps): Promise<NotifyRunResult> {
  const rows = await deps.candidates(deps.now());
  const out: NotifyRunResult = { candidates: rows.length, due: 0, sent: 0, failed: 0, skipped: 0 };
  for (const row of rows.slice(0, 500)) {
    try {
      const now = parseLocal(row.local_ts);
      let budget = DAILY_MAX - (Number(row.sent_today) || 0);
      if (!now || budget <= 0 || isQuietHours(now.minutes) || !anyKindPossible(row)) continue;
      // Hidden details: no records are read at all.
      const ctx = row.hide_details ? null : await deps.context(row.user_id, now.date);
      const decisions = decide(row, ctx);
      out.due += decisions.length;
      for (const d of decisions) {
        if (budget <= 0) break;
        if (!(await deps.claim(row.user_id, d.kind, d.claimDate))) {
          out.skipped++;
          continue;
        }
        budget--;
        for (const t of await deps.targets(row.user_id)) {
          try {
            const r = await deps.send(t, d.payload);
            await deps.result(t.endpoint, r.gone);
            if (r.status >= 200 && r.status < 300) out.sent++;
            else out.failed++;
          } catch (e) {
            out.failed++;
            deps.log?.('notify_send_failed', { kind: d.kind, error: (e as Error).name });
          }
        }
      }
    } catch (e) {
      out.failed++;
      deps.log?.('notify_failed', { error: (e as Error).name });
    }
  }
  return out;
}

/** Constant-time comparison of the cron secret. */
export function secretMatches(given: string | null, expected: string | null): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function handleNotifyRequest(req: Request, secret: string | null, deps: NotifyDeps | null): Promise<Response> {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const auth = req.headers.get('authorization');
  const given = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!secretMatches(given, secret)) return json(401, { error: 'unauthorized' });
  if (!deps) return json(503, { error: 'not_configured' });
  return json(200, await runNotify(deps));
}
