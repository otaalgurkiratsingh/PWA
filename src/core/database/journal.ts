import type { ZodType } from 'zod';
import {
  DailyHealthSummary,
  DailyLogStatus,
  ExerciseDefinition,
  FoodVersion,
  LocalProfile,
  MealEntry,
  MealPreset,
  PROFILE_DOC_ID,
  ProgramVersion,
  RecipeRevision,
  RestTimer,
  SettingsDoc,
  WeightEntry,
  WorkoutSession,
  type AggregateName,
  type OutboxOp,
} from '@shared/contracts';
import { openJournalDB, type JournalDB } from './db';
import { newId } from '../ids';

export type AggregateRecord = {
  meal_entries: MealEntry;
  workout_sessions: WorkoutSession;
  weight_entries: WeightEntry;
  daily_health: DailyHealthSummary;
  daily_log_status: DailyLogStatus;
  foods: FoodVersion;
  recipes: RecipeRevision;
  presets: MealPreset;
  programs: ProgramVersion;
  exercises: ExerciseDefinition;
  settings: SettingsDoc;
};

export const AGGREGATES: readonly AggregateName[] = [
  'settings', 'foods', 'recipes', 'presets', 'programs', 'exercises',
  'meal_entries', 'workout_sessions', 'weight_entries', 'daily_health', 'daily_log_status',
];

export const SCHEMAS: { [K in AggregateName]: ZodType<AggregateRecord[K]> } = {
  meal_entries: MealEntry,
  workout_sessions: WorkoutSession,
  weight_entries: WeightEntry,
  daily_health: DailyHealthSummary,
  daily_log_status: DailyLogStatus,
  foods: FoodVersion,
  recipes: RecipeRevision,
  presets: MealPreset,
  programs: ProgramVersion,
  exercises: ExerciseDefinition,
  settings: SettingsDoc,
} as never;

export class StorageWriteError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

export type CommitResult = { status: 'saved'; op_id: string } | { status: 'duplicate'; op_id: string };

export interface JournalOptions {
  now?: () => Date;
  newId?: () => string;
  /** Called after every successful local commit (used to schedule a background sync). */
  onCommit?: () => void;
}

export function keyOf(store: AggregateName, rec: unknown): string {
  return store === 'daily_log_status' ? (rec as DailyLogStatus).local_date : (rec as { id: string }).id;
}

export interface ConflictCopy {
  aggregate: AggregateName;
  aggregate_id: string;
  /** The local version that lost to a newer cloud edit — kept so nothing is silently lost. */
  local: unknown;
  saved_at: string;
}

export interface RestoreResult {
  written: number;
  skipped: number;
  rejected: string[];
}

/**
 * Local-first journal for ONE profile/account. Every user change is written together with an
 * outbox operation in a single IndexedDB transaction: either both persist or neither does.
 */
export class Journal {
  private readonly now: () => Date;
  private readonly newId: () => string;
  onCommit: (() => void) | undefined;

  private constructor(readonly db: JournalDB, readonly ownerId: string, opts: JournalOptions) {
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? (() => newId());
    this.onCommit = opts.onCommit;
  }

  static async open(ownerId: string, opts: JournalOptions = {}): Promise<Journal> {
    return new Journal(await openJournalDB(ownerId), ownerId, opts);
  }

  close() {
    this.db.close();
  }

  /**
   * Validate, bump the local version, and write record + outbox op atomically.
   * Passing the same opId twice is idempotent: the second call changes nothing.
   */
  async commit<K extends AggregateName>(
    store: K,
    record: AggregateRecord[K],
    kind: OutboxOp['kind'] = 'upsert',
    opId: string = this.newId(),
  ): Promise<CommitResult> {
    const nowIso = this.now().toISOString();
    if ((record as { owner_id: string }).owner_id !== this.ownerId) {
      throw new StorageWriteError('Record owner does not match the open profile');
    }
    const parsed = SCHEMAS[store].safeParse(record);
    if (!parsed.success) throw new StorageWriteError(`Invalid ${store} record: ${parsed.error.message}`);

    const tx = this.db.transaction([store, 'outbox'], 'readwrite');
    try {
      const outbox = tx.objectStore('outbox');
      if (await outbox.get(opId)) {
        await tx.done;
        return { status: 'duplicate', op_id: opId };
      }
      const key = keyOf(store, parsed.data);
      const objectStore = tx.objectStore(store);
      const existing = (await objectStore.get(key)) as Record<string, unknown> | undefined;
      const baseVersion = typeof existing?.local_version === 'number' ? existing.local_version : 0;
      const next: Record<string, unknown> = { ...(parsed.data as object), updated_at: nowIso };
      if ('local_version' in next) next.local_version = baseVersion + 1;
      if (kind === 'delete' && 'deleted_at' in next) next.deleted_at = nowIso;
      await objectStore.put(next as never);
      await outbox.add({
        op_id: opId,
        aggregate: store,
        aggregate_id: key,
        kind,
        base_version: baseVersion,
        created_at: nowIso,
        status: 'pending',
      });
      await tx.done;
      this.onCommit?.();
      return { status: 'saved', op_id: opId };
    } catch (err) {
      try {
        tx.abort();
      } catch {
        // already finished/aborted
      }
      await tx.done.catch(() => undefined);
      throw new StorageWriteError(`Could not save ${store} on this device`, err);
    }
  }

  /** Deletion is a tombstone so a later sync cannot resurrect the record. */
  async remove<K extends Exclude<AggregateName, 'daily_log_status'>>(store: K, record: AggregateRecord[K]) {
    return this.commit(store, record, 'delete');
  }

  // ---- reads ----------------------------------------------------------------
  async mealsOn(date: string): Promise<MealEntry[]> {
    const rows = await this.db.getAllFromIndex('meal_entries', 'by_date', date);
    return rows.filter((r) => r.deleted_at === null).sort((a, b) => a.logged_at.localeCompare(b.logged_at));
  }

  async mealsBetween(from: string, to: string): Promise<MealEntry[]> {
    const rows = await this.db.getAllFromIndex('meal_entries', 'by_date', IDBKeyRange.bound(from, to));
    return rows.filter((r) => r.deleted_at === null);
  }

  async sessions(): Promise<WorkoutSession[]> {
    const rows = await this.db.getAll('workout_sessions');
    return rows.filter((r) => r.deleted_at === null).sort((a, b) => b.started_at.localeCompare(a.started_at));
  }

  async activeSession(): Promise<WorkoutSession | null> {
    const rows = await this.db.getAllFromIndex('workout_sessions', 'by_status', 'active');
    return rows.filter((r) => r.deleted_at === null).sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null;
  }

  async weightsBetween(from: string, to: string): Promise<WeightEntry[]> {
    const rows = await this.db.getAllFromIndex('weight_entries', 'by_date', IDBKeyRange.bound(from, to));
    return rows.filter((r) => r.deleted_at === null);
  }

  async healthBetween(from: string, to: string): Promise<DailyHealthSummary[]> {
    return this.db.getAllFromIndex('daily_health', 'by_date', IDBKeyRange.bound(from, to));
  }

  async logStatuses(): Promise<DailyLogStatus[]> {
    return this.db.getAll('daily_log_status');
  }

  async library(): Promise<{
    foods: FoodVersion[];
    recipes: RecipeRevision[];
    presets: MealPreset[];
    programs: ProgramVersion[];
    exercises: ExerciseDefinition[];
  }> {
    const [foods, recipes, presets, programs, exercises] = await Promise.all([
      this.db.getAll('foods'),
      this.db.getAll('recipes'),
      this.db.getAll('presets'),
      this.db.getAll('programs'),
      this.db.getAll('exercises'),
    ]);
    return {
      foods,
      recipes,
      presets: presets.filter((p) => p.deleted_at === null),
      programs: programs.filter((p) => p.deleted_at === null),
      exercises: exercises.filter((e) => e.deleted_at === null),
    };
  }

  /** The newest program version (highest version number of the newest program). */
  async currentProgram(): Promise<ProgramVersion | null> {
    const all = (await this.db.getAll('programs')).filter((p) => p.deleted_at === null);
    return all.sort((a, b) => b.version - a.version || b.created_at.localeCompare(a.created_at))[0] ?? null;
  }

  async pendingOps(): Promise<OutboxOp[]> {
    return this.db.getAllFromIndex('outbox', 'by_status', 'pending');
  }

  // ---- profile (synced settings document) ------------------------------------
  async getProfile(): Promise<LocalProfile | null> {
    const doc = await this.db.get('settings', PROFILE_DOC_ID);
    const p = LocalProfile.safeParse(doc?.profile);
    if (p.success) return p.data;
    // v1 fallback (pre-migration demo data)
    const legacy = LocalProfile.safeParse(await this.db.get('meta', 'profile'));
    return legacy.success ? legacy.data : null;
  }

  async setProfile(p: LocalProfile): Promise<void> {
    const profile = LocalProfile.parse({ ...p, updated_at: this.now().toISOString() });
    const existing = await this.db.get('settings', PROFILE_DOC_ID);
    const nowIso = this.now().toISOString();
    await this.commit('settings', {
      id: PROFILE_DOC_ID,
      owner_id: this.ownerId,
      local_version: existing?.local_version ?? 0,
      created_at: existing?.created_at ?? nowIso,
      updated_at: nowIso,
      deleted_at: null,
      synthetic: profile.synthetic,
      profile,
    });
  }

  // ---- device-only meta (not synced) ----------------------------------------
  async getTimer(): Promise<RestTimer | null> {
    const t = RestTimer.safeParse(await this.db.get('meta', 'rest_timer'));
    return t.success ? t.data : null;
  }

  async setTimer(t: RestTimer | null): Promise<void> {
    if (t) await this.db.put('meta', RestTimer.parse(t), 'rest_timer');
    else await this.db.delete('meta', 'rest_timer');
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.get('meta', key)) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.put('meta', value, key);
  }

  // ---- sync support -----------------------------------------------------------
  async serverVersion(aggregate: AggregateName, id: string): Promise<number> {
    return ((await this.db.get('sync_state', `sv:${aggregate}:${id}`)) as number | undefined) ?? 0;
  }

  /** Mark ops acknowledged by the server: drop them from the outbox and remember the server version. */
  async acknowledge(acks: readonly { op_id: string; aggregate: AggregateName; aggregate_id: string; server_version: number }[]) {
    const tx = this.db.transaction(['outbox', 'sync_state'], 'readwrite');
    for (const a of acks) {
      void tx.objectStore('outbox').delete(a.op_id);
      void tx.objectStore('sync_state').put(a.server_version, `sv:${a.aggregate}:${a.aggregate_id}`);
    }
    await tx.done;
  }

  /**
   * Apply a document pulled from the cloud. Skipped when this device has a pending change for the
   * same document (that change will be pushed and conflict-checked by the server instead).
   */
  async applyRemote(aggregate: AggregateName, id: string, body: unknown, serverVersion: number): Promise<'applied' | 'pending_local' | 'invalid'> {
    const pending = await this.db.getAllFromIndex('outbox', 'by_aggregate', id);
    if (pending.some((o) => o.aggregate === aggregate && o.status === 'pending')) return 'pending_local';
    const parsed = SCHEMAS[aggregate].safeParse(body);
    if (!parsed.success || (parsed.data as { owner_id: string }).owner_id !== this.ownerId) return 'invalid';
    const tx = this.db.transaction([aggregate, 'sync_state'], 'readwrite');
    void tx.objectStore(aggregate).put(parsed.data as never);
    void tx.objectStore('sync_state').put(serverVersion, `sv:${aggregate}:${id}`);
    await tx.done;
    return 'applied';
  }

  /** Keep the losing local copy of a conflicting edit, then accept the cloud version. */
  async recordConflict(aggregate: AggregateName, id: string, opId: string, serverBody: unknown, serverVersion: number) {
    const local = await this.db.get(aggregate, id);
    const conflicts = ((await this.db.get('sync_state', 'conflicts')) as ConflictCopy[] | undefined) ?? [];
    conflicts.push({ aggregate, aggregate_id: id, local, saved_at: this.now().toISOString() });
    const tx = this.db.transaction([aggregate, 'outbox', 'sync_state'], 'readwrite');
    void tx.objectStore('outbox').delete(opId);
    void tx.objectStore('sync_state').put(conflicts.slice(-50), 'conflicts');
    void tx.objectStore('sync_state').put(serverVersion, `sv:${aggregate}:${id}`);
    const parsed = SCHEMAS[aggregate].safeParse(serverBody);
    if (parsed.success) void tx.objectStore(aggregate).put(parsed.data as never);
    await tx.done;
  }

  async conflicts(): Promise<ConflictCopy[]> {
    return ((await this.db.get('sync_state', 'conflicts')) as ConflictCopy[] | undefined) ?? [];
  }

  /** Restore a kept local copy as a new edit (it will sync over the cloud version). */
  async restoreConflict(index: number): Promise<void> {
    const list = await this.conflicts();
    const c = list[index];
    if (!c) return;
    const current = (await this.db.get(c.aggregate, c.aggregate_id)) as { local_version?: number } | undefined;
    await this.commit(c.aggregate, { ...(c.local as object), local_version: current?.local_version ?? 0 } as never);
    list.splice(index, 1);
    await this.db.put('sync_state', list, 'conflicts');
  }

  async dismissConflict(index: number): Promise<void> {
    const list = await this.conflicts();
    list.splice(index, 1);
    await this.db.put('sync_state', list, 'conflicts');
  }

  async getCursor(): Promise<number> {
    return ((await this.db.get('sync_state', 'cursor')) as number | undefined) ?? 0;
  }

  async setCursor(c: number): Promise<void> {
    await this.db.put('sync_state', c, 'cursor');
  }

  // ---- export / restore -------------------------------------------------------
  /** Owner-scoped export in an open format (JSON). */
  async exportAll(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {
      format: 'rozana-export',
      format_version: 2,
      exported_at: this.now().toISOString(),
      owner_id: this.ownerId,
      profile: await this.getProfile(),
      pending_outbox_ops: (await this.pendingOps()).length,
    };
    for (const s of AGGREGATES) out[s] = await this.db.getAll(s);
    return out;
  }

  /**
   * Restore an export into THIS profile. Only exports from the same owner are accepted.
   * Each record is validated; a record is written when it is missing here or the file's copy
   * is newer. Written records go through the outbox so they back up again.
   */
  async restore(data: unknown): Promise<RestoreResult> {
    const result: RestoreResult = { written: 0, skipped: 0, rejected: [] };
    if (!data || typeof data !== 'object') throw new StorageWriteError('That file is not a Rozana export.');
    const d = data as Record<string, unknown>;
    if (d.format !== 'rozana-export' && d.format !== 'aapnafit-export') throw new StorageWriteError('That file is not a Rozana export.');
    if (d.owner_id !== this.ownerId) throw new StorageWriteError('This export belongs to a different account or profile.');
    for (const store of AGGREGATES) {
      const rows = d[store];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const parsed = SCHEMAS[store].safeParse(row);
        if (!parsed.success || (parsed.data as { owner_id: string }).owner_id !== this.ownerId) {
          result.rejected.push(`${store}: invalid record`);
          continue;
        }
        const key = keyOf(store, parsed.data);
        const existing = (await this.db.get(store, key)) as { updated_at?: string; local_version?: number } | undefined;
        const incoming = parsed.data as { updated_at?: string };
        if (existing && (existing.updated_at ?? '') >= (incoming.updated_at ?? '')) {
          result.skipped++;
          continue;
        }
        await this.commit(store, { ...(parsed.data as object), local_version: existing?.local_version ?? 0 } as never);
        result.written++;
      }
    }
    return result;
  }
}
