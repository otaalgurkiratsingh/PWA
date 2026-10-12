import { describe, expect, it, vi } from 'vitest';
import {
  BANNED_COPY, COPY, decide, gymMessage, handleNotifyRequest, learnedGymMinutes, median, milestoneMessage, parseClock, parseLocal,
  plannedDayName, routineMessage, runNotify, secretMatches, weeklyMessage, zonedTime,
  type CandidateRow, type NotificationPayload, type NotifyContext, type NotifyDeps,
} from './notify.ts';
import { shiftDate } from './retention.ts';

// 2026-10-12 is a Monday; Toronto is UTC-4 in October.
const TZ = 'America/Toronto';
const produced: NotificationPayload[] = [];
const keep = <T extends { payload: NotificationPayload }>(ds: T[]) => { for (const d of ds) produced.push(d.payload); return ds; };

const row = (over: Partial<CandidateRow> = {}): CandidateRow => ({
  user_id: 'u1', timezone: TZ, local_ts: '2026-10-12T12:00:00', routine_enabled: true, insight_enabled: true, gym_enabled: true,
  gym_mode: 'learned', gym_days: [], gym_time: '18:00:00', lead_minutes: 15, hide_details: false, sent_today: 0, stopped_kinds: [], ...over,
});
const ctx = (over: Partial<NotifyContext> = {}): NotifyContext => ({ training: { sessions_per_week: 3 }, sessions: [], meals: [], logged_dates: [], program: null, ...over });
const program = (schedule: 'weekdays' | 'rotation') => ({
  name: 'Plan', schedule,
  days: [{ id: 'd1', name: 'Push', weekday: 1 }, { id: 'd2', name: 'Pull', weekday: 3 }, { id: 'd3', name: 'Legs', weekday: 5 }],
});
/** A finished session that started at local hh:mm Toronto time (EDT, UTC-4). */
const session = (date: string, hhmm: string, day_id = 'd1', timezone = TZ) => {
  const [h, m] = hhmm.split(':').map(Number);
  const utc = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h! + 4, m!));
  return { status: 'finished', local_date: date, day_id, day_name: 'x', started_at: utc.toISOString(), timezone };
};
const meal = (date: string, hhmm: string, preset_id: string | null = 'p-dal', slot = 'lunch', name = 'Dal chawal') => {
  const [h, m] = hhmm.split(':').map(Number);
  const utc = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h! + 4, m!));
  return { local_date: date, preset_id, name, slot, logged_at: utc.toISOString(), timezone: TZ };
};
const days = (end: string, n: number) => Array.from({ length: n }, (_, i) => shiftDate(end, -i));

describe('time helpers', () => {
  it('parse local timestamps, clock times, zoned instants and medians', () => {
    expect(parseLocal('2026-10-12T18:05:00')).toEqual({ date: '2026-10-12', minutes: 18 * 60 + 5, dow: 1 });
    expect(parseLocal('2026-10-18 07:00:00')).toEqual({ date: '2026-10-18', minutes: 420, dow: 0 });
    expect(parseLocal('nope')).toBeNull();
    expect(parseClock('18:30:00')).toBe(1110);
    expect(parseClock(null)).toBeNull();
    expect(zonedTime('2026-10-12T22:05:00Z', TZ)).toEqual({ date: '2026-10-12', minutes: 18 * 60 + 5 });
    expect(zonedTime('2026-10-12T22:05:00Z', 'Asia/Kolkata')).toEqual({ date: '2026-10-13', minutes: 3 * 60 + 35 });
    expect(zonedTime('2026-10-12T22:05:00Z', 'Mars/Olympus')).toBeNull();
    expect(zonedTime('garbage', TZ)).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([10, 20])).toBe(15);
    expect(median([])).toBeNull();
  });
});

describe('gym reminders', () => {
  const mondays = [session('2026-10-05', '18:00'), session('2026-09-28', '18:30'), session('2026-09-21', '18:10')];

  it('learns the usual start time per weekday: median over the last 8 weeks, at least 2 sessions', () => {
    expect(learnedGymMinutes(mondays, '2026-10-12', TZ)).toBe(18 * 60 + 10);
    expect(learnedGymMinutes([mondays[0]!], '2026-10-12', TZ)).toBeNull();
    // Other weekdays and sessions older than 8 weeks don't count.
    expect(learnedGymMinutes([mondays[0]!, session('2026-10-06', '07:00'), session('2026-08-10', '06:00')], '2026-10-12', TZ)).toBeNull();
    expect(learnedGymMinutes([mondays[0]!, session('2026-08-17', '18:20')], '2026-10-12', TZ)).toBe(18 * 60 + 10);
    // Each session's own time zone is used for its start time.
    expect(learnedGymMinutes([session('2026-10-05', '18:00', 'd1', 'UTC'), session('2026-09-28', '18:00', 'd1', 'UTC')], '2026-10-12', TZ)).toBe(22 * 60);
  });

  it('learned: due from (time - lead) until the time, naming the planned day', () => {
    const c = ctx({ sessions: mondays, program: program('weekdays') });
    const at = (hhmm: string) => keep(decide(row({ local_ts: `2026-10-12T${hhmm}:00`, routine_enabled: false, insight_enabled: false }), c));
    expect(at('17:54')).toEqual([]);
    expect(at('17:55')).toEqual([{ kind: 'gym', claimDate: '2026-10-12', payload: {
      title: 'Push in 15 minutes', body: 'Get ready. Tap to open your workout and log each set as you go.', tag: 'gym-2026-10-12', url: '/#/workout', kind: 'gym' } }]);
    expect(at('18:09')).toHaveLength(1);
    expect(at('18:10')).toEqual([]);
    // Not on a weekday without a learned time; not after already training today.
    expect(decide(row({ local_ts: '2026-10-13T17:58:00' }), c)).toEqual([]);
    expect(decide(row({ local_ts: '2026-10-12T18:00:00' }), ctx({ sessions: [...mondays, session('2026-10-12', '07:30')] }))).toEqual([]);
  });

  it('fixed: chosen weekdays and time; a rotation plan names the next day', () => {
    const r = row({ gym_mode: 'fixed', gym_days: [1, 3], gym_time: '19:00:00', lead_minutes: 30, routine_enabled: false, insight_enabled: false });
    const c = ctx({ program: program('rotation'), sessions: [session('2026-10-10', '10:00', 'd2')] });
    expect(keep(decide({ ...r, local_ts: '2026-10-12T18:30:00' }, c))[0]!.payload.title).toBe('Legs in 30 minutes');
    expect(decide({ ...r, local_ts: '2026-10-13T18:30:00' }, c)).toEqual([]);
    expect(keep(decide({ ...r, local_ts: '2026-10-14T18:45:00' }, ctx()))[0]!.payload.title).toBe('Gym time in 30 minutes');
    expect(plannedDayName(ctx({ program: program('weekdays') }), '2026-10-16')).toBe('Legs');
  });
});

describe('routine nudges', () => {
  const run = days('2026-10-11', 4).map((d, i) => meal(d, ['12:20', '12:30', '12:40', '12:30'][i]!));

  it('same preset and slot on 4 consecutive days ending yesterday → "Your usual X?" around the usual time', () => {
    const c = ctx({ meals: run });
    const r = row({ insight_enabled: false, gym_enabled: false });
    // median 12:30 → due 12:10 … 13:10
    expect(decide({ ...r, local_ts: '2026-10-12T12:09:00' }, c)).toEqual([]);
    const [d] = keep(decide({ ...r, local_ts: '2026-10-12T12:10:00' }, c));
    expect(d).toEqual({ kind: 'routine', claimDate: '2026-10-12', payload: {
      title: 'Your usual Dal chawal?', body: 'Tap Log it and it\'s done.', tag: 'routine-2026-10-12',
      url: '/#/quicklog/p-dal/lunch', kind: 'routine', actions: [{ action: 'log', title: 'Log it' }] } });
    expect(decide({ ...r, local_ts: '2026-10-12T13:10:00' }, c)).toHaveLength(1);
    expect(decide({ ...r, local_ts: '2026-10-12T13:11:00' }, c)).toEqual([]);
  });

  it('not when lunch is already logged today, the run is short or broken, or the slot differs', () => {
    const r = row({ insight_enabled: false, gym_enabled: false, local_ts: '2026-10-12T12:30:00' });
    expect(decide(r, ctx({ meals: [...run, meal('2026-10-12', '11:00', 'p-other')] }))).toEqual([]);
    expect(decide(r, ctx({ meals: run.slice(0, 3) }))).toEqual([]);
    expect(decide(r, ctx({ meals: [run[0]!, run[1]!, run[3]!, meal('2026-10-07', '12:30')] }))).toEqual([]);
    expect(decide(r, ctx({ meals: [...run.slice(0, 3), meal('2026-10-08', '12:30', 'p-dal', 'dinner')] }))).toEqual([]);
    expect(decide(r, ctx({ meals: run.map((m) => ({ ...m, preset_id: null })) }))).toEqual([]);
    // Dinner logged today doesn't block the lunch nudge.
    expect(decide(r, ctx({ meals: [...run, meal('2026-10-12', '08:00', 'p-x', 'breakfast')] }))).toHaveLength(1);
  });
});

describe('insights', () => {
  it('milestone: 7, 30 or 100 days in a row reached today, 18:00–21:30', () => {
    const c = ctx({ logged_dates: days('2026-10-14', 7) });
    const r = row({ routine_enabled: false, gym_enabled: false });
    expect(decide({ ...r, local_ts: '2026-10-14T17:59:00' }, c)).toEqual([]);
    expect(keep(decide({ ...r, local_ts: '2026-10-14T18:00:00' }, c))).toEqual([{ kind: 'insight', claimDate: '2026-10-14', payload: {
      title: '7 days in a row 🎉', body: 'Luma made you a little celebration card.', tag: 'milestone-2026-10-14', url: '/#/insights', kind: 'insight' } }]);
    expect(decide({ ...r, local_ts: '2026-10-14T21:29:00' }, c)).toHaveLength(1);
    expect(decide({ ...r, local_ts: '2026-10-14T21:30:00' }, c)).toEqual([]);
    expect(decide({ ...r, local_ts: '2026-10-14T19:00:00' }, ctx({ logged_dates: days('2026-10-14', 8) }))).toEqual([]);
    expect(keep(decide({ ...r, local_ts: '2026-10-14T19:00:00' }, ctx({ logged_dates: days('2026-10-14', 30) })))[0]!.payload.title).toBe('30 days in a row 🎉');
  });

  it('weekly recap: Sunday 18:00–21:00 when the week has 3+ logged days, claimed for that Monday', () => {
    const r = row({ routine_enabled: false, gym_enabled: false });
    const c = ctx({ logged_dates: ['2026-10-12', '2026-10-14', '2026-10-17', '2026-10-05'] });
    expect(keep(decide({ ...r, local_ts: '2026-10-18T18:30:00' }, c))).toEqual([{ kind: 'insight', claimDate: '2026-10-12', payload: {
      title: 'Luma found something in your week 👀', body: 'Your weekly recap is ready.', tag: 'weekly-2026-10-12', url: '/#/insights', kind: 'insight' } }]);
    expect(decide({ ...r, local_ts: '2026-10-18T21:00:00' }, c)).toEqual([]);
    expect(decide({ ...r, local_ts: '2026-10-17T18:30:00' }, c)).toEqual([]); // Saturday
    expect(decide({ ...r, local_ts: '2026-10-18T18:30:00' }, ctx({ logged_dates: ['2026-10-12', '2026-10-05', '2026-10-06'] }))).toEqual([]);
  });
});

describe('rules across kinds', () => {
  // Monday 18:00: a 7-day milestone, a learned gym time of 18:10 and a usual 18:05 dinner, all due.
  const all = ctx({
    logged_dates: days('2026-10-12', 7),
    sessions: [session('2026-10-05', '18:10'), session('2026-09-28', '18:10')],
    meals: days('2026-10-11', 4).map((d) => meal(d, '18:05', 'p-roti', 'dinner', 'Roti sabzi')),
  });
  const at = (over: Partial<CandidateRow> = {}) => decide(row({ local_ts: '2026-10-12T18:00:00', ...over }), all).map((d) => d.kind);

  it('priority insight > gym > routine; switches and stopped kinds are respected', () => {
    expect(at()).toEqual(['insight', 'gym', 'routine']);
    expect(at({ insight_enabled: false })).toEqual(['gym', 'routine']);
    expect(at({ stopped_kinds: ['gym', 'insight'] })).toEqual(['routine']);
    expect(at({ routine_enabled: false, gym_enabled: false, insight_enabled: false })).toEqual([]);
    expect(at({ sent_today: 2 })).toEqual([]);
  });

  it('quiet hours 22:00–07:00 local: nothing, whatever is due', () => {
    const late = row({ gym_mode: 'fixed', gym_days: [1], gym_time: '22:10:00', local_ts: '2026-10-12T22:00:00' });
    expect(decide(late, ctx())).toEqual([]);
    expect(decide({ ...late, gym_time: '07:05:00', local_ts: '2026-10-12T06:59:00' }, ctx())).toEqual([]);
    expect(decide({ ...late, gym_time: '07:05:00', local_ts: '2026-10-12T07:00:00' }, ctx())).toHaveLength(1);
  });

  it('hidden details: neutral lines only', () => {
    for (const p of [gymMessage(null, '2026-10-12', 15, true), routineMessage({ preset_id: 'p', slot: 'lunch', name: 'Roti' }, '2026-10-12', true),
      milestoneMessage(7, '2026-10-12', true), weeklyMessage('2026-10-12', true)]) {
      produced.push(p);
      expect(p).toMatchObject({ title: 'TrainLuma', body: 'Something\'s ready for you.' });
      expect(JSON.stringify(p)).not.toMatch(/Roti|\d+ (days|minutes)/);
    }
  });

  it('no line we can produce contains guilt, shame, comparison or urgency', () => {
    const strings: string[] = [];
    const walk = (v: unknown) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(COPY);
    for (const p of produced) strings.push(p.title, p.body, ...(p.actions ?? []).map((a) => a.title));
    expect(strings.length).toBeGreaterThan(20);
    for (const s of strings) expect(s).not.toMatch(BANNED_COPY);
    // The checker itself catches the phrases we ban.
    for (const bad of ['We miss you!', 'Don’t lose your streak', 'You skipped leg day', 'Where were you?', 'You missed yesterday', 'You’re in last place', 'Your worst week', 'Hurry, only 2 hours left']) {
      expect(bad).toMatch(BANNED_COPY);
    }
  });
});

const TARGETS = [{ endpoint: 'https://fcm.googleapis.com/fcm/send/a', p256dh: 'k', auth_secret: 's' }, { endpoint: 'https://fcm.googleapis.com/fcm/send/b', p256dh: 'k', auth_secret: 's' }];
function deps(rows: CandidateRow[], context: NotifyContext = ctx(), over: Partial<NotifyDeps> = {}) {
  // Like notify_claim: once per kind and date, at most 2 per person per tick-day.
  const claimed = new Set<string>();
  const perUser = new Map<string, number>();
  const d = {
    now: () => new Date('2026-10-12T22:00:00Z'),
    candidates: async () => rows,
    claim: vi.fn(async (u: string, k: string, dt: string) => {
      const key = `${u}|${k}|${dt}`;
      if (claimed.has(key) || (perUser.get(u) ?? 0) >= 2) return false;
      claimed.add(key);
      perUser.set(u, (perUser.get(u) ?? 0) + 1);
      return true;
    }),
    context: vi.fn(async () => context),
    targets: async () => TARGETS,
    send: vi.fn(async (t: { endpoint: string }) => (t.endpoint.endsWith('/b') ? { status: 410, gone: true } : { status: 201, gone: false })),
    result: vi.fn(async () => undefined),
    ...over,
  } satisfies NotifyDeps;
  return d;
}

describe('runNotify', () => {
  const busy = ctx({
    logged_dates: days('2026-10-12', 7),
    sessions: [session('2026-10-05', '18:10'), session('2026-09-28', '18:10')],
    meals: days('2026-10-11', 4).map((d) => meal(d, '18:05', 'p-roti', 'dinner', 'Roti sabzi')),
  });
  const r6 = (over: Partial<CandidateRow> = {}) => row({ local_ts: '2026-10-12T18:00:00', ...over });

  it('sends at most 2 − sent_today per tick, by priority, and drops devices the push service says are gone', async () => {
    const d = deps([r6()], busy);
    expect(await runNotify(d)).toEqual({ candidates: 1, due: 3, sent: 2, failed: 2, skipped: 0 });
    expect(d.claim.mock.calls.map((c) => c[1])).toEqual(['insight', 'gym']);
    expect(d.result).toHaveBeenCalledWith(TARGETS[1]!.endpoint, true);
    expect(d.result).toHaveBeenCalledWith(TARGETS[0]!.endpoint, false);
    const one = deps([r6({ sent_today: 1 })], busy);
    await runNotify(one);
    expect(one.claim.mock.calls.map((c) => c[1])).toEqual(['insight']);
  });

  it('a refused claim (already sent, or the database cap) does not use up the budget', async () => {
    const d = deps([r6()], busy, { claim: vi.fn(async (_u: string, k: string) => k !== 'insight') });
    const r = await runNotify(d);
    expect(r).toMatchObject({ skipped: 1, sent: 2 });
    expect(d.claim.mock.calls.map((c) => c[1])).toEqual(['insight', 'gym', 'routine']);
    // Overlapping ticks never double-send.
    const twice = deps([r6(), r6()], busy);
    expect(await runNotify(twice)).toMatchObject({ sent: 2, skipped: 3 });
  });

  it('hidden details: no records are read; only a fixed-time gym reminder can go out, neutrally', async () => {
    const d = deps([r6({ hide_details: true }), r6({ user_id: 'u2', hide_details: true, gym_mode: 'fixed', gym_days: [1], gym_time: '18:10:00' })], busy);
    const r = await runNotify(d);
    expect(d.context).not.toHaveBeenCalled();
    expect(r).toMatchObject({ candidates: 2, due: 1, sent: 1 });
    expect(d.send.mock.calls[0]![1]).toEqual({ title: 'TrainLuma', body: 'Something\'s ready for you.', tag: 'gym-2026-10-12', url: '/#/workout', kind: 'gym' });
  });

  it('skips people with nothing possible or in quiet hours; one failing person does not stop the others', async () => {
    const d = deps([
      r6({ user_id: 'off', routine_enabled: false, insight_enabled: false, gym_enabled: false }),
      r6({ user_id: 'night', local_ts: '2026-10-12T23:00:00' }),
      r6({ user_id: 'bad' }),
      r6({ user_id: 'ok' }),
    ], busy, { context: vi.fn(async (u: string) => { if (u === 'bad') throw new Error('db'); return busy; }) });
    const r = await runNotify(d);
    expect(d.context.mock.calls.map((c) => c[0])).toEqual(['bad', 'ok']);
    expect(r).toMatchObject({ candidates: 4, sent: 2, failed: 3 });
  });
});

describe('request handling', () => {
  const req = (auth?: string, method = 'POST') => new Request('https://x.supabase.co/functions/v1/notify', { method, headers: auth ? { authorization: auth } : {} });

  it('requires POST and the exact cron secret', async () => {
    expect((await handleNotifyRequest(req('Bearer s3cret', 'GET'), 's3cret', deps([]))).status).toBe(405);
    expect((await handleNotifyRequest(req(), 's3cret', deps([]))).status).toBe(401);
    expect((await handleNotifyRequest(req('Bearer wrong'), 's3cret', deps([]))).status).toBe(401);
    expect((await handleNotifyRequest(req('Bearer s3cret'), null, deps([]))).status).toBe(401);
    expect((await handleNotifyRequest(req('Bearer s3cret'), 's3cret', null)).status).toBe(503);
    const ok = await handleNotifyRequest(req('Bearer s3cret'), 's3cret', deps([]));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ candidates: 0, due: 0, sent: 0, failed: 0, skipped: 0 });
  });

  it('secret comparison handles different lengths', () => {
    expect(secretMatches('abc', 'abcd')).toBe(false);
    expect(secretMatches('abcd', 'abcd')).toBe(true);
  });
});
