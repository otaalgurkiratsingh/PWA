import { describe, expect, it, vi } from 'vitest';
import { gymMessage, handleNotifyRequest, motivationMessage, plannedDayName, runNotify, secretMatches, type DueRow, type NotifyContext, type NotifyDeps } from './notify.ts';

const set = (load: number) => ({ status: 'completed', actual: { reps: 5, load, unit: 'kg' } });
const session = (date: string, loads: number[], day_id = 'd1') => ({
  status: 'finished', local_date: date, day_id, day_name: 'x',
  exercises: [{ exercise_key: 'squat', name: 'Back squat', sets: loads.map(set) }],
});
const ctx = (over: Partial<NotifyContext> = {}): NotifyContext => ({ training: { sessions_per_week: 3 }, sessions: [], meal_dates: [], program: null, ...over });
const program = (schedule: 'weekdays' | 'rotation') => ({
  name: 'Plan', schedule,
  days: [{ id: 'd1', name: 'Push', weekday: 1 }, { id: 'd2', name: 'Pull', weekday: 3 }, { id: 'd3', name: 'Legs', weekday: 5 }],
});

describe('messages', () => {
  it('motivation celebrates a new best from backed-up workouts', () => {
    const m = motivationMessage(ctx({ sessions: [session('2026-09-20', [80]), session('2026-10-10', [85])] }), '2026-10-12', false);
    expect(m.title).toBe('You’re getting stronger');
    expect(m.body).toContain('Back squat at 85 kg');
    expect(m.url).toBe('/#/today');
    expect(m.tag).toBe('motivation-2026-10-12');
  });

  it('a brand-new person gets a kind starter that varies by date, never a guilt trip', () => {
    const a = motivationMessage(ctx(), '2026-10-12', false);
    const b = motivationMessage(ctx(), '2026-10-13', false);
    expect(a.body).not.toBe(b.body);
    expect(`${a.title} ${a.body} ${b.body}`).not.toMatch(/fail|lazy|missed|should have/i);
  });

  it('hidden details show only a neutral line on the lock screen', () => {
    const m = motivationMessage(ctx({ sessions: [session('2026-10-10', [85])] }), '2026-10-12', true);
    expect(m.body).not.toMatch(/\d/);
    expect(gymMessage(ctx({ program: program('weekdays') }), '2026-10-12', 15, true)).toMatchObject({ title: 'Workout reminder', body: 'Your session starts in 15 minutes.' });
  });

  it('malformed synced documents are ignored rather than crashing the tick', () => {
    const m = motivationMessage(ctx({ sessions: [null, 7, { status: 'finished', local_date: 'nope' }, { status: 'finished', local_date: '2026-10-10', exercises: [{ exercise_key: 1 }] }], meal_dates: ['2026-10-11', 5] }), '2026-10-12', false);
    expect(m.title).toBeTruthy();
  });

  it('gym reminder names the planned day by weekday or rotation', () => {
    // 2026-10-12 is a Monday.
    expect(gymMessage(ctx({ program: program('weekdays') }), '2026-10-12', 15, false).title).toBe('Push in 15 minutes');
    expect(plannedDayName(ctx({ program: program('rotation'), sessions: [session('2026-10-10', [80], 'd2')] }), '2026-10-12')).toBe('Legs');
    expect(gymMessage(ctx(), '2026-10-12', 10, false).title).toBe('Gym time in 10 minutes');
    expect(gymMessage(null, '2026-10-12', 15, false).url).toBe('/#/workout');
  });
});

function deps(rows: DueRow[], over: Partial<NotifyDeps> = {}) {
  const claimed = new Set<string>();
  const d: NotifyDeps = {
    now: () => new Date('2026-10-12T12:10:00Z'),
    due: async () => rows,
    claim: async (u, k, dt) => { const key = `${u}|${k}|${dt}`; if (claimed.has(key)) return false; claimed.add(key); return true; },
    context: vi.fn(async () => ctx()),
    targets: async () => [{ endpoint: 'https://fcm.googleapis.com/fcm/send/a', p256dh: 'k', auth_secret: 's' }, { endpoint: 'https://fcm.googleapis.com/fcm/send/b', p256dh: 'k', auth_secret: 's' }],
    send: vi.fn(async (t) => (t.endpoint.endsWith('/b') ? { status: 410, gone: true } : { status: 201, gone: false })),
    result: vi.fn(async () => undefined),
    ...over,
  };
  return d;
}
const row = (over: Partial<DueRow> = {}): DueRow => ({ user_id: 'u1', kind: 'motivation', local_date: '2026-10-12', hide_details: false, lead_minutes: 15, timezone: 'UTC', ...over });

describe('runNotify', () => {
  it('claims once, sends to every device, and drops devices the push service says are gone', async () => {
    const d = deps([row(), row()]);
    const r = await runNotify(d);
    expect(r).toEqual({ due: 2, sent: 1, failed: 1, skipped: 1 });
    expect(d.result).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/b', true);
    expect(d.result).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/a', false);
  });

  it('does not read any records when details are hidden', async () => {
    const d = deps([row({ hide_details: true }), row({ kind: 'gym', hide_details: true })]);
    await runNotify(d);
    expect(d.context).not.toHaveBeenCalled();
  });

  it('one failing person does not stop the others', async () => {
    const d = deps([row({ user_id: 'bad' }), row({ user_id: 'ok' })], {
      context: async (u) => { if (u === 'bad') throw new Error('db'); return ctx(); },
    });
    const r = await runNotify(d);
    expect(r.sent).toBe(1);
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
    expect(await ok.json()).toEqual({ due: 0, sent: 0, failed: 0, skipped: 0 });
  });

  it('secret comparison handles different lengths', () => {
    expect(secretMatches('abc', 'abcd')).toBe(false);
    expect(secretMatches('abcd', 'abcd')).toBe(true);
  });
});
