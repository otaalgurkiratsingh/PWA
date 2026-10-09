import { z } from 'zod';
import { AggregateBase, Instant, LoadUnit, LocalDate, PositiveQty, TimeZone } from './common';

export const WeightEntry = AggregateBase.extend({
  local_date: LocalDate,
  timezone: TimeZone,
  measured_at: Instant,
  value: PositiveQty,
  unit: LoadUnit,
});
export type WeightEntry = z.infer<typeof WeightEntry>;

export const HealthMetric = z.enum(['steps', 'sleep_minutes']);
export type HealthMetric = z.infer<typeof HealthMetric>;

/** A daily health summary. Absent = unknown. Source is always shown. */
export const DailyHealthSummary = z.object({
  id: z.string(), // `${metric}:${local_date}`
  owner_id: z.string(),
  metric: HealthMetric,
  local_date: LocalDate,
  timezone: TimeZone,
  value: z.number().int().nonnegative(),
  /** PWA phase: manual only. No live device connection exists. */
  source: z.enum(['manual', 'import_file', 'screenshot_confirmed']),
  recorded_at: Instant,
  synthetic: z.boolean(),
});
export type DailyHealthSummary = z.infer<typeof DailyHealthSummary>;
