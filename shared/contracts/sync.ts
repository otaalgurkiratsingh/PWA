import { z } from 'zod';
import { Id, Instant } from './common';

export const AggregateName = z.enum([
  'meal_entries',
  'workout_sessions',
  'weight_entries',
  'daily_health',
  'daily_log_status',
  'foods',
  'recipes',
  'presets',
  'programs',
  'exercises',
  'settings',
]);
export type AggregateName = z.infer<typeof AggregateName>;

/**
 * Outbox operation, written in the SAME IndexedDB transaction as the record change.
 * The server (Phase 1+) treats op_id as an idempotency key and assigns authoritative versions.
 */
export const OutboxOp = z.object({
  op_id: Id,
  aggregate: AggregateName,
  aggregate_id: z.string(),
  kind: z.enum(['upsert', 'delete']),
  /** Local version the change was based on, used for conflict detection. */
  base_version: z.number().int().nonnegative(),
  created_at: Instant,
  status: z.enum(['pending', 'acked', 'conflict']),
});
export type OutboxOp = z.infer<typeof OutboxOp>;
