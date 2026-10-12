/**
 * Phase 3 growth (migration 20261013000005): first-party analytics, food requests, circles,
 * referral credits, owner-only views and clean-up when access ends.
 * Notifications v2 (candidates, claims, dismissals) are covered in notifications.test.ts.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: pg.Client;
let today = '';
const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'R', 'X'] as const;
// X never becomes a member; R is revoked; M deletes their account.
const U = Object.fromEntries(NAMES.map((k) => [k, randomUUID()])) as Record<(typeof NAMES)[number], string>;

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
const one = async <T>(u: string | null, sql: string, params: unknown[] = []) =>
  (await as<{ v: T }>(u ? 'authenticated' : 'anon', u, sql, params)).rows[0]!.v;
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
// An event recorded at noon UTC on the day it describes (what a phone online that day sends).
const logged = (u: string, event: string, date: string, recordedOn = date) => db.query(
  `insert into public.analytics_events (user_id, event, local_date, created_at) values ($1, $2, $3::date, ($4::date + time '12:00') at time zone 'utc')`, [u, event, date, recordedOn]);
const doc = (u: string, col: string, id: string, body: object) => db.query(
  `insert into public.journal_documents (user_id, collection, doc_id, version, change_seq, body) values ($1, $2, $3, 1, 1, $4)`, [u, col, id, JSON.stringify(body)]);

beforeAll(async () => {
  db = new pg.Client();
  await db.connect();
  const ids = Object.values(U);
  await db.query(`insert into auth.users (id) select unnest($1::uuid[])`, [ids]);
  await db.query(`insert into private.approved_members (user_id, status) select unnest($1::uuid[]), 'active'`, [ids.filter((id) => id !== U.X)]);
  today = (await db.query(`select to_char(current_date, 'YYYY-MM-DD') d`)).rows[0].d;
});
afterAll(async () => db?.end());

describe('analytics', () => {
  const ev = (event: string, props: unknown = {}, extra: object = {}) => ({ event, props, client_ts: new Date().toISOString(), local_date: today, ...extra });
  const log = (u: string, events: unknown) => one<number>(u, `select public.log_events($1::jsonb) v`, [JSON.stringify(events)]);
  const count = async (u: string) => Number((await db.query(`select count(*) n from public.analytics_events where user_id = $1`, [u])).rows[0].n);

  it('stores valid events for the caller and returns how many were stored', async () => {
    expect(await log(U.A, [ev('app_open'), ev('food_logged', { zero_typing: true, method: 'preset' })])).toBe(2);
    const rows = await db.query(`select user_id, event, props, to_char(local_date, 'YYYY-MM-DD') local_date, client_ts from public.analytics_events where user_id = $1 order by id`, [U.A]);
    expect(rows.rows.map((r) => r.event)).toEqual(['app_open', 'food_logged']);
    expect(rows.rows[1]).toMatchObject({ user_id: U.A, props: { zero_typing: true, method: 'preset' }, local_date: today });
    expect(await log(U.A, [])).toBe(0);
  });

  it('missing props become {}; junk dates and timestamps become null', async () => {
    expect(await log(U.B, [{ event: 'app_open' }, { event: 'app_open', local_date: '2026-02-30', client_ts: 'yesterday-ish' }, { event: 'app_open', local_date: '1999-01-01' }])).toBe(3);
    const rows = await db.query(`select props, local_date, client_ts from public.analytics_events where user_id = $1`, [U.B]);
    expect(rows.rows.every((r) => JSON.stringify(r.props) === '{}' && r.local_date === null && r.client_ts === null)).toBe(true);
  });

  it('rejects bad names, non-object or oversized props, and batches over 100 (nothing stored)', async () => {
    const before = await count(U.A);
    for (const bad of [
      [ev('App_Open')], [ev('ab')], [ev('9lives')], [ev('x'.repeat(41))], [ev('has-dash')], [ev('ok_event'), { props: {} }],
      [ev('ok_event', [1, 2])], [ev('ok_event', 'text')], [ev('ok_event', { blob: 'x'.repeat(2000) })], ['app_open'],
    ]) {
      await expect(log(U.A, bad)).rejects.toThrow(/invalid event name|props must be/);
    }
    await expect(log(U.A, Array.from({ length: 101 }, () => ev('app_open')))).rejects.toThrow(/at most 100/);
    await expect(log(U.A, { event: 'app_open' })).rejects.toThrow(/array/);
    expect(await count(U.A)).toBe(before);
  });

  it('caps at 3000 events per person per UTC day; the excess is dropped silently', async () => {
    await db.query(`insert into public.analytics_events (user_id, event) select $1, 'screen_view' from generate_series(1, 2995)`, [U.C]);
    expect(await log(U.C, Array.from({ length: 10 }, () => ev('app_open')))).toBe(5);
    expect(await log(U.C, [ev('app_open')])).toBe(0);
    expect(await count(U.C)).toBe(3000);
    // Yesterday's events don't count toward today.
    await db.query(`update public.analytics_events set created_at = now() - interval '2 days' where user_id = $1`, [U.C]);
    expect(await log(U.C, [ev('app_open')])).toBe(1);
  });

  it('clients cannot read or write the table directly; anon and non-members cannot log', async () => {
    await expect(as('authenticated', U.A, `select * from public.analytics_events`)).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', U.A, `insert into public.analytics_events (user_id, event) values ($1, 'app_open')`, [U.A])).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', U.A, `select nextval('public.analytics_events_id_seq')`)).rejects.toThrow(/permission denied/);
    await expect(as('anon', null, `select public.log_events('[]')`)).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', U.X, `select public.log_events('[]')`)).rejects.toThrow(/not authorized/);
  });

  it('owner views and private helpers are closed to clients', async () => {
    for (const sql of [
      `select * from private.v_events_daily`, `select * from private.v_zero_typing_daily`, `select * from private.v_retention`,
      `select * from private.v_food_requests`, `select * from private.v_funnel_referral`,
      `select * from private.logged_dates('${U.A}', current_date - 7, current_date)`, `select private.analytics_expire()`,
      `select private.circle_posts_expire()`,
    ]) {
      await expect(as('authenticated', U.A, sql)).rejects.toThrow(/permission denied/);
      await expect(as('service_role', null, sql)).rejects.toThrow(/permission denied/);
    }
  });

  it('owner views compute daily events, zero-typing share and retention', async () => {
    const d0 = shift(today, -40);
    await db.query(`insert into public.analytics_events (user_id, event, local_date, props) values
      ($1, 'app_open', $2::date, '{}'), ($1, 'app_open', $2::date + 1, '{}'), ($1, 'app_open', $2::date + 7, '{}'),
      ($3, 'app_open', $2::date, '{}'), ($3, 'app_open', $2::date + 30, '{}'),
      ($1, 'food_logged', $2::date, '{"zero_typing": true, "method": "preset"}'), ($3, 'food_logged', $2::date, '{"zero_typing": false, "method": "search"}'),
      ($3, 'food_logged', $2::date, '{"zero_typing": true, "method": "preset"}')`, [U.N, d0, U.M]);
    const ret = (await db.query(`select users, d1, d7, d30 from private.v_retention where cohort_date = $1`, [d0])).rows[0];
    expect(ret).toEqual({ users: 2, d1: 1, d7: 1, d30: 1 });
    const zt = (await db.query(`select food_logged, zero_typing, zero_typing_share::text share, by_method from private.v_zero_typing_daily where local_date = $1`, [d0])).rows[0];
    expect(zt).toEqual({ food_logged: 3, zero_typing: 2, share: '0.667', by_method: { preset: 2, search: 1 } });
    const daily = (await db.query(`select users, events from private.v_events_daily where event = 'app_open' and day = $1`, [d0])).rows[0];
    expect(daily).toEqual({ users: 2, events: 2 });
  });
});

describe('food requests', () => {
  const req = (u: string, text: string) => one<{ count: number }>(u, `select public.request_food($1) v`, [text]);

  it('counts distinct people per normalized text and is idempotent per person', async () => {
    expect(await req(U.A, '  Aloo   Paratha ')).toEqual({ count: 1 });
    expect(await req(U.A, 'aloo paratha')).toEqual({ count: 1 });
    expect(await req(U.B, 'ALOO\tPARATHA')).toEqual({ count: 2 });
    expect(await req(U.C, 'Sarson da saag')).toEqual({ count: 1 });
    const v = (await db.query(`select requesters, latest_raw_text from private.v_food_requests where norm_text = 'aloo paratha'`)).rows[0];
    expect(v).toEqual({ requesters: 2, latest_raw_text: 'ALOO PARATHA' });
  });

  it('2-80 characters after normalizing; members only; no direct table access', async () => {
    await expect(req(U.A, ' a ')).rejects.toThrow(/2 to 80/);
    await expect(req(U.A, 'x'.repeat(81))).rejects.toThrow(/2 to 80/);
    await expect(req(U.A, null as unknown as string)).rejects.toThrow(/2 to 80/);
    await expect(as('anon', null, `select public.request_food('dal')`)).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', U.X, `select public.request_food('dal')`)).rejects.toThrow(/not authorized/);
    await expect(as('authenticated', U.A, `select * from public.food_request_votes`)).rejects.toThrow(/permission denied/);
  });
});

describe('circles', () => {
  let circle = '';
  let code = '';
  const join = (u: string, c: string, name = 'Pal', avatar = 'panda') => one<string>(u, `select public.join_circle($1, $2, $3) v`, [c, name, avatar]);
  const board = (u: string, c: string, d = today) => as<{ user_id: string; display_name: string; avatar: string; active_days_7: number; is_me: boolean }>(
    'authenticated', u, `select * from public.circle_board($1, $2::date)`, [c, d]).then((r) => r.rows);

  it('create: the creator is a member and gets an unambiguous 6-character code', async () => {
    const r = await one<{ id: string; join_code: string }>(U.A, `select public.create_circle(' Morning  crew ', 'Asha', 'bloom') v`);
    circle = r.id;
    code = r.join_code;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect((await as('authenticated', U.A, `select name from public.circles`)).rows).toEqual([{ name: 'Morning crew' }]);
    expect((await as('authenticated', U.A, `select display_name, avatar, share_prs from public.circle_members`)).rows).toEqual([{ display_name: 'Asha', avatar: 'bloom', share_prs: true }]);
    await expect(as('authenticated', U.A, `select public.create_circle('', 'Asha', 'bloom')`)).rejects.toThrow(/1 to 40/);
    await expect(as('authenticated', U.A, `select public.create_circle('Crew', '', 'bloom')`)).rejects.toThrow(/1 to 24/);
    await expect(as('authenticated', U.A, `select public.create_circle('Crew', 'Asha', 'dragon')`)).rejects.toThrow(/unknown avatar/);
  });

  it('join by code (any case), idempotent; at most 6 members → circle_full; unknown → not_found', async () => {
    expect(await join(U.B, code.toLowerCase(), 'Ben', 'bear')).toBe(circle);
    expect(await join(U.B, code, 'Ben again', 'bot')).toBe(circle);
    for (const u of [U.C, U.D, U.E, U.F]) expect(await join(u, `${code.slice(0, 3)}-${code.slice(3)}`)).toBe(circle);
    expect(Number((await db.query(`select count(*) n from public.circle_members where circle_id = $1`, [circle])).rows[0].n)).toBe(6);
    await expect(join(U.G, code)).rejects.toThrow(/circle_full/);
    await expect(join(U.G, 'ZZZZZZ')).rejects.toThrow(/not_found/);
    await expect(join(U.G, code, 'x'.repeat(25))).rejects.toThrow(/circle_full|1 to 24/);
    // The cap holds even for a direct insert that skips the RPC.
    await expect(db.query(`insert into public.circle_members (circle_id, user_id, display_name, avatar) values ($1, $2, 'Sneaky', 'orb')`, [circle, U.G])).rejects.toThrow(/circle_full/);
    expect((await as('authenticated', U.B, `select display_name from public.circle_members where user_id = $1`, [U.B])).rows).toEqual([{ display_name: 'Ben' }]);
  });

  it('non-members see nothing and cannot read the board or post', async () => {
    for (const t of ['circles', 'circle_members', 'circle_posts']) {
      expect((await as('authenticated', U.G, `select * from public.${t}`)).rowCount).toBe(0);
    }
    await expect(board(U.G, circle)).rejects.toThrow(/not authorized/);
    await expect(as('authenticated', U.G, `select public.post_to_circle($1, 'pr', 'hi')`, [circle])).rejects.toThrow(/not authorized/);
    await expect(as('anon', null, `select * from public.circle_board($1, current_date)`, [circle])).rejects.toThrow(/permission denied/);
    await expect(as('anon', null, `select * from public.circles`)).rejects.toThrow(/permission denied/);
  });

  it('board: distinct active days in the last 7 days from events and backed-up records, members’ own only', async () => {
    await logged(U.B, 'food_logged', today);
    await logged(U.B, 'food_logged', today); // same day twice
    await logged(U.B, 'workout_finished', shift(today, -1));
    await logged(U.B, 'food_logged', shift(today, -7)); // outside the window
    await logged(U.B, 'app_open', shift(today, -5)); // not logging
    await doc(U.B, 'meal_entries', 'bm1', { local_date: shift(today, -2), name: 'x' });
    await doc(U.B, 'meal_entries', 'bm2', { local_date: today, name: 'dup of an event day' });
    await doc(U.B, 'workout_sessions', 'bw1', { local_date: shift(today, -3), status: 'finished' });
    await doc(U.B, 'workout_sessions', 'bw2', { local_date: shift(today, -4), status: 'active' });
    await doc(U.C, 'meal_entries', 'cm1', { local_date: shift(today, -6), name: 'x' });
    await doc(U.G, 'meal_entries', 'gm1', { local_date: today, name: 'not a member' });
    const rows = await board(U.A, circle);
    expect(rows.length).toBe(6);
    expect(rows[0]).toMatchObject({ user_id: U.B, display_name: 'Ben', avatar: 'bear', active_days_7: 4, is_me: false });
    // A logged food today (analytics test above); ties are ordered by name: Asha before Pal.
    expect(rows.slice(1, 3)).toMatchObject([{ user_id: U.A, active_days_7: 1, is_me: true }, { user_id: U.C, active_days_7: 1, is_me: false }]);
    expect(rows.slice(3).map((r) => r.active_days_7)).toEqual([0, 0, 0]);
    expect(rows.some((r) => r.user_id === U.G)).toBe(false);
    // Yesterday's board (time zones) works: the window moves back a day (drops today, adds day -7).
    expect((await board(U.A, circle, shift(today, -1))).find((r) => r.user_id === U.B)!.active_days_7).toBe(4);
    expect((await board(U.A, circle, shift(today, -1))).find((r) => r.user_id === U.A)!.active_days_7).toBe(0);
    // Browsing history does not.
    await expect(board(U.A, circle, shift(today, -10))).rejects.toThrow(/invalid date/);
  });

  it('posts: members only, last 30 days, own delete, 10 per day, no direct writes', async () => {
    const post = (u: string, text: string, kind = 'pr') => one<string>(u, `select public.post_to_circle($1, $2, $3) v`, [circle, kind, text]);
    const id = await post(U.B, 'New best: Back squat 85 kg 🎉');
    expect((await as('authenticated', U.C, `select text, kind from public.circle_posts`)).rows).toEqual([{ text: 'New best: Back squat 85 kg 🎉', kind: 'pr' }]);
    expect((await as('authenticated', U.G, `select * from public.circle_posts`)).rowCount).toBe(0);
    await db.query(`insert into public.circle_posts (circle_id, user_id, kind, text, created_at) values ($1, $2, 'streak', 'old', now() - interval '31 days')`, [circle, U.C]);
    expect((await as('authenticated', U.C, `select text from public.circle_posts order by created_at`)).rows.map((r) => r.text)).toEqual(['New best: Back squat 85 kg 🎉']);
    await expect(post(U.B, 'x', 'brag')).rejects.toThrow(/unknown post kind/);
    await expect(post(U.B, 'x'.repeat(141))).rejects.toThrow(/1 to 140/);
    await expect(as('authenticated', U.B, `insert into public.circle_posts (circle_id, user_id, kind, text) values ($1, $2, 'pr', 'x')`, [circle, U.B])).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', U.B, `update public.circle_posts set text = 'edited'`)).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', U.B, `insert into public.circles (name, join_code) values ('x', 'ABCDEF')`)).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', U.B, `update public.circle_members set display_name = 'x'`)).rejects.toThrow(/permission denied/);
    // Someone else's post: nothing deleted. Own post: gone.
    expect((await as('authenticated', U.C, `delete from public.circle_posts where id = $1`, [id])).rowCount).toBe(0);
    expect((await as('authenticated', U.B, `delete from public.circle_posts where id = $1`, [id])).rowCount).toBe(1);
    for (let i = 0; i < 9; i++) await post(U.D, `Streak ${i}`, 'streak');
    await post(U.D, 'tenth', 'milestone');
    await expect(post(U.D, 'eleventh', 'milestone')).rejects.toThrow(/post_limit/);
  });

  it('sharing toggle is per member and only for circles you are in', async () => {
    await as('authenticated', U.B, `select public.set_circle_sharing($1, false)`, [circle]);
    expect((await db.query(`select share_prs from public.circle_members where circle_id = $1 and user_id = $2`, [circle, U.B])).rows[0].share_prs).toBe(false);
    await expect(as('authenticated', U.G, `select public.set_circle_sharing($1, false)`, [circle])).rejects.toThrow(/not_found/);
  });

  it('leaving takes your posts with you; the last one out deletes the circle', async () => {
    await as('authenticated', U.E, `select public.post_to_circle($1, 'streak', '5 days in a row')`, [circle]);
    await as('authenticated', U.E, `select public.leave_circle($1)`, [circle]);
    expect((await db.query(`select 1 from public.circle_posts where user_id = $1`, [U.E])).rowCount).toBe(0);
    expect((await as('authenticated', U.E, `select * from public.circles`)).rowCount).toBe(0);
    expect(await join(U.G, code)).toBe(circle); // a seat opened up
    const solo = await one<{ id: string }>(U.H, `select public.create_circle('Just me', 'Hari', 'sher') v`);
    await as('authenticated', U.H, `select public.leave_circle($1)`, [solo.id]);
    expect((await db.query(`select 1 from public.circles where id = $1`, [solo.id])).rowCount).toBe(0);
  });

  it('a person can be in at most 5 circles', async () => {
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) codes.push((await one<{ join_code: string }>(U.I, `select public.create_circle($1, 'Ira', 'spark') v`, [`Circle ${i}`])).join_code);
    await expect(as('authenticated', U.I, `select public.create_circle('Sixth', 'Ira', 'spark')`)).rejects.toThrow(/circle_limit/);
    const other = await one<{ join_code: string }>(U.J, `select public.create_circle('Theirs', 'Jas', 'kitty') v`);
    await expect(join(U.I, other.join_code)).rejects.toThrow(/circle_limit/);
    expect(await join(U.I, codes[0]!)).toBeTruthy(); // already a member: still fine
  });
});

describe('referral credits', () => {
  const hash = (n: number) => n.toString(16).padStart(64, 'a');
  const redeem = (u: string, c: string, h: string) => one<{ status: string }>(u, `select public.redeem_referral($1, $2) v`, [c, h]).then((r) => r.status);
  const ref = (u: string, p = 'PB') => one<{ code: string; redeemed: number; activated: number; months_banked: number; months_pending: number }>(u, `select public.my_referral($1) v`, [p]);
  const plus = (u: string) => one<{ queued: number; pending: number; released: number }>(u, `select public.my_plus() v`);
  const check = (u: string) => one<{ logged_days: number; activated: boolean }>(u, `select public.referral_check_activation() v`);
  let codeK = '';

  it('code is created once with the prefix (or TL) and 4 digits', async () => {
    const r = await ref(U.K, 'PB');
    codeK = r.code;
    expect(codeK).toMatch(/^PB-\d{4}$/);
    expect(await ref(U.K, 'ZZ')).toEqual({ code: codeK, redeemed: 0, activated: 0, months_banked: 0, months_pending: 0 });
    expect((await ref(U.L, 'p1')).code).toMatch(/^TL-\d{4}$/);
    await expect(as('authenticated', U.X, `select public.my_referral('PB')`)).rejects.toThrow(/not authorized/);
  });

  it('statuses: invalid_code, self_referral, ok, already_redeemed, device_used', async () => {
    expect(await redeem(U.L, 'PB-0000x', hash(1))).toBe('invalid_code');
    expect(await redeem(U.L, codeK === 'PB-0000' ? 'PB-0001' : 'PB-0000', hash(1))).toBe('invalid_code');
    expect(await redeem(U.K, codeK, hash(1))).toBe('self_referral');
    await expect(redeem(U.L, codeK, 'NOT-A-HASH')).rejects.toThrow(/invalid device hash/);
    expect(await redeem(U.L, codeK.toLowerCase().replace('-', ''), hash(1))).toBe('ok');
    expect(await redeem(U.L, codeK, hash(2))).toBe('already_redeemed');
    expect(await redeem(U.M, codeK, hash(1))).toBe('device_used');
    expect(await plus(U.L)).toEqual({ queued: 1, pending: 0, released: 0 });
    expect(await plus(U.K)).toEqual({ queued: 0, pending: 1, released: 0 });
    expect(await ref(U.K)).toMatchObject({ redeemed: 1, activated: 0, months_banked: 0, months_pending: 1 });
    expect(await ref(U.L)).toMatchObject({ months_banked: 1, months_pending: 0 });
    // Ledger tables are closed to clients.
    for (const t of ['referral_codes', 'referral_redemptions', 'plus_credits']) {
      await expect(as('authenticated', U.K, `select * from public.${t}`)).rejects.toThrow(/permission denied/);
    }
  });

  it('activation: 7 logged days within 30 days of redeeming releases the inviter’s month exactly once', async () => {
    const start = shift(today, -12);
    await db.query(`update public.referral_redemptions set redeemed_at = ($1::date + time '09:00') at time zone 'utc' where invitee = $2`, [start, U.L]);
    await logged(U.L, 'food_logged', shift(start, -3)); // before redeeming: never counts
    for (let i = 0; i < 6; i++) await logged(U.L, i % 2 ? 'workout_finished' : 'food_logged', shift(start, i));
    await logged(U.L, 'food_logged', shift(start, 6), today); // back-dated burst: doesn't count
    expect(await check(U.L)).toEqual({ logged_days: 6, activated: false });
    expect(await plus(U.K)).toEqual({ queued: 0, pending: 1, released: 0 });
    // A backed-up meal synced on its own day counts too.
    await db.query(`insert into public.journal_documents (user_id, collection, doc_id, version, change_seq, body, created_at) values ($1, 'meal_entries', 'lm', 1, 1, $2, ($3::date + time '13:00') at time zone 'utc')`,
      [U.L, JSON.stringify({ local_date: shift(start, 8), name: 'x' }), shift(start, 8)]);
    expect(await check(U.L)).toEqual({ logged_days: 7, activated: true });
    expect(await plus(U.K)).toEqual({ queued: 0, pending: 0, released: 1 });
    const first = (await db.query(`select released_at from public.plus_credits where user_id = $1`, [U.K])).rows[0].released_at;
    expect(await check(U.L)).toEqual({ logged_days: 7, activated: true });
    const credits = await db.query(`select status, released_at from public.plus_credits where user_id = $1`, [U.K]);
    expect(credits.rows).toEqual([{ status: 'released', released_at: first }]);
    expect(await ref(U.K)).toMatchObject({ redeemed: 1, activated: 1, months_banked: 1, months_pending: 0 });
    expect(await plus(U.L)).toEqual({ queued: 1, pending: 0, released: 0 }); // the invitee's month stays queued
  });

  it('after 30 days without 7 logged days nothing is released (the month stays pending)', async () => {
    const codeM = (await ref(U.M)).code;
    expect(await redeem(U.N, codeM, hash(3))).toBe('ok');
    const start = shift(today, -45);
    await db.query(`update public.referral_redemptions set redeemed_at = ($1::date + time '09:00') at time zone 'utc' where invitee = $2`, [start, U.N]);
    for (let i = 0; i < 3; i++) await logged(U.N, 'food_logged', shift(start, i));
    for (let i = 31; i < 40; i++) await logged(U.N, 'food_logged', shift(start, i));
    expect(await check(U.N)).toEqual({ logged_days: 3, activated: false });
    expect(await plus(U.M)).toEqual({ queued: 0, pending: 1, released: 0 });
    expect(await check(U.A)).toEqual({ logged_days: 0, activated: false }); // never redeemed
  });

  it('a revoked inviter’s code no longer works', async () => {
    const codeR = (await ref(U.R)).code;
    await db.query(`update private.approved_members set status = 'revoked' where user_id = $1`, [U.R]);
    expect(await redeem(U.J, codeR, hash(4))).toBe('invalid_code');
    await db.query(`update private.approved_members set status = 'active' where user_id = $1`, [U.R]);
  });

  it('funnel view counts redemptions and activations', async () => {
    const rows = (await db.query(`select coalesce(sum(invite_code_redeemed), 0)::int r, coalesce(sum(referral_activated), 0)::int a from private.v_funnel_referral`)).rows[0];
    expect(rows).toEqual({ r: 2, a: 1 });
  });
});

describe('access ends', () => {
  it('revoking removes circle memberships and posts, deletes circles left empty, and blocks every RPC', async () => {
    const shared = await one<{ id: string; join_code: string }>(U.R, `select public.create_circle('Shared', 'Ravi', 'buddy') v`);
    await as('authenticated', U.J, `select public.join_circle($1, 'Jas', 'kitty')`, [shared.join_code]);
    const alone = await one<{ id: string }>(U.R, `select public.create_circle('Alone', 'Ravi', 'buddy') v`);
    await as('authenticated', U.R, `select public.post_to_circle($1, 'milestone', '30 days in a row 🎉')`, [shared.id]);
    await db.query(`update private.approved_members set status = 'revoked' where user_id = $1`, [U.R]);
    expect((await db.query(`select 1 from public.circle_members where user_id = $1`, [U.R])).rowCount).toBe(0);
    expect((await db.query(`select 1 from public.circle_posts where user_id = $1`, [U.R])).rowCount).toBe(0);
    expect((await db.query(`select 1 from public.circles where id = $1`, [alone.id])).rowCount).toBe(0);
    expect((await db.query(`select 1 from public.circles where id = $1`, [shared.id])).rowCount).toBe(1);
    for (const sql of [
      `select public.log_events('[]')`, `select public.request_food('dal')`, `select public.create_circle('x', 'y', 'orb')`,
      `select public.join_circle('ABCDEF', 'y', 'orb')`, `select public.my_referral('PB')`, `select public.redeem_referral('PB-1234', '${'a'.repeat(64)}')`,
      `select public.referral_check_activation()`, `select public.my_plus()`, `select public.notification_dismissed('gym')`,
    ]) {
      await expect(as('authenticated', U.R, sql)).rejects.toThrow(/not authorized/);
      await expect(as('anon', null, sql)).rejects.toThrow(/permission denied/);
    }
  });

  it('account deletion also removes analytics, food requests, the code and credits but keeps the device hash', async () => {
    await logged(U.M, 'app_open', today);
    await as('authenticated', U.M, `select public.request_food('makki di roti')`);
    await db.query(`update private.approved_members set status = 'deleting' where user_id = $1`, [U.M]);
    for (const t of ['analytics_events', 'food_request_votes', 'referral_codes', 'plus_credits']) {
      expect((await db.query(`select 1 from public.${t} where user_id = $1`, [U.M])).rowCount).toBe(0);
    }
    const r = await db.query(`select code_owner from public.referral_redemptions where device_hash = $1`, ['3'.padStart(64, 'a')]);
    expect(r.rows).toEqual([{ code_owner: null }]);
  });
});
