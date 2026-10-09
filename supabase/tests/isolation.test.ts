/**
 * Member isolation tests. Each request runs as the `authenticated` (or `anon`) role with the
 * JWT claims PostgREST would set after verifying a token — the same path the browser uses.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const A = randomUUID(); // approved, active
const B = randomUUID(); // approved, active (the "attacker" in most tests)
const C = randomUUID(); // authenticated but never approved
const D = randomUUID(); // approved then revoked

let db: pg.Client;

type Who = { role: 'authenticated' | 'anon'; sub?: string };
const as = (sub: string): Who => ({ role: 'authenticated', sub });
const anon: Who = { role: 'anon' };

/** Run SQL as a client role inside a transaction that is committed (or rolled back on error). */
async function run<T extends pg.QueryResultRow = pg.QueryResultRow>(who: Who, sql: string, params: unknown[] = []) {
  await db.query('begin');
  try {
    await db.query(`set local role ${who.role}`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(who.sub ? { sub: who.sub, role: who.role } : { role: who.role }),
    ]);
    const res = await db.query<T>(sql, params);
    await db.query('commit');
    return res;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}

async function denied(p: Promise<unknown>, pattern: RegExp = /row-level security|permission denied|violates foreign key|not authorized|sealed|owner cannot/) {
  await expect(p).rejects.toThrow(pattern);
}

const meal = (owner: string) => ({
  sql: `insert into public.meal_entries (user_id, name, slot, local_date, timezone, logged_at, quantity)
        values ($1, 'Dal', 'lunch', '2026-10-09', 'America/Toronto', now(), 1) returning id, version, created_at`,
  params: [owner],
});

beforeAll(async () => {
  db = new pg.Client();
  await db.connect();
  await db.query(`insert into auth.users (id, email) values ($1,'a@example.test'),($2,'b@example.test'),($3,'c@example.test'),($4,'d@example.test')`, [A, B, C, D]);
  await db.query(`insert into private.approved_members (user_id, status) values ($1,'active'),($2,'active'),($3,'active')`, [A, B, D]);
  await db.query(`insert into public.exercise_library values ('bench_press','Bench press','barbell','chest')`);
});

afterAll(async () => {
  await db?.end();
});

describe('owner-only access between two approved members', () => {
  let aMeal: string;
  let aItem: string;

  beforeAll(async () => {
    const m = meal(A);
    aMeal = (await run<{ id: string }>(as(A), m.sql, m.params)).rows[0]!.id;
    aItem = (
      await run<{ id: string }>(
        as(A),
        `insert into public.meal_items (user_id, meal_entry_id, label, quantity, unit_label, grams, energy_kcal, complete, source_kinds, estimated)
         values ($1, $2, 'Dal', 1, 'katori', 180, null, '{}'::jsonb, '{synthetic_demo}', true) returning id`,
        [A, aMeal],
      )
    ).rows[0]!.id;
  });

  it('A reads own rows; unknown nutrients stay NULL', async () => {
    const r = await run(as(A), `select energy_kcal from public.meal_items where id = $1`, [aItem]);
    expect(r.rows).toEqual([{ energy_kcal: null }]);
  });

  it("B cannot read A's rows by id, by table scan, or through child tables", async () => {
    expect((await run(as(B), `select * from public.meal_entries where id = $1`, [aMeal])).rowCount).toBe(0);
    expect((await run(as(B), `select * from public.meal_entries`)).rowCount).toBe(0);
    expect((await run(as(B), `select * from public.meal_items where meal_entry_id = $1`, [aMeal])).rowCount).toBe(0);
  });

  it("B cannot update or delete A's rows (0 rows affected, A's data unchanged)", async () => {
    expect((await run(as(B), `update public.meal_entries set name = 'hacked' where id = $1`, [aMeal])).rowCount).toBe(0);
    expect((await run(as(B), `delete from public.meal_entries where id = $1`, [aMeal])).rowCount).toBe(0);
    const r = await db.query(`select name from public.meal_entries where id = $1`, [aMeal]);
    expect(r.rows[0].name).toBe('Dal');
  });

  it('B cannot insert rows owned by A (forged user_id)', async () => {
    const m = meal(A);
    await denied(run(as(B), m.sql, m.params));
  });

  it("B cannot attach a child to A's parent, with either owner value", async () => {
    const child = `insert into public.meal_items (user_id, meal_entry_id, label, quantity, unit_label, grams, complete, source_kinds, estimated)
                   values ($1, $2, 'x', 1, 'g', 1, '{}'::jsonb, '{}', false)`;
    // Own user_id + A's parent → composite FK violation (no cross-owner references).
    await denied(run(as(B), child, [B, aMeal]), /violates foreign key/);
    // A's user_id → RLS rejects the forged owner.
    await denied(run(as(B), child, [A, aMeal]), /row-level security/);
  });

  it('owner reassignment is rejected even for own rows', async () => {
    await denied(run(as(A), `update public.meal_entries set user_id = $1 where id = $2`, [B, aMeal]));
  });

  it("B cannot move its own child under A's parent", async () => {
    const m = meal(B);
    const bMeal = (await run<{ id: string }>(as(B), m.sql, m.params)).rows[0]!.id;
    const bItem = (
      await run<{ id: string }>(
        as(B),
        `insert into public.meal_items (user_id, meal_entry_id, label, quantity, unit_label, grams, complete, source_kinds, estimated)
         values ($1, $2, 'x', 1, 'g', 1, '{}'::jsonb, '{}', false) returning id`,
        [B, bMeal],
      )
    ).rows[0]!.id;
    await denied(run(as(B), `update public.meal_items set meal_entry_id = $1 where id = $2`, [aMeal, bItem]), /violates foreign key/);
  });
});

describe('server-controlled fields', () => {
  it('ignores forged version and created_at on insert, increments on update', async () => {
    const r = await run<{ id: string; version: string; created_at: Date }>(
      as(A),
      `insert into public.weight_entries (user_id, local_date, timezone, measured_at, value, unit, version, created_at)
       values ($1, '2026-10-09', 'UTC', now(), 80.2, 'kg', 99, '2000-01-01') returning id, version, created_at`,
      [A],
    );
    const row = r.rows[0]!;
    expect(Number(row.version)).toBe(1);
    expect(row.created_at.getFullYear()).toBeGreaterThanOrEqual(2026);
    const u = await run<{ version: string }>(as(A), `update public.weight_entries set value = 80.0, version = 500 where id = $1 returning version`, [row.id]);
    expect(Number(u.rows[0]!.version)).toBe(2);
  });

  it('rejects zero/negative quantities and completed sets without actual values', async () => {
    await denied(run(as(A), `insert into public.weight_entries (user_id, local_date, timezone, measured_at, value, unit) values ($1,'2026-10-09','UTC',now(),0,'kg')`, [A]), /check constraint/);
  });
});

describe('membership gate', () => {
  it('an authenticated but unapproved user sees nothing and cannot write', async () => {
    expect((await run(as(C), `select * from public.meal_entries`)).rowCount).toBe(0);
    expect((await run(as(C), `select * from public.exercise_library`)).rowCount).toBe(0);
    const m = meal(C);
    await denied(run(as(C), m.sql, m.params), /row-level security/);
  });

  it('a revoked member loses access to their own existing rows immediately', async () => {
    const m = meal(D);
    const id = (await run<{ id: string }>(as(D), m.sql, m.params)).rows[0]!.id;
    expect((await run(as(D), `select * from public.meal_entries where id = $1`, [id])).rowCount).toBe(1);
    await db.query(`update private.approved_members set status = 'revoked' where user_id = $1`, [D]);
    expect((await run(as(D), `select * from public.meal_entries where id = $1`, [id])).rowCount).toBe(0);
    await denied(run(as(D), m.sql, m.params), /row-level security/);
    expect((await run(as(D), `update public.meal_entries set name='x' where id = $1`, [id])).rowCount).toBe(0);
  });

  it('a token without a subject (or a deleted account) resolves to no rows', async () => {
    expect((await run({ role: 'authenticated' }, `select * from public.meal_entries`)).rowCount).toBe(0);
    expect((await run(as(randomUUID()), `select * from public.meal_entries`)).rowCount).toBe(0);
  });

  it('anon has no table privileges at all', async () => {
    await denied(run(anon, `select * from public.meal_entries`), /permission denied/);
    await denied(run(anon, `select * from public.exercise_library`), /permission denied/);
    await denied(run(anon, `select * from public.profiles`), /permission denied/);
  });

  it('active members can read the shared library but not change it', async () => {
    expect((await run(as(A), `select key from public.exercise_library`)).rowCount).toBe(1);
    await denied(run(as(A), `insert into public.exercise_library values ('x','x','x','x')`), /permission denied/);
  });
});

describe('private operational schema', () => {
  it('clients cannot read or modify membership, AI usage, or receipts', async () => {
    await denied(run(as(A), `select * from private.approved_members`), /permission denied/);
    await denied(run(as(A), `update private.approved_members set is_owner_admin = true where user_id = $1`, [A]), /permission denied/);
    await denied(run(as(A), `insert into private.approved_members (user_id, status) values ($1, 'active')`, [C]), /permission denied/);
    await denied(run(as(A), `select * from private.ai_requests`), /permission denied/);
    await denied(run(as(A), `insert into private.ai_requests (user_id, operation_id, operation, status, reserved_usd) values ($1, gen_random_uuid(), 'coach_question', 'reserved', 0)`, [A]), /permission denied/);
    await denied(run(as(A), `select * from private.ai_budget`), /permission denied/);
    await denied(run(anon, `select private.is_active_member()`), /permission denied/);
  });
});

describe('immutable revisions and append-only ledgers', () => {
  let revision: string;
  let foodVersion: string;

  beforeAll(async () => {
    const food = (await run<{ id: string }>(as(A), `insert into public.foods (user_id, name) values ($1, 'Toor dal') returning id`, [A])).rows[0]!.id;
    foodVersion = (
      await run<{ id: string }>(
        as(A),
        `insert into public.food_versions (user_id, food_id, revision, preparation_state, source_kind, energy_kcal) values ($1, $2, 1, 'dry', 'synthetic_demo', 340) returning id`,
        [A, food],
      )
    ).rows[0]!.id;
    const recipe = (await run<{ id: string }>(as(A), `insert into public.recipes (user_id, name) values ($1, 'Dal') returning id`, [A])).rows[0]!.id;
    revision = (
      await run<{ id: string }>(
        as(A),
        `insert into public.recipe_revisions (user_id, recipe_id, revision, batch_cooked_edible_yield_g) values ($1, $2, 1, 900) returning id`,
        [A, recipe],
      )
    ).rows[0]!.id;
    await run(as(A), `insert into public.recipe_ingredients (user_id, recipe_revision_id, food_version_id, edible_grams, state) values ($1, $2, $3, 200, 'dry')`, [A, revision, foodVersion]);
    await run(as(A), `update public.recipe_revisions set sealed_at = now() where id = $1`, [revision]);
  });

  it('a sealed recipe revision cannot be edited or extended', async () => {
    await denied(run(as(A), `update public.recipe_revisions set batch_cooked_edible_yield_g = 1 where id = $1`, [revision]), /sealed/);
    await denied(
      run(as(A), `insert into public.recipe_ingredients (user_id, recipe_revision_id, food_version_id, edible_grams, state) values ($1, $2, $3, 20, 'dry')`, [A, revision, foodVersion]),
      /sealed/,
    );
  });

  it('only sealing is allowed on an unsealed revision', async () => {
    const recipe = (await run<{ id: string }>(as(A), `insert into public.recipes (user_id, name) values ($1, 'Chai') returning id`, [A])).rows[0]!.id;
    const rev = (await run<{ id: string }>(as(A), `insert into public.recipe_revisions (user_id, recipe_id, revision, batch_cooked_edible_yield_g) values ($1, $2, 1, 200) returning id`, [A, recipe])).rows[0]!.id;
    await denied(run(as(A), `update public.recipe_revisions set batch_cooked_edible_yield_g = 300 where id = $1`, [rev]), /only sealing/);
  });

  it('food versions and consent events cannot be updated or deleted by clients', async () => {
    await denied(run(as(A), `update public.food_versions set energy_kcal = 0 where id = $1`, [foodVersion]), /permission denied/);
    await denied(run(as(A), `delete from public.food_versions where id = $1`, [foodVersion]), /permission denied/);
    const c = (await run<{ id: string }>(as(A), `insert into public.consent_events (user_id, consent_type, granted, notice_version) values ($1, 'cloud_backup', true, 'v1') returning id`, [A])).rows[0]!.id;
    await denied(run(as(A), `update public.consent_events set granted = false where id = $1`, [c]), /permission denied/);
    await denied(run(as(A), `delete from public.consent_events where id = $1`, [c]), /permission denied/);
  });
});

describe('workout data integrity', () => {
  it('skipped sets carry no performance; completed sets require actual values', async () => {
    const prog = (await run<{ id: string }>(as(A), `insert into public.workout_programs (user_id, name) values ($1,'Plan') returning id`, [A])).rows[0]!.id;
    const ver = (await run<{ id: string }>(as(A), `insert into public.program_versions (user_id, program_id, program_version) values ($1,$2,1) returning id`, [A, prog])).rows[0]!.id;
    const day = (await run<{ id: string }>(as(A), `insert into public.program_days (user_id, program_version_id, position, name) values ($1,$2,0,'Push') returning id`, [A, ver])).rows[0]!.id;
    const sess = (await run<{ id: string }>(as(A),
      `insert into public.workout_sessions (user_id, program_version_id, program_day_id, program_snapshot, local_date, timezone, started_at, status)
       values ($1,$2,$3,'{}'::jsonb,'2026-10-09','UTC',now(),'active') returning id`, [A, ver, day])).rows[0]!.id;
    const ex = (await run<{ id: string }>(as(A),
      `insert into public.session_exercises (user_id, session_id, position, exercise_key, variant, load_convention, unilateral)
       values ($1,$2,0,'bench_press','barbell','total',false) returning id`, [A, sess])).rows[0]!.id;
    const ins = `insert into public.completed_sets (user_id, session_exercise_id, position, set_type, planned, status, reps, load, unit, completed_at)
                 values ($1,$2,$3,'working','{}'::jsonb,$4,$5,$6,$7,$8)`;
    await run(as(A), ins, [A, ex, 0, 'completed', 8, 50, 'kg', new Date()]);
    await run(as(A), ins, [A, ex, 1, 'skipped', null, null, null, null]);
    await denied(run(as(A), ins, [A, ex, 2, 'skipped', 0, 0, 'kg', new Date()]), /check constraint/);
    await denied(run(as(A), ins, [A, ex, 3, 'completed', null, null, null, null]), /check constraint/);
    // Duplicate set position (e.g. a replayed request) is rejected rather than duplicated.
    await expect(run(as(A), ins, [A, ex, 0, 'completed', 8, 50, 'kg', new Date()])).rejects.toThrow(/duplicate key/);
    // B cannot add sets to A's session exercise.
    await denied(run(as(B), ins, [B, ex, 4, 'completed', 1, 1, 'kg', new Date()]), /violates foreign key/);
    // Sealed program version blocks new days.
    await run(as(A), `update public.program_versions set sealed_at = now() where id = $1`, [ver]);
    await denied(run(as(A), `insert into public.program_days (user_id, program_version_id, position, name) values ($1,$2,1,'Pull')`, [A, ver]), /sealed/);
  });

  it('only one live health value per metric per day (no double counting)', async () => {
    const ins = `insert into public.daily_health_summaries (user_id, metric, local_date, timezone, value, source, refreshed_at) values ($1,'steps','2026-10-09','UTC',$2,'manual',now())`;
    await run(as(A), ins, [A, 8000]);
    await expect(run(as(A), ins, [A, 9000])).rejects.toThrow(/duplicate key/);
    // B has its own independent row for the same date.
    await run(as(B), ins, [B, 5000]);
  });
});

describe('coach output and approval RPC', () => {
  let proposal: string;

  beforeAll(async () => {
    // Written by the backend (superuser here, service role in Supabase) after validation.
    const review = (await db.query(
      `insert into public.coach_reviews (user_id, period_from, period_to, review, model_id, prompt_version)
       values ($1, '2026-10-01', '2026-10-07', '{}'::jsonb, 'test-model', 'p1') returning id`, [A])).rows[0].id;
    proposal = (await db.query(
      `insert into public.change_proposals (user_id, coach_review_id, kind, before_value, after_value)
       values ($1, $2, 'target', '{"protein_g":120}', '{"protein_g":130}') returning id`, [A, review])).rows[0].id;
  });

  it('clients cannot write coach reviews or proposals directly', async () => {
    await denied(run(as(A), `insert into public.coach_reviews (user_id, period_from, period_to, review, model_id, prompt_version) values ($1,'2026-10-01','2026-10-07','{}','m','p')`, [A]), /permission denied/);
    await denied(run(as(A), `update public.change_proposals set status = 'accepted' where id = $1`, [proposal]), /permission denied/);
  });

  it("B can neither see nor decide A's proposal", async () => {
    expect((await run(as(B), `select * from public.change_proposals`)).rowCount).toBe(0);
    await expect(run(as(B), `select public.decide_change_proposal($1, 'accepted')`, [proposal])).rejects.toThrow(/not found or already decided/);
  });

  it('unapproved, revoked and anonymous callers are refused', async () => {
    await denied(run(as(C), `select public.decide_change_proposal($1, 'accepted')`, [proposal]), /not authorized/);
    await denied(run(as(D), `select public.decide_change_proposal($1, 'accepted')`, [proposal]), /not authorized/);
    await denied(run(anon, `select public.decide_change_proposal($1, 'accepted')`, [proposal]), /permission denied/);
  });

  it('A records a decision exactly once', async () => {
    await expect(run(as(A), `select public.decide_change_proposal($1, 'maybe')`, [proposal])).rejects.toThrow(/invalid decision/);
    const r = await run<{ status: string }>(as(A), `select (public.decide_change_proposal($1, 'accepted')).status`, [proposal]);
    expect(r.rows[0]!.status).toBe('accepted');
    await expect(run(as(A), `select public.decide_change_proposal($1, 'rejected')`, [proposal])).rejects.toThrow(/already decided/);
  });
});

describe('grants audit', () => {
  it('every public table has RLS enabled and anon has no privileges', async () => {
    const noRls = await db.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(noRls.rows).toEqual([]);
    const anonGrants = await db.query(`select table_name, privilege_type from information_schema.role_table_grants
                                       where grantee = 'anon' and table_schema in ('public','private')`);
    expect(anonGrants.rows).toEqual([]);
    const privateGrants = await db.query(`select table_name, privilege_type from information_schema.role_table_grants
                                          where grantee = 'authenticated' and table_schema = 'private'`);
    expect(privateGrants.rows).toEqual([]);
  });

  it('every SECURITY DEFINER function pins an empty search_path', async () => {
    const r = await db.query(`select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where p.prosecdef and n.nspname in ('public','private')`);
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) expect(row.proconfig, row.proname).toContain('search_path=""');
  });
});
