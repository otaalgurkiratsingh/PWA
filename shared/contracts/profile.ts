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
  /**
   * What the person says they mostly eat (asked directly, never inferred from name, photo or
   * language). Only used to order food-plan suggestions.
   */
  cuisine: z.enum(['unspecified', 'punjabi_home', 'mixed', 'western']).default('unspecified'),
});
export type FoodPreferences = z.infer<typeof FoodPreferences>;

export const Weekday = z.number().int().min(0).max(6);

export const PAIN_AREAS = ['lower_back', 'knees', 'shoulders', 'neck', 'hips', 'wrists_ankles'] as const;
export const PainArea = z.enum(PAIN_AREAS);
export type PainArea = z.infer<typeof PainArea>;

/**
 * Optional body details for food-plan maths (Mifflin-St Jeor). Health-adjacent personal data:
 * the person's own answers, never guessed from photos. Weight is stored in kg.
 */
export const BodyStats = z.object({
  weight_kg: z.number().min(30).max(350).nullable().default(null),
  age_years: z.number().int().min(18).max(100).nullable().default(null),
  /** Only for the calorie formula; 'unspecified' uses the average of both formulas. */
  sex: z.enum(['female', 'male', 'unspecified']).nullable().default(null),
  goal_weight_kg: z.number().min(30).max(350).nullable().default(null),
  goal_weeks: z.number().int().min(1).max(104).nullable().default(null),
  /** "No goal weight / no date" was chosen explicitly. */
  no_timeline: z.boolean().default(false),
  /** The kind timeline reality check was shown once; it is never repeated. */
  timeline_checked: z.boolean().default(false),
});
export type BodyStats = z.infer<typeof BodyStats>;
export const EMPTY_BODY: BodyStats = { weight_kg: null, age_years: null, sex: null, goal_weight_kg: null, goal_weeks: null, no_timeline: false, timeline_checked: false };

/** Week-1 gentle questions (at most one per local day, only while the app is open). */
export const Profiling = z.object({
  /** Local date onboarding finished; questions stop 7 days later. */
  started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  /** Question key → local date it was answered or skipped. */
  asked: z.record(z.string().max(40), z.string().max(10)).default({}),
  skipped: z.array(z.string().max(40)).max(20).default([]),
});
export type Profiling = z.infer<typeof Profiling>;
export const EMPTY_PROFILING: Profiling = { started_on: null, asked: {}, skipped: [] };

/** One accepted day of eating: real food-database ids and servings only (numbers come from the database). */
export const DietPlanItem = z.object({ dish_id: z.string().min(1).max(60), servings: z.number().min(0.5).max(4) });
export const DietMeal = z.object({ slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']), items: z.array(DietPlanItem).max(6) });
export const DietPlan = z.object({
  targets: z.object({ energy_kcal: z.number().positive(), protein_g: z.number().positive(), carbs_g: z.number().nonnegative(), fat_g: z.number().positive() }),
  meals: z.array(DietMeal).min(1).max(4),
  /** 'ai' = composed by AI Coach and checked in code; 'code' = composed by the app. */
  source: z.enum(['ai', 'code']),
  accepted_at: z.string(),
  profile_version: z.number().int().nonnegative(),
});
export type DietPlan = z.infer<typeof DietPlan>;

/** Weekly adaptation decisions, keyed by the week (Monday's date). Nothing changes without approval. */
export const Adaptation = z.object({
  decisions: z.record(z.string().max(10), z.enum(['accepted', 'edited', 'dismissed'])).default({}),
});
export type Adaptation = z.infer<typeof Adaptation>;

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
  /** 'truck' = truck cab / rest stop (no gym access). */
  location: z.enum(['gym', 'home', 'both', 'truck']),
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
  /** 'trucker' = "I drive long-haul / I'm on the road most days" (cab-friendly defaults). */
  lifestyle: z.enum(['standard', 'trucker']).default('standard'),
  /** Areas the person says bother them. Plans leave out loading movements and add supportive ones. */
  pain_areas: z.array(PainArea).max(6).default([]),
  /** "Anything hurting right now, or any injury I should work around?" in their own words. */
  pain_note: z.string().max(300).default(''),
  /** A direction the person PICKED (never inferred from a photo). Shapes plan style only. */
  goal_direction: z.enum(['lean', 'athletic', 'strong']).nullable().default(null),
  /** Recovery guidance only. */
  sleep_pattern: z.enum(['regular', 'irregular', 'shift']).nullable().default(null),
  updated_at: z.string(),
});
export type TrainingProfile = z.infer<typeof TrainingProfile>;

/** The person's own name and look for their AI trainer (personal touch only; changes no advice). */
export const CoachAvatarId = z.enum(['orb', 'bloom', 'buddy', 'spark', 'panda', 'kitty', 'bear', 'sher', 'bot', 'sprout']);
export type CoachAvatarId = z.infer<typeof CoachAvatarId>;
export const CoachPersona = z.object({
  name: z.string().trim().min(1).max(24),
  avatar: CoachAvatarId,
  /** Null until the person has chosen (the app then offers "Meet your trainer"). */
  chosen_at: z.string().nullable(),
});
export type CoachPersona = z.infer<typeof CoachPersona>;
export const DEFAULT_COACH: CoachPersona = { name: 'Luma', avatar: 'orb', chosen_at: null };

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
  food_prefs: FoodPreferences.default({ pattern: 'unspecified', meatless_weekdays: [], allergies: [], cuisine: 'unspecified' }),
  training: TrainingProfile.nullable().default(null),
  /** Incremented whenever planning answers change; drafts generated for an older version must be regenerated. */
  profile_version: z.number().int().nonnegative().default(0),
  coach: CoachPersona.default(DEFAULT_COACH),
  /** Phase 3 additions (all defaulted, so older profiles parse unchanged). */
  body: BodyStats.default(EMPTY_BODY),
  profiling: Profiling.default(EMPTY_PROFILING),
  diet_plan: DietPlan.nullable().default(null),
  adaptation: Adaptation.default({ decisions: {} }),
  onboarded_at: z.string().nullable().default(null),
  updated_at: z.string().nullable().default(null),
});
export type LocalProfile = z.infer<typeof LocalProfile>;

/** Defaults for the Phase 3 profile fields (for code that builds a profile literal). */
export const PROFILE_EXTRAS_DEFAULT: Pick<LocalProfile, 'body' | 'profiling' | 'diet_plan' | 'adaptation'> = {
  body: EMPTY_BODY,
  profiling: EMPTY_PROFILING,
  diet_plan: null,
  adaptation: { decisions: {} },
};

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
