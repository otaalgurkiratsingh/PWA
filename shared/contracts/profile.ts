import { z } from 'zod';
import { LoadUnit, TimeZone } from './common';

export const Goal = z.enum(['consistency', 'maintenance', 'fat_loss', 'strength', 'muscle_gain']);

/** Targets are optional; journaling works without them. */
export const Targets = z.object({
  energy_kcal: z.number().positive().nullable(),
  protein_g: z.number().positive().nullable(),
  /** Where the target came from (existing plan, qualified guidance, synthetic demo). */
  source: z.string().max(200),
});
export type Targets = z.infer<typeof Targets>;

export const LocalProfile = z.object({
  id: z.string().min(1),
  nickname: z.string().min(1).max(40),
  units: LoadUnit,
  timezone: TimeZone,
  goal: Goal,
  targets: Targets.nullable(),
  synthetic: z.boolean(),
});
export type LocalProfile = z.infer<typeof LocalProfile>;
