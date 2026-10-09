import { z } from 'zod';

/** UUID (v4 or similar) used for every aggregate and op id. */
export const Id = z.string().uuid();
export type Id = z.infer<typeof Id>;

/** Calendar date in the user's own timezone, YYYY-MM-DD. */
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export type LocalDate = z.infer<typeof LocalDate>;

/** UTC instant, ISO-8601. */
export const Instant = z.string().datetime({ offset: true });

/** IANA timezone name, e.g. America/Toronto. */
export const TimeZone = z.string().min(1).max(64);

/** Finite, strictly positive quantity. Missing data is null, never 0. */
export const PositiveQty = z.number().finite().positive();

export const LoadUnit = z.enum(['kg', 'lb']);
export type LoadUnit = z.infer<typeof LoadUnit>;

/**
 * Fields every locally stored personal aggregate carries.
 * `local_version` is a device-side counter; once cloud sync exists the
 * authoritative `version` is assigned by the server only.
 */
export const AggregateBase = z.object({
  id: Id,
  owner_id: z.string().min(1),
  local_version: z.number().int().nonnegative(),
  created_at: Instant,
  updated_at: Instant,
  deleted_at: Instant.nullable(),
  /** True for generated demo records. The UI labels these visibly. */
  synthetic: z.boolean(),
});
