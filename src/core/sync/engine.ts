/**
 * Foreground sync for one signed-in member: push pending outbox ops, then pull server changes.
 * Runs on app start, when the network returns, when the app becomes visible, shortly after local
 * saves, and on a slow foreground timer. Browsers do not guarantee background execution, so
 * nothing here promises that.
 */
import type { AggregateName, OutboxOp } from '@shared/contracts';
import type { Journal } from '@/core/database/journal';

export interface PushOp {
  op_id: string;
  collection: AggregateName;
  doc_id: string;
  kind: 'upsert' | 'delete';
  base_version: number;
  prior_op_ids: string[];
  body: unknown;
}

export type PushResult =
  | { op_id: string; status: 'applied' | 'duplicate'; server_version: number }
  | { op_id: string; status: 'conflict'; server_version: number; server_body: unknown; server_deleted: boolean };

export interface PullRow {
  collection: AggregateName;
  doc_id: string;
  version: number;
  change_seq: number;
  body: unknown;
  deleted: boolean;
}

export interface SyncTransport {
  push(ops: PushOp[]): Promise<PushResult[]>;
  pull(since: number, limit: number): Promise<PullRow[]>;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  conflicts: number;
  pending: number;
}

const BATCH = 50;
const PAGE = 200;

/** Group pending ops per document: the newest op carries the current record; older ids prove own prior writes. */
export function groupOps(ops: readonly OutboxOp[]): { latest: OutboxOp; all: OutboxOp[] }[] {
  const byDoc = new Map<string, OutboxOp[]>();
  for (const o of [...ops].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const k = `${o.aggregate}:${o.aggregate_id}`;
    byDoc.set(k, [...(byDoc.get(k) ?? []), o]);
  }
  return [...byDoc.values()].map((all) => ({ latest: all[all.length - 1]!, all }));
}

export async function syncOnce(journal: Journal, transport: SyncTransport): Promise<SyncReport> {
  const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, pending: 0 };
  const groups = groupOps(await journal.pendingOps());

  for (let i = 0; i < groups.length; i += BATCH) {
    const batch = groups.slice(i, i + BATCH);
    const ops: PushOp[] = [];
    for (const g of batch) {
      const body = await journal.db.get(g.latest.aggregate, g.latest.aggregate_id);
      if (!body) continue;
      ops.push({
        op_id: g.latest.op_id,
        collection: g.latest.aggregate,
        doc_id: g.latest.aggregate_id,
        kind: (body as { deleted_at?: string | null }).deleted_at ? 'delete' : 'upsert',
        base_version: await journal.serverVersion(g.latest.aggregate, g.latest.aggregate_id),
        prior_op_ids: g.all.slice(0, -1).map((o) => o.op_id),
        body,
      });
    }
    if (!ops.length) continue;
    const results = await transport.push(ops);
    const byId = new Map(results.map((r) => [r.op_id, r]));
    const acks: { op_id: string; aggregate: AggregateName; aggregate_id: string; server_version: number }[] = [];
    for (const g of batch) {
      const r = byId.get(g.latest.op_id);
      if (!r) continue;
      if (r.status === 'conflict') {
        report.conflicts++;
        await journal.recordConflict(g.latest.aggregate, g.latest.aggregate_id, g.latest.op_id, r.server_body, r.server_version);
        // Older ops for this document are superseded by the recorded conflict copy.
        await journal.acknowledge(g.all.slice(0, -1).map((o) => ({ op_id: o.op_id, aggregate: o.aggregate, aggregate_id: o.aggregate_id, server_version: r.server_version })));
        continue;
      }
      report.pushed++;
      for (const o of g.all) acks.push({ op_id: o.op_id, aggregate: o.aggregate, aggregate_id: o.aggregate_id, server_version: r.server_version });
    }
    // Ops created while this push was in flight keep their own (newer) entries in the outbox.
    await journal.acknowledge(acks);
  }

  let cursor = await journal.getCursor();
  for (;;) {
    const rows = await transport.pull(cursor, PAGE);
    for (const row of rows) {
      const res = await journal.applyRemote(row.collection, row.doc_id, row.body, row.version);
      if (res === 'applied') report.pulled++;
      cursor = Math.max(cursor, row.change_seq);
    }
    await journal.setCursor(cursor);
    if (rows.length < PAGE) break;
  }
  report.pending = (await journal.pendingOps()).length;
  return report;
}

const inFlight = new WeakSet<Journal>();

/** Run one sync unless one is already running for this journal (returns null then). */
export async function syncExclusive(journal: Journal, transport: SyncTransport): Promise<SyncReport | null> {
  if (inFlight.has(journal)) return null;
  inFlight.add(journal);
  try {
    return await syncOnce(journal, transport);
  } finally {
    inFlight.delete(journal);
  }
}
