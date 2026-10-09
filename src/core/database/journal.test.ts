import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MealEntry } from '@shared/contracts';
import { deleteJournalDB } from './db';
import { Journal, StorageWriteError } from './journal';
import { seedDemoIfEmpty } from './seed';

const OWNER = 'test-owner';
const meal = (over: Partial<MealEntry> = {}): MealEntry => ({
  id: crypto.randomUUID(),
  owner_id: OWNER,
  local_version: 0,
  created_at: '2026-10-09T12:00:00.000Z',
  updated_at: '2026-10-09T12:00:00.000Z',
  deleted_at: null,
  synthetic: true,
  preset_id: null,
  name: 'Dal katori',
  icon: 'bowl',
  slot: 'lunch',
  local_date: '2026-10-09',
  timezone: 'UTC',
  logged_at: '2026-10-09T12:00:00.000Z',
  quantity: 1,
  items: [{
    label: 'Dal', quantity: 1, unit_label: 'katori', grams: 180,
    nutrients: { energy_kcal: 150, protein_g: 8, carbs_g: 20, fat_g: 4, fiber_g: 5 },
    complete: { energy_kcal: true, protein_g: true, carbs_g: true, fat_g: true, fiber_g: true },
    source_kinds: ['synthetic_demo'], source_ref: { kind: 'recipe', id: crypto.randomUUID(), revision: 1 }, estimated: true,
  }],
  ...over,
});

let j: Journal;
beforeEach(async () => {
  await deleteJournalDB(OWNER);
  j = await Journal.open(OWNER);
});
afterEach(() => {
  j.close();
  vi.restoreAllMocks();
});

describe('atomic local save + outbox', () => {
  it('writes record and one pending outbox op together', async () => {
    const m = meal();
    const res = await j.commit('meal_entries', m);
    expect(res.status).toBe('saved');
    expect(await j.mealsOn('2026-10-09')).toHaveLength(1);
    const ops = await j.pendingOps();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ aggregate: 'meal_entries', aggregate_id: m.id, kind: 'upsert', base_version: 0 });
  });

  it('persists across closing and reopening (refresh / tab death)', async () => {
    await j.commit('meal_entries', meal());
    j.close();
    j = await Journal.open(OWNER);
    expect(await j.mealsOn('2026-10-09')).toHaveLength(1);
    expect(await j.pendingOps()).toHaveLength(1);
  });

  it('a retried op id is idempotent — no duplicate meal or op', async () => {
    const m = meal();
    const opId = crypto.randomUUID();
    await j.commit('meal_entries', m, 'upsert', opId);
    const again = await j.commit('meal_entries', m, 'upsert', opId);
    expect(again.status).toBe('duplicate');
    expect(await j.mealsOn('2026-10-09')).toHaveLength(1);
    expect(await j.pendingOps()).toHaveLength(1);
  });

  it('if the outbox write fails (e.g. quota), the record is NOT saved either', async () => {
    const m = meal();
    const origAdd = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'outbox') throw new DOMException('Simulated quota exceeded', 'QuotaExceededError');
      return origAdd.apply(this, args);
    });
    await expect(j.commit('meal_entries', m)).rejects.toBeInstanceOf(StorageWriteError);
    vi.restoreAllMocks();
    expect(await j.mealsOn('2026-10-09')).toHaveLength(0);
    expect(await j.pendingOps()).toHaveLength(0);
  });

  it('rejects invalid records and records for another owner', async () => {
    await expect(j.commit('meal_entries', meal({ quantity: 0 }))).rejects.toBeInstanceOf(StorageWriteError);
    await expect(j.commit('meal_entries', meal({ owner_id: 'someone-else' }))).rejects.toBeInstanceOf(StorageWriteError);
    expect(await j.pendingOps()).toHaveLength(0);
  });

  it('bumps local version and records base version for conflict detection', async () => {
    const m = meal();
    await j.commit('meal_entries', m);
    await j.commit('meal_entries', { ...m, quantity: 2 });
    const [stored] = await j.mealsOn('2026-10-09');
    expect(stored!.local_version).toBe(2);
    const ops = (await j.pendingOps()).sort((a, b) => a.base_version - b.base_version);
    expect(ops.map((o) => o.base_version)).toEqual([0, 1]);
  });

  it('deletion is a tombstone (hidden but retained for sync)', async () => {
    const m = meal();
    await j.commit('meal_entries', m);
    await j.remove('meal_entries', m);
    expect(await j.mealsOn('2026-10-09')).toHaveLength(0);
    const raw = await j.db.get('meal_entries', m.id);
    expect(raw!.deleted_at).not.toBeNull();
    expect((await j.pendingOps()).some((o) => o.kind === 'delete')).toBe(true);
  });
});

describe('profile separation and device state', () => {
  it('two profiles never see each other\'s records', async () => {
    await deleteJournalDB('other-owner');
    const other = await Journal.open('other-owner');
    await j.commit('meal_entries', meal());
    expect(await other.mealsOn('2026-10-09')).toHaveLength(0);
    expect(await other.pendingOps()).toHaveLength(0);
    other.close();
  });

  it('rest timer end timestamp survives reopen', async () => {
    const t = { session_id: crypto.randomUUID(), set_id: crypto.randomUUID(), ends_at_ms: 1_800_000_000_000, duration_seconds: 90 };
    await j.setTimer(t);
    j.close();
    j = await Journal.open(OWNER);
    expect(await j.getTimer()).toEqual(t);
  });
});

describe('demo seed', () => {
  it('seeds synthetic library + history once, leaving today empty', async () => {
    await deleteJournalDB('demo-a');
    const demo = await Journal.open('demo-a');
    expect(await seedDemoIfEmpty(demo, 'demo-a', '2026-10-09', 'UTC')).toBe(true);
    expect(await seedDemoIfEmpty(demo, 'demo-a', '2026-10-09', 'UTC')).toBe(false);
    const lib = await demo.library();
    expect(lib.presets.length).toBeGreaterThanOrEqual(10);
    expect(await demo.mealsOn('2026-10-09')).toHaveLength(0);
    const sessions = await demo.sessions();
    expect(sessions.length).toBeGreaterThan(10);
    expect(sessions.every((s) => s.synthetic && s.status === 'finished')).toBe(true);
    expect(await demo.pendingOps()).toHaveLength(0); // synthetic history is never queued for sync
    const exp = await demo.exportAll();
    expect(exp.owner_id).toBe('demo-a');
    demo.close();
  });
});
