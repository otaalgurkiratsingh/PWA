import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { PROFILE_DOC_ID } from '@shared/contracts';
import type {
  ExerciseDefinition,
  SettingsDoc,
  DailyHealthSummary,
  DailyLogStatus,
  FoodVersion,
  MealEntry,
  MealPreset,
  OutboxOp,
  ProgramVersion,
  RecipeRevision,
  WeightEntry,
  WorkoutSession,
} from '@shared/contracts';

/** Bump when the object-store layout changes; add an upgrade branch, never drop user stores. */
export const DB_VERSION = 2;

export interface JournalSchema extends DBSchema {
  meta: { key: string; value: unknown };
  foods: { key: string; value: FoodVersion };
  recipes: { key: string; value: RecipeRevision };
  presets: { key: string; value: MealPreset };
  programs: { key: string; value: ProgramVersion };
  meal_entries: { key: string; value: MealEntry; indexes: { by_date: string } };
  workout_sessions: { key: string; value: WorkoutSession; indexes: { by_date: string; by_status: string } };
  weight_entries: { key: string; value: WeightEntry; indexes: { by_date: string } };
  daily_health: { key: string; value: DailyHealthSummary; indexes: { by_date: string } };
  daily_log_status: { key: string; value: DailyLogStatus };
  outbox: { key: string; value: OutboxOp; indexes: { by_status: string; by_aggregate: string } };
  // v2
  exercises: { key: string; value: ExerciseDefinition };
  settings: { key: string; value: SettingsDoc };
  /** Last server-acknowledged version per document, the pull cursor, and conflict copies. */
  sync_state: { key: string; value: unknown };
}

export type JournalDB = IDBPDatabase<JournalSchema>;

/** One database per profile: switching profiles never mixes records, drafts, or outbox. */
export function dbNameFor(profileId: string): string {
  return `rozana-journal-${profileId}`;
}


export async function openJournalDB(profileId: string): Promise<JournalDB> {
  return openDB<JournalSchema>(dbNameFor(profileId), DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('meta');
        db.createObjectStore('foods', { keyPath: 'id' });
        db.createObjectStore('recipes', { keyPath: 'id' });
        db.createObjectStore('presets', { keyPath: 'id' });
        db.createObjectStore('programs', { keyPath: 'id' });
        db.createObjectStore('meal_entries', { keyPath: 'id' }).createIndex('by_date', 'local_date');
        const ws = db.createObjectStore('workout_sessions', { keyPath: 'id' });
        ws.createIndex('by_date', 'local_date');
        ws.createIndex('by_status', 'status');
        db.createObjectStore('weight_entries', { keyPath: 'id' }).createIndex('by_date', 'local_date');
        db.createObjectStore('daily_health', { keyPath: 'id' }).createIndex('by_date', 'local_date');
        db.createObjectStore('daily_log_status', { keyPath: 'local_date' });
        const ob = db.createObjectStore('outbox', { keyPath: 'op_id' });
        ob.createIndex('by_status', 'status');
        ob.createIndex('by_aggregate', 'aggregate_id');
      }
      if (oldVersion < 2) {
        db.createObjectStore('exercises', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'id' });
        db.createObjectStore('sync_state');
        // Move the v1 device-only profile into a syncable settings document. Nothing is dropped.
        const meta = tx.objectStore('meta');
        void meta.get('profile').then((p) => {
          if (!p || typeof p !== 'object') return;
          const now = new Date().toISOString();
          const prof = p as { id: string; synthetic?: boolean };
          void tx.objectStore('settings').put({
            id: PROFILE_DOC_ID, owner_id: prof.id, local_version: 1, created_at: now, updated_at: now,
            deleted_at: null, synthetic: prof.synthetic ?? false, profile: p as SettingsDoc['profile'],
          });
        });
      }
    },
    blocked() {
      // Another tab holds an older version open; the app shows a reload prompt via the error path.
    },
  });
}

export async function deleteJournalDB(profileId: string): Promise<void> {
  await deleteDB(dbNameFor(profileId));
}
