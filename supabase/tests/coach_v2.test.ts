/**
 * V2 tests (migration 20261010000003): coach chat threads/messages, plan drafts, private progress
 * photos (Storage RLS), separate permissions, retention and account deletion.
 * Clients run as `authenticated` with simulated verified-JWT claims; the Edge Function as `service_role`.
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

const consent = (u: string, type: string, granted: boolean) =>
  as('authenticated', u, `insert into public.consent_events (consent_type, granted, notice_version) values ($1, $2, 'v2')`, [type, granted]);

const store = (user: string, thread: string | null, text = 'How was my week?', op = randomUUID()) =>
  as<{ r: { status: string; thread_id?: string } }>('service_role', null,
    `select public.coach_store_exchange($1, $2, $3, $4, 'Here is what your logs show.', '{"schema_version":"2.0"}', '2.0', 'gemini-3.8-flash', 'v2-test') as r`,
    [user, thread, op, text]).then((x) => x.rows[0]!.r);

beforeAll(async () => {
  db = new pg.Client();
  await db.connect();
  await db.query(`insert into auth.users (id) values ($1),($2),($3)`, [A, B, R]);
  await db.query(`insert into private.approved_members (user_id, status) values ($1,'active'),($2,'active'),($3,'active')`, [A, B, R]);
  for (const u of [A, B, R]) await consent(u, 'ai_processing', true);
});
afterAll(async () => db?.end());

describe('coach chat threads and messages', () => {
  let threadA = '';

  it('the backend stores an exchange; replay of the same request id stores nothing new', async () => {
    const op = randomUUID();
    const r = await store(A, null, 'Can I do today’s workout in 30 minutes?', op);
    expect(r.status).toBe('stored');
    threadA = r.thread_id!;
    const again = await store(A, null, 'Can I do today’s workout in 30 minutes?', op);
    expect(again.status).toBe('duplicate');
    const n = await db.query(`select count(*) n from public.coach_messages where user_id = $1`, [A]);
    expect(n.rows[0].n).toBe('2');
  });

  it('owners read their own chat; another member sees nothing and guessed ids return nothing', async () => {
    expect((await as('authenticated', A, `select * from public.coach_messages`)).rowCount).toBe(2);
    expect((await as('authenticated', B, `select * from public.coach_messages`)).rowCount).toBe(0);
    expect((await as('authenticated', B, `select * from public.coach_threads where id = $1`, [threadA])).rowCount).toBe(0);
  });

  it('clients cannot write messages (no forged assistant/system turns) or threads', async () => {
    await expect(as('authenticated', A, `insert into public.coach_messages (thread_id, user_id, role, content, client_op_id) values ($1, $2, 'assistant', 'forged', gen_random_uuid())`, [threadA, A])).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, `insert into public.coach_threads (user_id) values ($1)`, [A])).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, `update public.coach_messages set content = 'edited'`)).rejects.toThrow(/permission denied/);
    await expect(as('authenticated', A, `select public.coach_store_exchange($1, null, gen_random_uuid(), 'x', 'y', null, '2.0', 'm', 'p')`, [A])).rejects.toThrow(/permission denied/);
  });

  it('a message can never reference another person’s thread', async () => {
    // Through the RPC: B's request naming A's thread is refused.
    expect((await store(B, threadA)).status).toBe('thread_not_found');
    // Even a privileged direct insert fails on the composite (thread, owner) key.
    await expect(db.query(`insert into public.coach_messages (thread_id, user_id, role, content, client_op_id) values ($1, $2, 'user', 'x', gen_random_uuid())`, [threadA, B])).rejects.toThrow(/foreign key/);
  });

  it('withdrawn AI permission or revoked membership stops persistence', async () => {
    await consent(B, 'ai_processing', false);
    expect((await store(B, null)).status).toBe('not_allowed');
    await consent(B, 'ai_processing', true);
    await db.query(`update private.approved_members set status = 'revoked' where user_id = $1`, [R]);
    expect((await store(R, null)).status).toBe('not_allowed');
    expect((await as('authenticated', R, `select * from public.coach_threads`)).rowCount).toBe(0);
  });

  it('expired chats are hidden immediately and removed by the retention job', async () => {
    const r = await store(B, null, 'Old chat');
    await db.query(`update public.coach_threads set expires_at = now() - interval '1 minute' where id = $1`, [r.thread_id]);
    expect((await as('authenticated', B, `select * from public.coach_threads where id = $1`, [r.thread_id])).rowCount).toBe(0);
    expect((await as('authenticated', B, `select * from public.coach_messages`)).rowCount).toBe(0);
    expect((await store(B, r.thread_id!)).status).toBe('thread_not_found');
    const removed = await db.query(`select private.coach_expire() n`);
    expect(removed.rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await db.query(`select count(*) n from public.coach_threads where id = $1`, [r.thread_id])).rows[0].n).toBe('0');
  });

  it('Delete chat removes it for good; another member cannot delete it; memories stay', async () => {
    await as('authenticated', A, `insert into public.user_confirmed_memory (fact) values ('Trains before work')`);
    expect((await as<{ n: number }>('authenticated', B, `select public.delete_coach_thread($1) n`, [threadA])).rows[0]!.n).toBe(0);
    expect((await as<{ n: number }>('authenticated', A, `select public.delete_coach_thread($1) n`, [threadA])).rows[0]!.n).toBe(1);
    expect((await db.query(`select count(*) n from public.coach_messages where thread_id = $1`, [threadA])).rows[0].n).toBe('0');
    expect((await as('authenticated', A, `select * from public.user_confirmed_memory`)).rowCount).toBe(1);
  });
});

describe('plan drafts', () => {
  const plan = { title: 'My plan', days: [] };
  const storeDraft = (u: string, version = 1) =>
    as<{ id: string }>('service_role', null, `select public.store_plan_draft($1, $2, 'onboarding', $3, '{}', 'gemini-3.8-flash', 'v2-test') id`, [u, version, JSON.stringify(plan)]).then((x) => x.rows[0]!.id);

  it('only the backend creates drafts; clients only read their own', async () => {
    await expect(as('authenticated', A, `insert into public.plan_drafts (user_id, profile_version, source, plan, response, model_id, prompt_version) values ($1, 1, 'onboarding', '{}', '{}', 'm', 'p')`, [A])).rejects.toThrow(/permission denied/);
    const id = await storeDraft(A);
    expect((await as('authenticated', A, `select * from public.plan_drafts where id = $1`, [id])).rowCount).toBe(1);
    expect((await as('authenticated', B, `select * from public.plan_drafts where id = $1`, [id])).rowCount).toBe(0);
  });

  it('a newer draft supersedes the old one; a stale profile version cannot be accepted; another person cannot decide it', async () => {
    const old = await storeDraft(A, 1);
    const current = await storeDraft(A, 2);
    expect((await db.query(`select status from public.plan_drafts where id = $1`, [old])).rows[0].status).toBe('superseded');
    const decide = (u: string, id: string, d: string, v: number) =>
      as<{ r: { status: string; plan?: unknown } }>('authenticated', u, `select public.decide_plan_draft($1, $2, $3) r`, [id, d, v]).then((x) => x.rows[0]!.r);
    expect((await decide(B, current, 'accepted', 2)).status).toBe('not_found');
    expect((await decide(A, current, 'accepted', 3)).status).toBe('stale');
    const ok = await decide(A, current, 'accepted', 2);
    expect(ok).toMatchObject({ status: 'accepted', plan });
    expect((await decide(A, current, 'accepted', 2)).status).toBe('not_found'); // already decided
    expect((await decide(A, old, 'accepted', 1)).status).toBe('not_found'); // superseded
  });
});

describe('private progress photos (Storage RLS)', () => {
  const path = (owner: string) => `${owner}/${randomUUID()}.jpg`;
  const upload = (u: string, p: string) => as('authenticated', u, `insert into storage.objects (bucket_id, name, owner) values ('progress-photos', $1, $2)`, [p, u]);

  it('the bucket is private and limited to small JPEGs', async () => {
    const b = await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'progress-photos'`);
    expect(b.rows[0]).toEqual({ public: false, file_size_limit: '1572864', allowed_mime_types: ['image/jpeg'] });
  });

  it('upload needs the separate photo-storage permission; declining it blocks uploads only', async () => {
    await expect(upload(A, path(A))).rejects.toThrow(/row-level security/);
    await consent(A, 'photo_storage', true);
    await upload(A, path(A));
  });

  it('nobody can upload into another person’s folder or use a non-standard name', async () => {
    await consent(B, 'photo_storage', true);
    await expect(upload(B, path(A))).rejects.toThrow(/row-level security/);
    await expect(upload(B, `${B}/front-photo.jpg`)).rejects.toThrow(/row-level security/);
    await expect(upload(B, `${B}/../${A}/${randomUUID()}.jpg`)).rejects.toThrow(/row-level security/);
  });

  it('another member cannot read or delete A’s photos, even with a guessed path', async () => {
    const p = path(A);
    await upload(A, p);
    expect((await as('authenticated', B, `select * from storage.objects where name = $1`, [p])).rowCount).toBe(0);
    expect((await as('authenticated', B, `delete from storage.objects where name = $1`, [p])).rowCount).toBe(0);
    expect((await as('authenticated', A, `select * from storage.objects where name = $1`, [p])).rowCount).toBe(1);
    expect((await as('anon', null, `select * from storage.objects where name = $1`, [p]).catch(() => ({ rowCount: 0 }))).rowCount).toBe(0);
  });

  it('metadata rows are owner-only and must match the owner’s folder', async () => {
    const id = randomUUID();
    await as('authenticated', A, `insert into public.progress_photos (id, slot, object_path, width, height, bytes) values ($1, 'front', $2, 800, 1000, 120000)`, [id, `${A}/${id}.jpg`]);
    const other = randomUUID();
    await expect(as('authenticated', B, `insert into public.progress_photos (id, slot, object_path, width, height, bytes) values ($1, 'front', $2, 800, 1000, 120000)`, [other, `${A}/${other}.jpg`])).rejects.toThrow(/check constraint|row-level security/);
    expect((await as('authenticated', B, `select * from public.progress_photos`)).rowCount).toBe(0);
    // Withdrawing photo storage blocks new photos but deleting your own still works.
    await consent(A, 'photo_storage', false);
    const id2 = randomUUID();
    await expect(as('authenticated', A, `insert into public.progress_photos (id, slot, object_path, width, height, bytes) values ($1, 'back', $2, 800, 1000, 1)`, [id2, `${A}/${id2}.jpg`])).rejects.toThrow(/row-level security/);
    expect((await as('authenticated', A, `delete from public.progress_photos where id = $1`, [id])).rowCount).toBe(1);
  });

  it('revoked members lose access to their photos immediately', async () => {
    // (A revoked member cannot even record consent; set it directly to prove membership alone blocks.)
    await db.query(`insert into public.consent_events (user_id, consent_type, granted, notice_version) values ($1, 'photo_storage', true, 'v2')`, [R]);
    expect((await as('authenticated', R, `select * from storage.objects`)).rowCount).toBe(0);
    await expect(upload(R, path(R))).rejects.toThrow(/row-level security/);
  });
});

describe('account deletion covers V2 data', () => {
  it('removes chats, drafts and photo records and records leftover files for purging', async () => {
    const E = randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [E]);
    await db.query(`insert into private.approved_members (user_id, status) values ($1,'active')`, [E]);
    await consent(E, 'ai_processing', true);
    await consent(E, 'photo_storage', true);
    await store(E, null);
    await as('service_role', null, `select public.store_plan_draft($1, 1, 'onboarding', '{}', '{}', 'm', 'p')`, [E]);
    const id = randomUUID();
    await as('authenticated', E, `insert into public.progress_photos (id, slot, object_path, width, height, bytes) values ($1, 'front', $2, 800, 1000, 1)`, [id, `${E}/${id}.jpg`]);
    await as('authenticated', E, `select public.request_account_deletion()`);
    const left = await db.query(`select
      (select count(*) from public.coach_threads where user_id = $1) t,
      (select count(*) from public.coach_messages where user_id = $1) m,
      (select count(*) from public.plan_drafts where user_id = $1) d,
      (select count(*) from public.progress_photos where user_id = $1) p`, [E]);
    expect(left.rows[0]).toEqual({ t: '0', m: '0', d: '0', p: '0' });
    const ledger = await db.query(`select backup_expiry_note from private.deletion_ledger where user_id = $1`, [E]);
    expect(ledger.rows[0].backup_expiry_note).toMatch(/progress-photos/);
    expect((await store(E, null)).status).toBe('not_allowed');
  });
});
