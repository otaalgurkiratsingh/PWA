/**
 * Phase 3 interview upgrade (migration 20261013000006): the diet_draft AI operation shares the daily
 * chat allowance, and food-plan drafts live in plan_drafts (kind = 'diet') with the same owner-only
 * RLS and approval flow. A new draft only supersedes an open draft of the same kind.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: pg.Client;
const A = randomUUID();
const B = randomUUID();

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
const reserve = (user: string, operation: string, opId = randomUUID()) =>
  as<{ r: { status: string; request_id?: string; limit?: number } }>('service_role', null, `select public.ai_reserve($1, $2, $3, 0.01, 'America/Toronto') as r`, [user, opId, operation]).then((x) => x.rows[0]!.r);
const finish = (requestId: string, user: string) =>
  as('service_role', null, `select public.ai_finish($1, $2, 'succeeded', 0.001, '{"ok":true}', null, null)`, [requestId, user]);
const storeDraft = (user: string, version: number, kind?: 'training' | 'diet', plan: object = { title: kind ?? 'training' }) =>
  as<{ id: string }>('service_role', null, kind
    ? `select public.store_plan_draft($1, $2, 'onboarding', $3, '{}', 'model', 'coach-2.0+test', $4) id`
    : `select public.store_plan_draft($1, $2, 'onboarding', $3, '{}', 'model', 'coach-2.0+test') id`,
  kind ? [user, version, JSON.stringify(plan), kind] : [user, version, JSON.stringify(plan)]).then((x) => x.rows[0]!.id);
const status = async (id: string) => (await db.query(`select status, kind from public.plan_drafts where id = $1`, [id])).rows[0];

beforeAll(async () => {
  db = new pg.Client();
  await db.connect();
  await db.query(`insert into auth.users (id) values ($1),($2)`, [A, B]);
  await db.query(`insert into private.approved_members (user_id, status) values ($1,'active'),($2,'active')`, [A, B]);
  for (const u of [A, B]) await as('authenticated', u, `insert into public.consent_events (consent_type, granted, notice_version) values ('ai_processing', true, 'v3')`);
});
afterAll(async () => db?.end());

describe('diet_draft accounting (no new quota)', () => {
  it('is an allowed operation; unknown operations are still refused', async () => {
    const r = await reserve(A, 'diet_draft');
    expect(r.status).toBe('reserved');
    await finish(r.request_id!, A);
    await expect(reserve(A, 'diet_plan_free_for_all')).rejects.toThrow(/invalid reservation/);
  });

  it('shares the daily chat allowance with coach_question', async () => {
    await db.query(`update private.ai_limits set question_per_day = 3`);
    try {
      // A already used one diet draft today (above); one chat + one more diet draft reach 3.
      for (const op of ['coach_question', 'diet_draft']) {
        const r = await reserve(A, op);
        expect(r.status).toBe('reserved');
        await finish(r.request_id!, A);
      }
      expect((await reserve(A, 'coach_question')).status).toBe('limit_user');
      expect((await reserve(A, 'diet_draft')).status).toBe('limit_user');
      // The plan allowance is separate and untouched.
      expect((await reserve(A, 'onboarding_plan')).status).toBe('reserved');
      const usage = (await as<{ u: { questions_today: number } }>('authenticated', A, `select public.my_ai_usage('America/Toronto') as u`)).rows[0]!.u;
      expect(usage.questions_today).toBe(3);
    } finally {
      await db.query(`update private.ai_limits set question_per_day = 20`);
    }
  });

  it('clients still cannot reserve directly', async () => {
    await expect(as('authenticated', B, `select public.ai_reserve($1, gen_random_uuid(), 'diet_draft', 0.01, 'UTC')`, [B])).rejects.toThrow(/permission denied/);
  });
});

describe('food-plan drafts in plan_drafts', () => {
  it('existing 7-argument calls still store training drafts', async () => {
    const id = await storeDraft(B, 1);
    expect(await status(id)).toEqual({ status: 'draft', kind: 'training' });
  });

  it('a diet draft never supersedes the open training draft (and vice versa); same kind does', async () => {
    const training = await storeDraft(A, 4, 'training');
    const diet1 = await storeDraft(A, 4, 'diet', { kind: 'diet', meals: [] });
    expect(await status(training)).toEqual({ status: 'draft', kind: 'training' });
    const diet2 = await storeDraft(A, 4, 'diet', { kind: 'diet', meals: [{ slot: 'lunch' }] });
    expect((await status(diet1)).status).toBe('superseded');
    expect((await status(diet2)).status).toBe('draft');
    expect((await status(training)).status).toBe('draft');
  });

  it('only service role stores drafts; an invalid kind is refused', async () => {
    await expect(as('authenticated', A, `select public.store_plan_draft($1, 1, 'onboarding', '{}', '{}', 'm', 'p', 'diet')`, [A])).rejects.toThrow(/permission denied/);
    await expect(storeDraft(A, 1, 'workout' as 'diet')).rejects.toThrow(/invalid kind/);
    await expect(db.query(`insert into public.plan_drafts (user_id, profile_version, source, plan, response, model_id, prompt_version, kind) values ($1, 1, 'onboarding', '{}', '{}', 'm', 'p', 'snacks')`, [A])).rejects.toThrow(/check constraint/);
  });

  it('owners see their own diet drafts only and decide them with the same version rule', async () => {
    const id = await storeDraft(A, 7, 'diet', { kind: 'diet', meals: [{ slot: 'dinner', items: [{ dish_id: 'asc165', servings: 1 }] }] });
    expect((await as('authenticated', B, `select * from public.plan_drafts where id = $1`, [id])).rowCount).toBe(0);
    expect((await as('authenticated', A, `select kind from public.plan_drafts where id = $1`, [id])).rows[0]).toEqual({ kind: 'diet' });
    const decide = (u: string, d: string, v: number) =>
      as<{ r: { status: string; plan?: { kind?: string } } }>('authenticated', u, `select public.decide_plan_draft($1, $2, $3) r`, [id, d, v]).then((x) => x.rows[0]!.r);
    expect((await decide(B, 'accepted', 7)).status).toBe('not_found');
    expect((await decide(A, 'accepted', 6)).status).toBe('stale');
    const ok = await decide(A, 'accepted', 7);
    expect(ok.status).toBe('accepted');
    expect(ok.plan?.kind).toBe('diet');
    // Clients can't write drafts directly.
    await expect(as('authenticated', A, `update public.plan_drafts set status = 'accepted' where id = $1`, [id])).rejects.toThrow(/permission denied/);
  });
});
