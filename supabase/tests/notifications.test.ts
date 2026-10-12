/**
 * Notifications (migration 20261012000004): device subscriptions, preferences, due-time windows
 * across time zones, once-per-day claims, service-only RPCs and clean-up when access ends.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const A = randomUUID();
const B = randomUUID();
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
const prefs = (u: string, values: string) => as('authenticated', u, `insert into public.notification_prefs (user_id, timezone, motivation_enabled, motivation_time, gym_enabled, gym_days, gym_time, lead_minutes)
  values ($1, ${values}) on conflict (user_id) do update set timezone = excluded.timezone, motivation_enabled = excluded.motivation_enabled, motivation_time = excluded.motivation_time,
  gym_enabled = excluded.gym_enabled, gym_days = excluded.gym_days, gym_time = excluded.gym_time, lead_minutes = excluded.lead_minutes`, [u]);
const due = (at: string) => as<{ user_id: string; kind: string; local_date: string }>('service_role', null,
  `select user_id, kind, to_char(local_date, 'YYYY-MM-DD') local_date from public.notify_due($1::timestamptz)`, [at]).then((r) => r.rows);
const mine = (rows: { user_id: string; kind: string; local_date: string }[], u: string) => rows.filter((r) => r.user_id === u).map((r) => `${r.kind}@${r.local_date}`).sort();

beforeAll(async () => {
  db = new pg.Client();
  await db.connect();
  await db.query(`insert into auth.users (id) values ($1),($2),($3)`, [A, B, R]);
  await db.query(`insert into private.approved_members (user_id, status) values ($1,'active'),($2,'active'),($3,'active')`, [A, B, R]);
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

  it('preferences are owner-only, the owner is forced, and the time zone must be real', async () => {
    await prefs(A, `'America/Toronto', true, '08:00', true, '{1,3,5,5}', '18:00', 15`);
    // B tries to write A's row: the owner is replaced by B's id, so A's row is untouched.
    await prefs(B, `'Asia/Kolkata', true, '07:00', false, '{}', '18:00', 15`);
    const rows = await db.query(`select user_id, timezone, gym_days from public.notification_prefs order by timezone`);
    expect(rows.rows.map((r) => r.timezone)).toEqual(['America/Toronto', 'Asia/Kolkata']);
    expect(rows.rows[0].gym_days).toEqual([1, 3, 5]);
    expect((await as('authenticated', B, `select * from public.notification_prefs`)).rows.map((r) => r.user_id)).toEqual([B]);
    await expect(prefs(A, `'Mars/Olympus', true, '08:00', false, '{}', '18:00', 15`)).rejects.toThrow(/unknown time zone/);
    await expect(prefs(A, `'UTC', true, '08:00', false, '{9}', '18:00', 15`)).rejects.toThrow(/check constraint/);
    await expect(prefs(A, `'UTC', true, '08:00', false, '{}', '18:00', 2`)).rejects.toThrow(/check constraint/);
  });
});

describe('due windows', () => {
  it('motivation is due in the 30 minutes after the person’s own local time', async () => {
    await prefs(A, `'America/Toronto', true, '08:00', false, '{}', '18:00', 15`);
    // 08:10 in Toronto (EDT, UTC-4) = 12:10Z
    expect(mine(await due('2026-10-12T12:10:00Z'), A)).toEqual(['motivation@2026-10-12']);
    expect(mine(await due('2026-10-12T11:59:00Z'), A)).toEqual([]);
    expect(mine(await due('2026-10-12T12:31:00Z'), A)).toEqual([]);
  });

  it('gym reminder: 15 minutes before, only on chosen weekdays', async () => {
    // 2026-10-12 is a Monday (dow 1).
    await prefs(A, `'America/Toronto', false, '08:00', true, '{1,3}', '18:00', 15`);
    expect(mine(await due('2026-10-12T21:45:00Z'), A)).toEqual(['gym@2026-10-12']); // 17:45 local
    expect(mine(await due('2026-10-12T21:59:00Z'), A)).toEqual(['gym@2026-10-12']);
    expect(mine(await due('2026-10-12T22:00:00Z'), A)).toEqual([]); // gym time itself: too late
    expect(mine(await due('2026-10-12T21:40:00Z'), A)).toEqual([]);
    expect(mine(await due('2026-10-13T21:45:00Z'), A)).toEqual([]); // Tuesday not chosen
  });

  it('a gym time just after midnight reminds late the evening before, dated the gym day', async () => {
    await prefs(A, `'UTC', false, '08:00', true, '{2}', '00:05', 15`);
    expect(mine(await due('2026-10-12T23:55:00Z'), A)).toEqual(['gym@2026-10-13']);
  });

  it('each person’s own time zone decides; no device or not active → nothing due', async () => {
    await prefs(B, `'Asia/Kolkata', true, '07:00', false, '{}', '18:00', 15`);
    // 07:05 IST = 01:35Z
    expect(mine(await due('2026-10-12T01:35:00Z'), B)).toEqual(['motivation@2026-10-12']);
    await as('authenticated', B, `select public.delete_push_subscription(null)`);
    expect(mine(await due('2026-10-12T01:35:00Z'), B)).toEqual([]);
  });

  it('a claim succeeds once per kind per local day (cron overlap never double-sends)', async () => {
    const claim = () => as<{ ok: boolean }>('service_role', null, `select public.notify_claim($1, 'motivation', '2026-10-12') ok`, [A]).then((r) => r.rows[0]!.ok);
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
  });
});

describe('service-only access and clean-up', () => {
  it('members cannot call the sender RPCs or read anyone’s context', async () => {
    for (const sql of [
      `select * from public.notify_due(now())`,
      `select public.notify_claim('${A}', 'gym', current_date)`,
      `select public.notify_context('${A}', current_date)`,
      `select * from public.notify_subscriptions('${A}')`,
      `select public.notify_result('x', true)`,
    ]) {
      await expect(as('authenticated', B, sql)).rejects.toThrow(/permission denied/);
      await expect(as('anon', null, sql)).rejects.toThrow(/permission denied/);
    }
  });

  it('context holds only the person’s own finished workouts, meal dates, plan and target', async () => {
    const doc = (u: string, col: string, id: string, body: object) => db.query(
      `insert into public.journal_documents (user_id, collection, doc_id, version, change_seq, body) values ($1, $2, $3, 1, 1, $4)`, [u, col, id, JSON.stringify(body)]);
    await doc(A, 'workout_sessions', 's1', { status: 'finished', local_date: '2026-10-10', day_name: 'Legs' });
    await doc(A, 'workout_sessions', 's2', { status: 'active', local_date: '2026-10-12' });
    await doc(A, 'meal_entries', 'm1', { local_date: '2026-10-11', name: 'Roti' });
    await doc(B, 'workout_sessions', 'sb', { status: 'finished', local_date: '2026-10-11' });
    await doc(A, 'settings', 'profile', { profile: { training: { sessions_per_week: 3 }, nickname: 'Private name' } });
    const ctx = (await as<{ c: { sessions: { local_date: string }[]; meal_dates: string[]; training: { sessions_per_week: number } } }>(
      'service_role', null, `select public.notify_context($1, '2026-10-12') c`, [A])).rows[0]!.c;
    expect(ctx.sessions.map((s) => s.local_date)).toEqual(['2026-10-10']);
    expect(ctx.meal_dates).toEqual(['2026-10-11']);
    expect(ctx.training).toEqual({ sessions_per_week: 3 });
    expect(JSON.stringify(ctx)).not.toContain('Private name');
    expect(JSON.stringify(ctx)).not.toContain('Roti');
  });

  it('an expired device is dropped; a revoked member loses devices and preferences at once', async () => {
    await subscribe(R, 'r1');
    await subscribe(R, 'r2');
    await prefs(R, `'UTC', true, '08:00', false, '{}', '18:00', 15`);
    await as('service_role', null, `select public.notify_result($1, true)`, [endpoint('r1')]);
    expect((await db.query(`select endpoint from public.push_subscriptions where user_id = $1`, [R])).rows.map((r) => r.endpoint)).toEqual([endpoint('r2')]);
    await db.query(`update private.approved_members set status = 'revoked' where user_id = $1`, [R]);
    expect((await db.query(`select 1 from public.push_subscriptions where user_id = $1`, [R])).rowCount).toBe(0);
    expect((await db.query(`select 1 from public.notification_prefs where user_id = $1`, [R])).rowCount).toBe(0);
  });
});
