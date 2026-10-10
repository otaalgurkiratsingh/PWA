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
  /** Allow sending minimal summaries and text to the AI provider through the backend. */
  ai_processing: z.boolean(),
  /** Keep optional progress/inspiration photos in private cloud storage. Separate choice. */
  photo_storage: z.boolean().default(false),
  /** Send selected photos to the AI provider for limited context. Separate choice. */
  ai_images: z.boolean().default(false),
  updated_at: z.string().nullable(),
});
export type Consent = z.infer<typeof Consent>;

/**
 * Food choices the person states themselves. Used only to filter what the food list shows first;
 * never inferred from background, and never a block on logging anything.
 */
export const FoodPreferences = z.object({
  pattern: z.enum(['unspecified', 'vegetarian', 'eggetarian', 'pescatarian', 'everything']).default('unspecified'),
  /** Weekdays (0 = Sunday) on which the person prefers no meat/fish/eggs to be suggested. */
  meatless_weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  /** Confirmed allergies in the person's own words. The app never claims a food is free of them. */
  allergies: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});
export type FoodPreferences = z.infer<typeof FoodPreferences>;

export const Weekday = z.number().int().min(0).max(6);

/**
 * Answers used to plan workouts. Everything is the person's own words or choices; nothing is
 * guessed from photos, sex/gender or background. Optional measurements live elsewhere.
 */
export const TrainingProfile = z.object({
  /** Goals in the order the person ranked them; the first matters most. */
  goal_priorities: z.array(Goal).min(1).max(5),
  days_available: z.array(Weekday).max(7),
  sessions_per_week: z.number().int().min(1).max(7),
  minutes_per_session: z.number().int().min(15).max(150),
  time_windows: z.array(z.enum(['early_morning', 'morning', 'midday', 'evening', 'night'])).max(5).default([]),
  /** Shift work or a changing schedule: the plan should follow order, not fixed weekdays. */
  rotating_schedule: z.boolean().default(false),
  experience: z.enum(['new', 'returning', 'regular']),
  current_routine: z.string().max(400).default(''),
  exercise_likes: z.string().max(300).default(''),
  recent_performance: z.string().max(400).default(''),
  location: z.enum(['gym', 'home', 'both']),
  equipment: z.array(z.enum(['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell', 'band'])).max(7),
  avoid_exercises: z.string().max(300).default(''),
  /** Limitations or restrictions the person confirms (e.g. from a physiotherapist). */
  restrictions: z.string().max(400).default(''),
  /**
   * Result of reading the official CSEP Get Active Questionnaire (linked, not reproduced):
   * 'no_concerns' | 'has_concerns' (→ guidance, journaling continues) | 'not_answered'.
   */
  screening: z.enum(['not_answered', 'no_concerns', 'has_concerns']).default('not_answered'),
  /** What the person likes about an inspiration image, in their words (the image itself is not needed). */
  inspiration_note: z.string().max(300).default(''),
  updated_at: z.string(),
});
export type TrainingProfile = z.infer<typeof TrainingProfile>;

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
  consent: Consent.default({ cloud_backup: false, ai_processing: false, photo_storage: false, ai_images: false, updated_at: null }),
  food_prefs: FoodPreferences.default({ pattern: 'unspecified', meatless_weekdays: [], allergies: [] }),
  training: TrainingProfile.nullable().default(null),
  /** Incremented whenever planning answers change; drafts generated for an older version must be regenerated. */
  profile_version: z.number().int().nonnegative().default(0),
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
