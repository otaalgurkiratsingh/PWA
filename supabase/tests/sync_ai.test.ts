/**
 * Sync, self-service and AI-accounting RPC tests (migration 20261009000002).
 * Client calls run as `authenticated` with simulated verified-JWT claims; the AI reservation
 * functions run as `service_role` (the Edge Function), with real concurrent connections.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const A = randomUUID();
const B = randomUUID();
const C = randomUUID(); // never approved
const E = randomUUID(); // will delete their account

let db: pg.Client;

async function as<T extends pg.QueryResultRow = pg.QueryResultRow>(role: 'authenticated' | 'anon' | 'service_role', sub: string | null, sql: string, params: unknown[] = [], client: pg.Client = db) {
  await client.query('begin');
  try {
    await client.query(`set local role ${role}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role } : { role })]);
    const r = await client.query<T>(sql, params);
    await client.query('commit');
    return r;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

const push = (sub: string, ops: unknown[]) =>
  as<{ r: Array<Record<string, unknown>> }>('authenticated', sub, `select public.sync_push($1::jsonb) as r`, [JSON.stringify(ops)]).then((x) => x.rows[0]!.r);

const op = (owner: string, over: Record<string, unknown> = {}) => ({
  op_id: randomUUID(),
  collection: 'meal_entries',
  doc_id: randomUUID(),
  kind: 'upsert',
  base_version: 0,
  body: { owner_id: owner, name: 'Dal' },
  ...over,
});

beforeAll(async () => {
  db = new pg.Client();
  await db.connect();
  await db.query(`insert into auth.users (id) values ($1),($2),($3),($4)`, [A, B, C, E]);
  await db.query(`insert into private.approved_members (user_id, status) values ($1,'active'),($2,'active'),($3,'active')`, [A, B, E]);
});
afterAll(async () => db?.end());

describe('document sync', () => {
  it('applies, is idempotent on replay, and detects stale edits as conflicts', async () => {
    const first = op(A);
    const [r1] = await push(A, [first]);
    expect(r1).toMatchObject({ status: 'applied', server_version: 1 });
    const [replay] = await push(A, [first]);
    expect(replay).toMatchObject({ status: 'duplicate', server_version: 1 });

    const edit = { ...first, op_id: randomUUID(), base_version: 1, body: { owner_id: A, name: 'Dal (2 bowls)' } };
    expect((await push(A, [edit]))[0]).toMatchObject({ status: 'applied', server_version: 2 });

    // Another device still thinks the server is at version 1.
    const stale = { ...first, op_id: randomUUID(), base_version: 1, body: { owner_id: A, name: 'Dal (old phone)' } };
    const [c] = await push(A, [stale]);
    expect(c).toMatchObject({ status: 'conflict', server_version: 2 });
    expect((c!.server_body as { name: string }).name).toBe('Dal (2 bowls)');

    const rows = await db.query(`select version, body->>'name' as name from public.journal_documents where user_id = $1 and doc_id = $2`, [A, first.doc_id]);
    expect(rows.rows).toEqual([{ version: '2', name: 'Dal (2 bowls)' }]);
  });

  it('a lost acknowledgement followed by a newer local edit is not a conflict', async () => {
    const first = op(A);
    await push(A, [first]); // applied on the server, but pretend the reply never arrived (client still thinks v0)
    const newer = { ...first, op_id: randomUUID(), base_version: 0, prior_op_ids: [first.op_id], body: { owner_id: A, name: 'Dal + ghee' } };
    expect((await push(A, [newer]))[0]).toMatchObject({ status: 'applied', server_version: 2 });
    // Without proof of the earlier own op it is still a conflict.
    const other = { ...first, op_id: randomUUID(), base_version: 0, prior_op_ids: [randomUUID()] };
    expect((await push(A, [other]))[0]).toMatchObject({ status: 'conflict' });
  });

  it('pull returns only the caller\'s changes, in server order, including tombstones', async () => {
    const o1 = op(A);
    await push(A, [o1]);
    await push(A, [{ ...o1, op_id: randomUUID(), kind: 'delete', base_version: 1 }]);
    const pulled = await as<{ doc_id: string; deleted: boolean; change_seq: string }>('authenticated', A, `select * from public.sync_pull(0, 500)`);
    const seqs = pulled.rows.map((r) => Number(r.change_seq));
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(pulled.rows.find((r) => r.doc_id === o1.doc_id)!.deleted).toBe(true);
    const fromB = await as('authenticated', B, `select * from public.sync_pull(0, 500)`);
    expect(fromB.rowCount).toBe(0);
  });

  it('rejects forged owners, other users\' documents, oversize batches, and non-members', async () => {
    await expect(push(B, [op(A)])).rejects.toThrow(/owner does not match/);
    // Same doc id as A's document: B gets its OWN separate document; A's is untouched.
    const aOp = op(A);
    await push(A, [aOp]);
    expect((await push(B, [{ ...aOp, op_id: randomUUID(), body: { owner_id: B, name: 'B' } }]))[0]).toMatchObject({ status: 'applied', server_version: 1 });
    const aDoc = await db.query(`select body->>'name' as n from public.journal_documents where user_id = $1 and doc_id = $2`, [A, aOp.doc_id]);
    expect(aDoc.rows[0].n).toBe('Dal');
    await expect(push(A, Array.from({ length: 101 }, () => op(A)))).rejects.toThrow(/at most 100/);
    await expect(push(A, [op(A, { collection: 'private_stuff' })])).rejects.toThrow(/check constraint/);
    await expect(push(A, [op(A, { body: { owner_id: A, blob: 'x'.repeat(300_000) } })])).rejects.toThrow(/check constraint/);
    await expect(push(C, [op(C)])).rejects.toThrow(/not authorized/);
    await expect(as('anon', null, `select public.sync_push('[]'::jsonb)`)).rejects.toThrow(/permission denied/);
  });

  it('clients cannot write documents directly or read receipts/counters', async () => {
    await expect(as('authenticated', A, `insert into public.journal_documents (user_id, collection, doc_id, version, change_seq, body) values ($1,'meal_entries','x',1,1,'{}')`, [A])).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, `update public.journal_documents set body = '{}' where user_id = $1`, [A])).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, `select * from private.sync_receipts`)).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, `select * from private.sync_counters`)).rejects.toThrow(/permission denied/);
  });
});

describe('membership status and account deletion', () => {
  it('reports membership truthfully', async () => {
    expect((await as<{ s: string }>('authenticated', A, `select public.my_membership() as s`)).rows[0]!.s).toBe('active');
    expect((await as<{ s: string }>('authenticated', C, `select public.my_membership() as s`)).rows[0]!.s).toBe('none');
  });

  it('deleting an account removes their data and denies the still-valid old token', async () => {
    await push(E, [op(E)]);
    await as('authenticated', E, `insert into public.user_confirmed_memory (user_id, fact) values ($1, 'Prefers morning workouts')`, [E]);
    expect((await as<{ s: string }>('authenticated', E, `select public.request_account_deletion() as s`)).rows[0]!.s).toBe('deleting');
    const left = await db.query(`select (select count(*) from public.journal_documents where user_id = $1) docs, (select count(*) from public.user_confirmed_memory where user_id = $1) mem`, [E]);
    expect(left.rows[0]).toEqual({ docs: '0', mem: '0' });
    // Same claims as before ("old JWT"): every path is now refused.
    await expect(push(E, [op(E)])).rejects.toThrow(/not authorized/);
    expect((await as('authenticated', E, `select * from public.sync_pull(0)`)).rowCount).toBe(0);
    expect((await as<{ s: string }>('authenticated', E, `select public.my_membership() as s`)).rows[0]!.s).toBe('deleting');
    const ledger = await db.query(`select count(*) n from private.deletion_ledger where user_id = $1`, [E]);
    expect(ledger.rows[0].n).toBe('1');
  });

  it('memory is per-user', async () => {
    await as('authenticated', A, `insert into public.user_confirmed_memory (user_id, fact) values ($1, 'A fact')`, [A]);
    expect((await as('authenticated', B, `select * from public.user_confirmed_memory`)).rowCount).toBe(0);
    await expect(as('authenticated', B, `insert into public.user_confirmed_memory (user_id, fact) values ($1, 'planted')`, [A])).rejects.toThrow(/row-level security/);
  });
});

describe('AI reservations (service role only)', () => {
  const reserve = (user: string, opId: string, operation: string, usd = 0.01, client: pg.Client = db, tz = 'America/Toronto') =>
    as<{ r: { status: string; request_id?: string } }>('service_role', null, `select public.ai_reserve($1, $2, $3, $4, $5) as r`, [user, opId, operation, usd, tz], client).then((x) => x.rows[0]!.r);
  const finish = (requestId: string, user: string, status = 'succeeded') =>
    as('service_role', null, `select public.ai_finish($1, $2, $3, 0.001, '{"ok":true}', null, null)`, [requestId, user, status]);
  const fresh = async () => {
    const u = randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [u]);
    await db.query(`insert into private.approved_members (user_id, status) values ($1,'active')`, [u]);
    return u;
  };

  it('clients cannot call reservation/finish functions', async () => {
    await expect(as('authenticated', A, `select public.ai_reserve($1, gen_random_uuid(), 'coach_question', 0.01, 'UTC')`, [A])).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, `select public.ai_finish(gen_random_uuid(), $1, 'succeeded', 0, null, null, null)`, [A])).rejects.toThrow(/permission denied/);
  });

  it('non-members get no reservation (so the function never calls the model)', async () => {
    expect((await reserve(C, randomUUID(), 'coach_question')).status).toBe('not_member');
  });

  it('10 concurrent requests from one person → exactly 1 reserved, the rest refused as busy; replay → in_progress', async () => {
    const clients = await Promise.all(Array.from({ length: 10 }, async () => { const c = new pg.Client(); await c.connect(); return c; }));
    const ids = clients.map(() => randomUUID());
    const results = await Promise.all(clients.map((c, i) => reserve(B, ids[i]!, 'coach_question', 0.01, c)));
    await Promise.all(clients.map((c) => c.end()));
    expect(results.filter((r) => r.status === 'reserved')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'busy')).toHaveLength(9);
    const reservedIndex = results.findIndex((r) => r.status === 'reserved');
    expect((await reserve(B, ids[reservedIndex]!, 'coach_question')).status).toBe('in_progress');
    await finish(results[reservedIndex]!.request_id!, B);
  });

  it('20 chat messages per person per local day; the 21st is refused; failed calls do not count', async () => {
    const u = await fresh();
    for (let i = 0; i < 20; i++) {
      const r = await reserve(u, randomUUID(), 'coach_question');
      expect(r.status, `message ${i + 1}`).toBe('reserved');
      await finish(r.request_id!, u);
    }
    expect((await reserve(u, randomUUID(), 'coach_question')).status).toBe('limit_user');
    // A failed request is not counted (yesterday's local-day requests are not either).
    await db.query(`update private.ai_requests set status = 'failed' where id = (select id from private.ai_requests where user_id = $1 order by created_at desc limit 1)`, [u]);
    const again = await reserve(u, randomUUID(), 'coach_question');
    expect(again.status).toBe('reserved');
    await finish(again.request_id!, u);
  });

  it('the daily window follows the person’s timezone, computed on the server', async () => {
    const u = await fresh();
    await db.query(`update private.ai_limits set question_per_day = 1`);
    try {
      // A request 1 minute after local midnight in Toronto counts for Toronto "today" …
      await db.query(`insert into private.ai_requests (user_id, operation_id, operation, status, reserved_usd, created_at)
        values ($1, gen_random_uuid(), 'coach_question', 'succeeded', 0.001,
                (date_trunc('day', now() at time zone 'America/Toronto') + interval '1 minute') at time zone 'America/Toronto')`, [u]);
      expect((await reserve(u, randomUUID(), 'coach_question', 0.01, db, 'America/Toronto')).status).toBe('limit_user');
      // … and an invalid zone falls back to UTC rather than trusting the client.
      const r = await reserve(u, randomUUID(), 'coach_question', 0.01, db, 'Mars/Olympus');
      expect(['limit_user', 'reserved']).toContain(r.status);
      if (r.status === 'reserved') await finish(r.request_id!, u);
    } finally {
      await db.query(`update private.ai_limits set question_per_day = 20`);
    }
  });

  it('onboarding plans: first plan + 2 regenerations per week, separate from chat', async () => {
    const u = await fresh();
    for (let i = 0; i < 3; i++) {
      const r = await reserve(u, randomUUID(), 'onboarding_plan');
      expect(r.status, `plan ${i + 1}`).toBe('reserved');
      await finish(r.request_id!, u);
    }
    expect((await reserve(u, randomUUID(), 'onboarding_plan')).status).toBe('limit_user');
    const chat = await reserve(u, randomUUID(), 'coach_question');
    expect(chat.status).toBe('reserved');
    await finish(chat.request_id!, u);
  });

  it('a finished request replays its stored result instead of calling again', async () => {
    const id = randomUUID();
    const r = await reserve(A, id, 'weekly_review');
    expect(r.status).toBe('reserved');
    await as('service_role', null, `select public.ai_finish($1, $2, 'succeeded', 0.004, '{"ok":true}', '{"tokens":10}', null)`, [r.request_id, A]);
    const again = await reserve(A, id, 'weekly_review');
    expect(again).toMatchObject({ status: 'done', result: { ok: true } });
    // Only one new weekly review per week.
    expect((await reserve(A, randomUUID(), 'weekly_review')).status).toBe('limit_user');
  });

  it('the monthly budget blocks new reservations', async () => {
    await db.query(`insert into private.ai_budget (month, limit_usd) values (date_trunc('month', now())::date, 0.05)
                    on conflict (month) do update set limit_usd = 0.05`);
    expect((await reserve(A, randomUUID(), 'photo_suggest', 0.5)).status).toBe('limit_budget');
    await db.query(`update private.ai_budget set limit_usd = 10, disabled = true`);
    expect((await reserve(A, randomUUID(), 'photo_suggest', 0.01)).status).toBe('disabled');
    await db.query(`update private.ai_budget set disabled = false`);
  });

  it('members can see their own usage counts only', async () => {
    const r = await as<{ u: { questions_today: number; limits: { question_per_day: number; plan_regen_per_week: number } } }>('authenticated', B, `select public.my_ai_usage('America/Toronto') as u`);
    expect(r.rows[0]!.u.questions_today).toBe(1);
    expect(r.rows[0]!.u.limits).toMatchObject({ question_per_day: 20, plan_regen_per_week: 2 });
    expect((await as<{ u: unknown }>('authenticated', C, `select public.my_ai_usage() as u`)).rows[0]!.u).toBeNull();
  });
});
