import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MealEntry } from '@shared/contracts';
import { deleteJournalDB } from '@/core/database/db';
import { Journal } from '@/core/database/journal';
import { syncOnce, type PullRow, type PushOp, type PushResult, type SyncTransport } from './engine';

const OWNER = '11111111-1111-4111-8111-111111111111';
const meal = (over: Partial<MealEntry> = {}): MealEntry => ({
  id: crypto.randomUUID(), owner_id: OWNER, local_version: 0, created_at: '2026-10-09T12:00:00.000Z', updated_at: '2026-10-09T12:00:00.000Z',
  deleted_at: null, synthetic: false, preset_id: null, name: 'Dal', icon: 'dal', slot: 'lunch', local_date: '2026-10-09', timezone: 'UTC',
  logged_at: '2026-10-09T12:00:00.000Z', quantity: 1,
  items: [{ label: 'Dal', quantity: 1, unit_label: 'bowl', grams: 180, nutrients: { energy_kcal: 150, protein_g: 8, carbs_g: 20, fat_g: 4, fiber_g: 5 },
    complete: { energy_kcal: true }, source_kinds: ['label'], source_ref: { kind: 'food', id: crypto.randomUUID(), revision: 1 }, estimated: false }],
  ...over,
});

/** In-memory model of the server's sync_push/sync_pull rules (mirrors the SQL). */
class FakeServer implements SyncTransport {
  docs = new Map<string, { version: number; seq: number; body: unknown; deleted: boolean }>();
  receipts = new Map<string, { key: string; version: number }>();
  seq = 0;
  offline = false;
  dropNextReply = false;
  pushes: PushOp[][] = [];
  async push(ops: PushOp[]): Promise<PushResult[]> {
    if (this.offline) throw new Error('offline');
    this.pushes.push(ops);
    const out: PushResult[] = [];
    for (const op of ops) {
      const key = `${op.collection}:${op.doc_id}`;
      const r = this.receipts.get(op.op_id);
      if (r) { out.push({ op_id: op.op_id, status: 'duplicate', server_version: r.version }); continue; }
      const ex = this.docs.get(key);
      const ownPrior = ex && op.prior_op_ids.some((id) => { const rr = this.receipts.get(id); return rr?.key === key && rr.version === ex.version; });
      if (ex && ex.version !== op.base_version && !ownPrior) {
        out.push({ op_id: op.op_id, status: 'conflict', server_version: ex.version, server_body: ex.body, server_deleted: ex.deleted });
        continue;
      }
      const version = (ex?.version ?? 0) + 1;
      this.docs.set(key, { version, seq: ++this.seq, body: op.body, deleted: op.kind === 'delete' });
      this.receipts.set(op.op_id, { key, version });
      out.push({ op_id: op.op_id, status: 'applied', server_version: version });
    }
    if (this.dropNextReply) { this.dropNextReply = false; throw new Error('reply lost'); }
    return out;
  }
  async pull(since: number, limit: number): Promise<PullRow[]> {
    if (this.offline) throw new Error('offline');
    return [...this.docs.entries()].filter(([, d]) => d.seq > since).sort((a, b) => a[1].seq - b[1].seq).slice(0, limit)
      .map(([k, d]) => { const [collection, doc_id] = k.split(/:(.+)/) as [PullRow['collection'], string]; return { collection, doc_id, version: d.version, change_seq: d.seq, body: d.body, deleted: d.deleted }; });
  }
}

let phone: Journal;
let laptop: Journal;
let server: FakeServer;
beforeEach(async () => {
  // Two devices of the same member: same owner id, separate local databases.
  await deleteJournalDB(OWNER);
  phone = await Journal.open(OWNER);
  laptop = await openSecondDevice();
  server = new FakeServer();
});
afterEach(() => { phone.close(); laptop.close(); });

async function openSecondDevice(): Promise<Journal> {
  // Same owner, different IndexedDB name: emulate by a renamed database via a separate fake-indexeddb factory.
  const { IDBFactory } = await import('fake-indexeddb');
  const original = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  try {
    return await Journal.open(OWNER);
  } finally {
    globalThis.indexedDB = original;
  }
}

describe('sync engine', () => {
  it('works offline first, then backs up and empties the outbox', async () => {
    server.offline = true;
    await phone.commit('meal_entries', meal());
    await expect(syncOnce(phone, server)).rejects.toThrow();
    expect(await phone.pendingOps()).toHaveLength(1); // nothing lost while offline
    server.offline = false;
    const r = await syncOnce(phone, server);
    expect(r).toMatchObject({ pushed: 1, conflicts: 0, pending: 0 });
  });

  it('several edits to one document push once, as the latest state', async () => {
    const m = meal();
    await phone.commit('meal_entries', m);
    await phone.commit('meal_entries', { ...m, quantity: 2 });
    await phone.commit('meal_entries', { ...m, quantity: 3 });
    await syncOnce(phone, server);
    expect(server.pushes[0]).toHaveLength(1);
    expect((server.pushes[0]![0]!.body as MealEntry).quantity).toBe(3);
  });

  it('a lost reply does not duplicate or conflict on retry, even after another edit', async () => {
    const m = meal();
    await phone.commit('meal_entries', m);
    server.dropNextReply = true;
    await expect(syncOnce(phone, server)).rejects.toThrow('reply lost');
    await phone.commit('meal_entries', { ...m, quantity: 2 });
    const r = await syncOnce(phone, server);
    expect(r).toMatchObject({ conflicts: 0, pending: 0 });
    expect(server.docs.size).toBe(1);
    expect((server.docs.get(`meal_entries:${m.id}`)!.body as MealEntry).quantity).toBe(2);
  });

  it('a second device receives changes, and concurrent stale edits keep a recoverable copy', async () => {
    const m = meal();
    await phone.commit('meal_entries', m);
    await syncOnce(phone, server);
    await syncOnce(laptop, server);
    expect((await laptop.mealsOn('2026-10-09'))[0]!.id).toBe(m.id);

    await phone.commit('meal_entries', { ...m, quantity: 2 });
    const onLaptop = (await laptop.mealsOn('2026-10-09'))[0]!;
    await laptop.commit('meal_entries', { ...onLaptop, quantity: 5 });
    await syncOnce(phone, server);
    const r = await syncOnce(laptop, server);
    expect(r.conflicts).toBe(1);
    expect((await laptop.mealsOn('2026-10-09'))[0]!.quantity).toBe(2); // server version shown
    expect((await laptop.conflicts())[0]!.local).toMatchObject({ quantity: 5 }); // nothing silently lost
  });

  it('deletions sync as tombstones and are not resurrected', async () => {
    const m = meal();
    await phone.commit('meal_entries', m);
    await syncOnce(phone, server);
    await syncOnce(laptop, server);
    const cur = await phone.db.get('meal_entries', m.id);
    await phone.remove('meal_entries', cur!);
    await syncOnce(phone, server);
    await syncOnce(laptop, server);
    expect(await laptop.mealsOn('2026-10-09')).toHaveLength(0);
    await syncOnce(phone, server);
    expect(await phone.mealsOn('2026-10-09')).toHaveLength(0);
  });
});
