/**
 * Notification decisions for the `notify` Edge Function (pg_cron calls it every 5 minutes).
 * Pure and unit-tested; notify/index.ts only wires Supabase, secrets and Web Push.
 *
 * Two kinds, at most one of each per person per local day (claimed in the database first):
 * - motivation: a daily encouraging line built from the person's own backed-up records
 *   (same rules as the "How you're doing" card on Today);
 * - gym: a reminder `lead_minutes` before the person's gym time on the days they chose.
 * With "hide details" on, the lock screen only shows a neutral line.
 */
import { momentum, type MomentumSession } from './momentum.ts';

export interface DueRow { user_id: string; kind: 'motivation' | 'gym'; local_date: string; hide_details: boolean; lead_minutes: number; timezone: string }
export interface NotifyContext {
  training: { sessions_per_week?: unknown } | null;
  sessions: unknown[];
  meal_dates: unknown[];
  program: { name?: unknown; schedule?: unknown; days?: unknown } | null;
}
export interface PushTarget { endpoint: string; p256dh: string; auth_secret: string }
export interface NotificationPayload { title: string; body: string; tag: string; url: string }

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Keep only well-formed finished sessions (bodies come from synced documents). */
export function cleanSessions(raw: unknown[]): MomentumSession[] {
  const out: MomentumSession[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    if (!isDate(o.local_date) || o.status !== 'finished' || !Array.isArray(o.exercises)) continue;
    const exercises = o.exercises.flatMap((e) => {
      if (!e || typeof e !== 'object') return [];
      const x = e as Record<string, unknown>;
      if (typeof x.exercise_key !== 'string' || typeof x.name !== 'string' || !Array.isArray(x.sets)) return [];
      const sets = x.sets.flatMap((st) => {
        if (!st || typeof st !== 'object') return [];
        const t = st as Record<string, unknown>;
        const a = t.actual as Record<string, unknown> | null | undefined;
        const actual = a && typeof a.load === 'number' && Number.isFinite(a.load) && (a.unit === 'kg' || a.unit === 'lb') ? { load: a.load, unit: a.unit } : null;
        return [{ status: String(t.status), actual }];
      });
      return [{ exercise_key: x.exercise_key, name: x.name.slice(0, 60), sets }];
    });
    out.push({ local_date: o.local_date, status: 'finished', deleted_at: null, exercises });
  }
  return out;
}

interface PlanDay { id: string; name: string; weekday: number | null }
function planDays(program: NotifyContext['program']): { schedule: string; days: PlanDay[] } | null {
  if (!program || !Array.isArray(program.days)) return null;
  const days = program.days.flatMap((d) => {
    if (!d || typeof d !== 'object') return [];
    const o = d as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.name !== 'string') return [];
    return [{ id: o.id, name: o.name.slice(0, 60), weekday: Number.isInteger(o.weekday) ? (o.weekday as number) : null }];
  });
  return days.length ? { schedule: program.schedule === 'weekdays' ? 'weekdays' : 'rotation', days } : null;
}

/** Which plan day the person is likely doing on `date` (by weekday, or the next one in rotation). */
export function plannedDayName(ctx: NotifyContext, date: string, rawSessions: unknown[] = ctx.sessions): string | null {
  const plan = planDays(ctx.program);
  if (!plan) return null;
  if (plan.schedule === 'weekdays') {
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    return plan.days.find((d) => d.weekday === dow)?.name ?? null;
  }
  const last = rawSessions
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && (s as Record<string, unknown>).status === 'finished')
    .sort((a, b) => String(b.local_date).localeCompare(String(a.local_date)))[0];
  const i = last ? plan.days.findIndex((d) => d.id === last.day_id) : -1;
  return plan.days[(i + 1) % plan.days.length]!.name;
}

// A few kind starters so the daily line doesn't feel copy-pasted. Picked by date, never random.
const FRESH = [
  'Small steps add up. One good meal and one session is a great day.',
  'Show up for 20 minutes today. Future you will thank you.',
  'Consistency beats perfection. Log one meal and move a little.',
  'Today is a good day to start a streak.',
];

export function motivationMessage(ctx: NotifyContext, today: string, hide: boolean): NotificationPayload {
  const base = { tag: `motivation-${today}`, url: '/#/today' };
  if (hide) return { ...base, title: 'TrainLuma', body: 'Your daily check-in is ready. Tap to see how you’re doing.' };
  const target = Number(ctx.training?.sessions_per_week);
  const m = momentum({
    today,
    sessions: cleanSessions(ctx.sessions),
    meals: ctx.meal_dates.filter(isDate).map((d) => ({ local_date: d })),
    target: Number.isInteger(target) && target >= 1 && target <= 7 ? target : null,
  });
  if (m.tone === 'start') {
    const n = Number(today.replaceAll('-', '')) % FRESH.length;
    return { ...base, title: m.headline, body: FRESH[n]! };
  }
  return { ...base, title: m.headline, body: m.detail };
}

export function gymMessage(ctx: NotifyContext | null, gymDate: string, lead: number, hide: boolean): NotificationPayload {
  const base = { tag: `gym-${gymDate}`, url: '/#/workout' };
  if (hide) return { ...base, title: 'Workout reminder', body: `Your session starts in ${lead} minutes.` };
  const day = ctx ? plannedDayName(ctx, gymDate) : null;
  return {
    ...base,
    title: day ? `${day} in ${lead} minutes` : `Gym time in ${lead} minutes`,
    body: 'Get ready. Tap to open your workout and log each set as you go.',
  };
}

export interface NotifyDeps {
  now: () => Date;
  due: (now: Date) => Promise<DueRow[]>;
  claim: (user: string, kind: string, date: string) => Promise<boolean>;
  context: (user: string, date: string) => Promise<NotifyContext>;
  targets: (user: string) => Promise<PushTarget[]>;
  send: (target: PushTarget, payload: NotificationPayload) => Promise<{ status: number; gone: boolean }>;
  result: (endpoint: string, gone: boolean) => Promise<void>;
  log?: (event: string, data: Record<string, unknown>) => void;
}

/** One cron tick. Claims before sending, so overlapping ticks never double-send. */
export async function runNotify(deps: NotifyDeps): Promise<{ due: number; sent: number; failed: number; skipped: number }> {
  const rows = await deps.due(deps.now());
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows.slice(0, 500)) {
    if (!(await deps.claim(row.user_id, row.kind, row.local_date))) {
      skipped++;
      continue;
    }
    try {
      const needsData = !row.hide_details;
      const ctx = needsData ? await deps.context(row.user_id, row.local_date) : null;
      const payload = row.kind === 'motivation'
        ? motivationMessage(ctx ?? { training: null, sessions: [], meal_dates: [], program: null }, row.local_date, row.hide_details)
        : gymMessage(ctx, row.local_date, row.lead_minutes, row.hide_details);
      for (const t of await deps.targets(row.user_id)) {
        try {
          const r = await deps.send(t, payload);
          await deps.result(t.endpoint, r.gone);
          if (r.status >= 200 && r.status < 300) sent++;
          else failed++;
        } catch (e) {
          failed++;
          deps.log?.('notify_send_failed', { kind: row.kind, error: (e as Error).name });
        }
      }
    } catch (e) {
      failed++;
      deps.log?.('notify_failed', { kind: row.kind, error: (e as Error).name });
    }
  }
  return { due: rows.length, sent, failed, skipped };
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
