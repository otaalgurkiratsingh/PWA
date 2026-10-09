import { z } from 'zod';
import { LoadUnit, TimeZone } from './common';

export const Goal = z.enum(['consistency', 'maintenance', 'fat_loss', 'strength', 'muscle_gain']);
export type Goal = z.infer<typeof Goal>;

/** Targets are optional; journaling works without them. */
export const Targets = z.object({
  energy_kcal: z.number().positive().nullable(),
  protein_g: z.number().positive().nullable(),
  /** Where the target came from (existing plan, qualified guidance, synthetic demo). */
  source: z.string().max(200),
});
export type Targets = z.infer<typeof Targets>;

export const Consent = z.object({
  /** Back up this journal to the private cloud project. */
  cloud_backup: z.boolean(),
  /** Allow sending minimal summaries/photos to the AI provider through the backend. */
  ai_processing: z.boolean(),
  updated_at: z.string().nullable(),
});
export type Consent = z.infer<typeof Consent>;

export const LocalProfile = z.object({
  id: z.string().min(1),
  nickname: z.string().min(1).max(40),
  units: LoadUnit,
  timezone: TimeZone,
  goal: Goal,
  targets: Targets.nullable(),
  synthetic: z.boolean(),
  adult_confirmed: z.boolean().default(true),
  /** Optional, user-entered, never prefilled from old values. */
  height_cm: z.number().positive().max(260).nullable().default(null),
  consent: Consent.default({ cloud_backup: false, ai_processing: false, updated_at: null }),
  onboarded_at: z.string().nullable().default(null),
  updated_at: z.string().nullable().default(null),
});
export type LocalProfile = z.infer<typeof LocalProfile>;

/** Fixed id of the synced profile/settings document (one per owner). */
export const PROFILE_DOC_ID = '00000000-0000-4000-8000-0000000000f1';

/** Profile stored as a syncable aggregate. */
export const SettingsDoc = z.object({
  id: z.literal(PROFILE_DOC_ID),
  owner_id: z.string().min(1),
  local_version: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  synthetic: z.boolean(),
  profile: LocalProfile,
});
export type SettingsDoc = z.infer<typeof SettingsDoc>;
