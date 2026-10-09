import type { ZodType } from 'zod';
import {
  DailyHealthSummary,
  DailyLogStatus,
  LocalProfile,
  MealEntry,
  RestTimer,
  WeightEntry,
  WorkoutSession,
  type AggregateName,
  type FoodVersion,
  type MealPreset,
  type OutboxOp,
  type ProgramVersion,
  type RecipeRevision,
} from '@shared/contracts';
import { openJournalDB, type JournalDB } from './db';
import { newId } from '../ids';

type AggregateRecord = {
  meal_entries: MealEntry;
  workout_sessions: WorkoutSession;
  weight_entries: WeightEntry;
  daily_health: DailyHealthSummary;
  daily_log_status: DailyLogStatus;
};

const SCHEMAS: { [K in AggregateName]: ZodType<AggregateRecord[K]> } = {
  meal_entries: MealEntry,
  workout_sessions: WorkoutSession,
  weight_entries: WeightEntry,
  daily_health: DailyHealthSummary,
  daily_log_status: DailyLogStatus,
};

export class StorageWriteError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

export type CommitResult = { status: 'saved'; op_id: string } | { status: 'duplicate'; op_id: string };

export interface JournalOptions {
  now?: () => Date;
  newId?: () => string;
}

function keyOf(store: AggregateName, rec: AggregateRecord[AggregateName]): string {
  return store === 'daily_log_status' ? (rec as DailyLogStatus).local_date : (rec as { id: string }).id;
}

/**
 * Local-first journal for ONE profile. Every user change is written together with an
 * outbox operation in a single IndexedDB transaction: either both persist or neither does.
 */
export class Journal {
  private readonly now: () => Date;
  private readonly newId: () => string;

  private constructor(readonly db: JournalDB, readonly ownerId: string, opts: JournalOptions) {
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? (() => newId());
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
      const next: Record<string, unknown> = { ...parsed.data, updated_at: nowIso };
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

  async library(): Promise<{ foods: FoodVersion[]; recipes: RecipeRevision[]; presets: MealPreset[]; programs: ProgramVersion[] }> {
    const [foods, recipes, presets, programs] = await Promise.all([
      this.db.getAll('foods'),
      this.db.getAll('recipes'),
      this.db.getAll('presets'),
      this.db.getAll('programs'),
    ]);
    return { foods, recipes, presets: presets.filter((p) => p.deleted_at === null), programs };
  }

  async pendingOps(): Promise<OutboxOp[]> {
    return this.db.getAllFromIndex('outbox', 'by_status', 'pending');
  }

  // ---- device-only meta (not synced) ----------------------------------------
  async getProfile(): Promise<LocalProfile | null> {
    const raw = await this.db.get('meta', 'profile');
    const p = LocalProfile.safeParse(raw);
    return p.success ? p.data : null;
  }

  async setProfile(p: LocalProfile): Promise<void> {
    await this.db.put('meta', LocalProfile.parse(p), 'profile');
  }

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

  /** Owner-scoped export in an open format (JSON). */
  async exportAll(): Promise<Record<string, unknown>> {
    const stores = ['foods', 'recipes', 'presets', 'programs', 'meal_entries', 'workout_sessions', 'weight_entries', 'daily_health', 'daily_log_status'] as const;
    const out: Record<string, unknown> = {
      format: 'rozana-export',
      format_version: 1,
      exported_at: this.now().toISOString(),
      owner_id: this.ownerId,
      profile: await this.getProfile(),
      pending_outbox_ops: (await this.pendingOps()).length,
    };
    for (const s of stores) out[s] = await this.db.getAll(s);
    return out;
  }
}
