/**
 * Notifications (migrations 20261012000004 + 20261013000005 v2): device subscriptions, preferences,
 * candidates (quiet hours, 2 per local day, kinds stopped after 3 dismissals), claims, the
 * decision context, service-only RPCs and clean-up when access ends.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const A = randomUUID();
const B = randomUUID();
const C = randomUUID(); // daily cap
const R = randomUUID(); // will be revoked
let db: pg.Client;

async function as<T extends pg.QueryResultRow = pg.QueryResultRow>(role: 'authenticated' | 'anon' | 'service_role', sub: string | null, sql: string, params: unknown[] = []) {
  await db.query('begin');
  try {
    await db.query(`set local role ${role}`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role } : { role })]);
    const r = await db.query<T>(sql, params);
    await db.query('commit');
    return r;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}

const P256 = 'B' + 'x'.repeat(86); // 87 chars like a real base64url P-256 key
const AUTH = 'a'.repeat(22);
const endpoint = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}-${'z'.repeat(20)}`;
const subscribe = (u: string, n: string) => as('authenticated', u, `select public.save_push_subscription($1, $2, $3)`, [endpoint(n), P256, AUTH]);
// values: timezone, routine_enabled, insight_enabled, gym_enabled, gym_mode, gym_days, gym_time, lead_minutes
const prefs = (u: string, values: string) => as('authenticated', u, `insert into public.notification_prefs (user_id, timezone, routine_enabled, insight_enabled, gym_enabled, gym_mode, gym_days, gym_time, lead_minutes)
  values ($1, ${values}) on conflict (user_id) do update set timezone = excluded.timezone, routine_enabled = excluded.routine_enabled, insight_enabled = excluded.insight_enabled,
  gym_enabled = excluded.gym_enabled, gym_mode = excluded.gym_mode, gym_days = excluded.gym_days, gym_time = excluded.gym_time, lead_minutes = excluded.lead_minutes`, [u]);
interface Candidate { user_id: string; timezone: string; local_ts: string; gym_mode: string; sent_today: number; stopped_kinds: string[]; routine_enabled: boolean }
const candidates = (at: string) => as<Candidate>('service_role', null,
  `select user_id, timezone, to_char(local_ts, 'YYYY-MM-DD"T"HH24:MI') local_ts, gym_mode, sent_today, stopped_kinds, routine_enabled from public.notify_candidates($1::timestamptz)`, [at]).then((r) => r.rows);
const mine = async (at: string, u: string) => (await candidates(at)).find((r) => r.user_id === u) ?? null;
const claim = (u: string, kind: string, date: string) => as<{ ok: boolean }>('service_role', null, `select public.notify_claim($1, $2, $3::date) ok`, [u, kind, date]).then((r) => r.rows[0]!.ok);
const dismiss = (u: string, kind: string) => as<{ n: number }>('authenticated', u, `select public.notification_dismissed($1) n`, [kind]).then((r) => r.rows[0]!.n);

beforeAll(async () => {
  db = new pg.Client();
  await db.connect();
  await db.query(`insert into auth.users (id) values ($1),($2),($3),($4)`, [A, B, C, R]);
  await db.query(`insert into private.approved_members (user_id, status) values ($1,'active'),($2,'active'),($3,'active'),($4,'active')`, [A, B, C, R]);
});
afterAll(async () => db?.end());

describe('devices and preferences', () => {
  it('a member saves a device idempotently and sees only their own devices', async () => {
    await subscribe(A, 'a1');
    await subscribe(A, 'a1');
    await subscribe(B, 'b1');
    expect((await as('authenticated', A, `select endpoint from public.push_subscriptions`)).rows.map((r) => r.endpoint)).toEqual([endpoint('a1')]);
    await expect(as('authenticated', A, `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_secret) values ($1, $2, $3, $4)`, [A, endpoint('x'), P256, AUTH])).rejects.toThrow(/permission denied/);
  });

  it('a device endpoint moves to whoever signs in on that phone (one device notifies one person)', async () => {
    await subscribe(B, 'shared');
    await subscribe(A, 'shared');
    const owner = await db.query(`select user_id from public.push_subscriptions where endpoint = $1`, [endpoint('shared')]);
    expect(owner.rows[0].user_id).toBe(A);
    await as('authenticated', A, `select public.delete_push_subscription($1)`, [endpoint('shared')]);
    expect((await db.query(`select 1 from public.push_subscriptions where endpoint = $1`, [endpoint('shared')])).rowCount).toBe(0);
  });

  it('only https endpoints are accepted; anon and non-members are refused', async () => {
    await expect(as('authenticated', A, `select public.save_push_subscription('http://evil.example/x/aaaaaaaaaaaaaaaaaaaa', $1, $2)`, [P256, AUTH])).rejects.toThrow(/check constraint/);
    await expect(as('anon', null, `select public.save_push_subscription($1, $2, $3)`, [endpoint('n'), P256, AUTH])).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', randomUUID(), `select public.save_push_subscription($1, $2, $3)`, [endpoint('n'), P256, AUTH])).rejects.toThrow(/not authorized/);
  });

  it('preferences are owner-only, the time zone must be real, and v2 defaults are on/learned', async () => {
    await prefs(A, `'America/Toronto', true, true, true, 'fixed', '{1,3,5,5}', '18:00', 15`);
    await prefs(B, `'Asia/Kolkata', true, true, false, 'learned', '{}', '18:00', 15`);
    const rows = await db.query(`select user_id, timezone, gym_days from public.notification_prefs where user_id = any($1) order by timezone`, [[A, B]]);
    expect(rows.rows.map((r) => r.timezone)).toEqual(['America/Toronto', 'Asia/Kolkata']);
    expect(rows.rows[0].gym_days).toEqual([1, 3, 5]);
    expect((await as('authenticated', B, `select * from public.notification_prefs`)).rows.map((r) => r.user_id)).toEqual([B]);
    await expect(prefs(A, `'Mars/Olympus', true, true, false, 'learned', '{}', '18:00', 15`)).rejects.toThrow(/unknown time zone/);
    await expect(prefs(A, `'UTC', true, true, false, 'learned', '{9}', '18:00', 15`)).rejects.toThrow(/check constraint/);
    await expect(prefs(A, `'UTC', true, true, false, 'learned', '{}', '18:00', 2`)).rejects.toThrow(/check constraint/);
    await expect(prefs(A, `'UTC', true, true, false, 'sometimes', '{}', '18:00', 15`)).rejects.toThrow(/check constraint/);
    await as('authenticated', R, `insert into public.notification_prefs (user_id, timezone) values ($1, 'UTC')`, [R]);
    const d = await db.query(`select routine_enabled, insight_enabled, gym_mode, motivation_enabled from public.notification_prefs where user_id = $1`, [R]);
    expect(d.rows[0]).toEqual({ routine_enabled: true, insight_enabled: true, gym_mode: 'learned', motivation_enabled: false });
  });
});

describe('candidates', () => {
  it('awake hours in the person’s own time zone only (quiet 22:00–07:00)', async () => {
    await prefs(A, `'America/Toronto', true, true, false, 'learned', '{}', '18:00', 15`);
    // Toronto is UTC-4 in October.
    expect(await mine('2026-10-12T11:00:00Z', A)).toMatchObject({ local_ts: '2026-10-12T07:00', timezone: 'America/Toronto', gym_mode: 'learned', sent_today: 0, stopped_kinds: [] });
    expect(await mine('2026-10-12T10:59:00Z', A)).toBeNull(); // 06:59
    expect(await mine('2026-10-13T01:59:00Z', A)).toMatchObject({ local_ts: '2026-10-12T21:59' });
    expect(await mine('2026-10-13T02:00:00Z', A)).toBeNull(); // 22:00
    expect(await mine('2026-10-13T06:00:00Z', A)).toBeNull(); // 02:00
  });

  it('nobody without a device, with every kind off, or not active', async () => {
    await prefs(B, `'Asia/Kolkata', true, true, false, 'learned', '{}', '18:00', 15`);
    expect(await mine('2026-10-12T06:00:00Z', B)).not.toBeNull(); // 11:30 IST
    await prefs(B, `'Asia/Kolkata', false, false, false, 'learned', '{}', '18:00', 15`);
    expect(await mine('2026-10-12T06:00:00Z', B)).toBeNull();
    await prefs(B, `'Asia/Kolkata', true, false, false, 'learned', '{}', '18:00', 15`);
    await as('authenticated', B, `select public.delete_push_subscription(null)`);
    expect(await mine('2026-10-12T06:00:00Z', B)).toBeNull();
  });

  it('two sent on the local day → no longer a candidate that day', async () => {
    await prefs(A, `'America/Toronto', true, true, false, 'learned', '{}', '18:00', 15`);
    await db.query(`insert into private.notification_log (user_id, kind, local_date, sent_at) values ($1, 'routine', '2026-09-01', '2026-09-01T12:00:00Z')`, [A]);
    expect(await mine('2026-09-01T20:00:00Z', A)).toMatchObject({ sent_today: 1 });
    // The weekly insight is keyed by Monday but still counts for the day it was sent.
    await db.query(`insert into private.notification_log (user_id, kind, local_date, sent_at) values ($1, 'insight', '2026-08-31', '2026-09-01T13:00:00Z')`, [A]);
    expect(await mine('2026-09-01T20:00:00Z', A)).toBeNull();
    // Next local day (Toronto): fresh start.
    expect(await mine('2026-09-02T12:00:00Z', A)).toMatchObject({ sent_today: 0 });
  });

  it('a kind dismissed 3 times is listed as stopped (cumulative)', async () => {
    expect(await dismiss(A, 'routine')).toBe(1);
    expect(await dismiss(A, 'routine')).toBe(2);
    expect((await mine('2026-10-12T16:00:00Z', A))!.stopped_kinds).toEqual([]);
    expect(await dismiss(A, 'routine')).toBe(3);
    expect(await dismiss(A, 'gym')).toBe(1);
    expect((await mine('2026-10-12T16:00:00Z', A))!.stopped_kinds).toEqual(['routine']);
    await expect(dismiss(A, 'motivation')).rejects.toThrow(/unknown notification kind/);
    await expect(as('anon', null, `select public.notification_dismissed('gym')`)).rejects.toThrow(/permission denied/);
    // Own counts are readable; nobody else's.
    expect((await as('authenticated', B, `select * from public.notification_dismissals`)).rowCount).toBe(0);
    expect((await as('authenticated', A, `select kind, count from public.notification_dismissals order by kind`)).rows).toEqual([{ kind: 'gym', count: 1 }, { kind: 'routine', count: 3 }]);
  });
});

describe('claims', () => {
  it('once per kind per claim date; stopped kinds and the retired motivation are refused', async () => {
    expect(await claim(A, 'gym', '2026-10-12')).toBe(true);
    expect(await claim(A, 'gym', '2026-10-12')).toBe(false);
    expect(await claim(A, 'routine', '2026-10-12')).toBe(false); // dismissed 3 times
    expect(await claim(A, 'motivation', '2026-10-12')).toBe(false);
  });

  it('never more than 2 per local day, even across kinds and claim dates', async () => {
    await prefs(C, `'UTC', true, true, true, 'learned', '{}', '18:00', 15`);
    expect(await claim(C, 'routine', '2026-10-12')).toBe(true);
    expect(await claim(C, 'insight', '2026-10-05')).toBe(true);
    expect(await claim(C, 'gym', '2026-10-12')).toBe(false);
    expect(await claim(randomUUID(), 'gym', '2026-10-12')).toBe(false); // no preferences
  });
});

describe('service-only access and clean-up', () => {
  it('members cannot call the sender RPCs or read anyone’s context; v1 notify_due is gone', async () => {
    for (const sql of [
      `select * from public.notify_candidates(now())`,
      `select public.notify_claim('${A}', 'gym', current_date)`,
      `select public.notify_context('${A}', current_date)`,
      `select * from public.notify_subscriptions('${A}')`,
      `select public.notify_result('x', true)`,
    ]) {
      await expect(as('authenticated', B, sql)).rejects.toThrow(/permission denied/);
      await expect(as('anon', null, sql)).rejects.toThrow(/permission denied/);
    }
    await expect(as('service_role', null, `select * from public.notify_due(now())`)).rejects.toThrow(/does not exist/);
  });

  it('context holds only the person’s own finished workouts, recent meals, logged dates, plan and target', async () => {
    const doc = (u: string, col: string, id: string, body: object, deleted = false) => db.query(
      `insert into public.journal_documents (user_id, collection, doc_id, version, change_seq, body, deleted_at) values ($1, $2, $3, 1, 1, $4, $5)`,
      [u, col, id, JSON.stringify(body), deleted ? new Date() : null]);
    await doc(A, 'workout_sessions', 's1', { status: 'finished', local_date: '2026-10-10', day_id: 'd1', day_name: 'Legs', started_at: '2026-10-10T22:05:00Z', timezone: 'America/Toronto', exercises: [{ name: 'Secret lift' }] });
    await doc(A, 'workout_sessions', 's2', { status: 'active', local_date: '2026-10-12' });
    await doc(A, 'meal_entries', 'm1', { local_date: '2026-10-11', name: 'Roti', preset_id: 'p1', slot: 'lunch', logged_at: '2026-10-11T16:30:00Z', timezone: 'America/Toronto', items: [{ name: 'Secret item' }] });
    await doc(A, 'meal_entries', 'm2', { local_date: '2026-09-01', name: 'Old meal', slot: 'lunch' });
    await doc(A, 'meal_entries', 'm3', { local_date: '2026-10-09', name: 'Deleted meal', slot: 'lunch' }, true);
    await doc(B, 'workout_sessions', 'sb', { status: 'finished', local_date: '2026-10-11' });
    await doc(B, 'meal_entries', 'mb', { local_date: '2026-10-11', name: 'Other person' });
    await doc(A, 'settings', 'profile', { profile: { training: { sessions_per_week: 3 }, nickname: 'Private name' } });
    await db.query(`insert into public.analytics_events (user_id, event, local_date) values ($1, 'food_logged', '2026-10-08'), ($1, 'app_open', '2026-10-07')`, [A]);
    type Ctx = { sessions: Record<string, unknown>[]; meals: Record<string, unknown>[]; logged_dates: string[]; meal_dates: string[]; training: { sessions_per_week: number } };
    const ctx = (await as<{ c: Ctx }>('service_role', null, `select public.notify_context($1, '2026-10-12') c`, [A])).rows[0]!.c;
    expect(ctx.sessions).toEqual([{ status: 'finished', local_date: '2026-10-10', day_id: 'd1', day_name: 'Legs', started_at: '2026-10-10T22:05:00Z', timezone: 'America/Toronto' }]);
    expect(ctx.meals).toEqual([{ local_date: '2026-10-11', preset_id: 'p1', name: 'Roti', slot: 'lunch', logged_at: '2026-10-11T16:30:00Z', timezone: 'America/Toronto' }]);
    expect(ctx.logged_dates).toEqual(['2026-09-01', '2026-10-08', '2026-10-10', '2026-10-11']);
    expect(ctx.training).toEqual({ sessions_per_week: 3 });
    const text = JSON.stringify(ctx);
    for (const s of ['Private name', 'Secret lift', 'Secret item', 'Other person', 'Deleted meal']) expect(text).not.toContain(s);
  });

  it('an expired device is dropped; a revoked member loses devices, preferences and dismissals at once', async () => {
    await subscribe(R, 'r1');
    await subscribe(R, 'r2');
    await dismiss(R, 'insight');
    await as('service_role', null, `select public.notify_result($1, true)`, [endpoint('r1')]);
    expect((await db.query(`select endpoint from public.push_subscriptions where user_id = $1`, [R])).rows.map((r) => r.endpoint)).toEqual([endpoint('r2')]);
    await db.query(`update private.approved_members set status = 'revoked' where user_id = $1`, [R]);
    expect((await db.query(`select 1 from public.push_subscriptions where user_id = $1`, [R])).rowCount).toBe(0);
    expect((await db.query(`select 1 from public.notification_prefs where user_id = $1`, [R])).rowCount).toBe(0);
    expect((await db.query(`select 1 from public.notification_dismissals where user_id = $1`, [R])).rowCount).toBe(0);
  });
});
