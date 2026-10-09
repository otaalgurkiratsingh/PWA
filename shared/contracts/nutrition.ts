import { z } from 'zod';
import { AggregateBase, Id, Instant, LocalDate, PositiveQty, TimeZone } from './common';

export const NUTRIENT_KEYS = ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/** A nutrient amount; null = unknown (never coerced to 0). */
const NutrientValue = z.number().finite().nonnegative().nullable();
export const Nutrients = z.object({
  energy_kcal: NutrientValue,
  protein_g: NutrientValue,
  carbs_g: NutrientValue,
  fat_g: NutrientValue,
  fiber_g: NutrientValue,
});
export type Nutrients = z.infer<typeof Nutrients>;

export const SourceKind = z.enum([
  'usda_fdc', // USDA FoodData Central record (public domain / CC0)
  'label', // product nutrition label entered by the user
  'user_recipe', // calculated from user-confirmed recipe
  'generic_assumption', // clearly-identified generic assumption
  'synthetic_demo', // generated demo values — NOT real nutrition data
  'unknown',
]);
export type SourceKind = z.infer<typeof SourceKind>;

export const NutritionSource = z.object({
  kind: SourceKind,
  /** External id, e.g. FDC id. */
  ref: z.string().nullable(),
  /** Dataset/release version, e.g. "FDC SR Legacy 2018-04". */
  version: z.string().nullable(),
  license: z.string().nullable(),
  note: z.string().max(500).nullable(),
});
export type NutritionSource = z.infer<typeof NutritionSource>;

export const PreparationState = z.enum(['raw', 'dry', 'cooked', 'as_sold']);
export type PreparationState = z.infer<typeof PreparationState>;

/** Immutable version of a food's per-100 g nutrient profile. */
export const FoodVersion = AggregateBase.extend({
  food_id: Id,
  revision: z.number().int().positive(),
  name: z.string().min(1).max(80),
  preparation_state: PreparationState,
  per_100g: Nutrients,
  source: NutritionSource,
  assumptions: z.array(z.string().max(300)),
});
export type FoodVersion = z.infer<typeof FoodVersion>;

export const RecipeIngredient = z.object({
  food_version_id: Id,
  /** Edible grams in the stated preparation state. */
  grams: PositiveQty,
  /** Must match the referenced food version's preparation state. */
  state: PreparationState,
});
export type RecipeIngredient = z.infer<typeof RecipeIngredient>;

/** Immutable revision of a batch recipe. Edits create a new revision. */
export const RecipeRevision = AggregateBase.extend({
  recipe_id: Id,
  revision: z.number().int().positive(),
  name: z.string().min(1).max(80),
  ingredients: z.array(RecipeIngredient).min(1),
  /** Edible cooked batch weight after cooking (g). */
  batch_cooked_edible_yield_g: PositiveQty,
  assumptions: z.array(z.string().max(300)),
});
export type RecipeRevision = z.infer<typeof RecipeRevision>;

export const PresetItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('food'),
    food_version_id: Id,
    unit_label: z.string().min(1).max(30),
    /** Calibrated grams per unit (e.g. one of my rotis = 40 g). */
    grams_per_unit: PositiveQty,
    default_quantity: PositiveQty,
  }),
  z.object({
    kind: z.literal('recipe'),
    recipe_revision_id: Id,
    unit_label: z.string().min(1).max(30),
    /** Calibrated cooked grams per unit (e.g. my katori = 180 g dal). */
    grams_per_unit: PositiveQty,
    default_quantity: PositiveQty,
  }),
]);
export type PresetItem = z.infer<typeof PresetItem>;

export const FoodIcon = z.enum(['roti', 'bowl', 'cup', 'egg', 'glass', 'plate', 'drumstick', 'cube', 'generic']);
export type FoodIcon = z.infer<typeof FoodIcon>;

export const MealPreset = AggregateBase.extend({
  name: z.string().min(1).max(60),
  icon: FoodIcon,
  items: z.array(PresetItem).min(1),
  /** Allowed quantity steps for the tile stepper. */
  quantity_step: PositiveQty,
});
export type MealPreset = z.infer<typeof MealPreset>;

export const MealSlot = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type MealSlot = z.infer<typeof MealSlot>;

/** Frozen copy of everything needed to show a logged item later, even if presets change. */
export const MealItemSnapshot = z.object({
  label: z.string(),
  quantity: PositiveQty,
  unit_label: z.string(),
  grams: PositiveQty,
  nutrients: Nutrients,
  /** For each nutrient, whether every contributing input was known. */
  complete: z.record(z.string(), z.boolean()),
  source_kinds: z.array(SourceKind),
  source_ref: z.object({ kind: z.enum(['food', 'recipe']), id: Id, revision: z.number().int().positive() }),
  estimated: z.boolean(),
});
export type MealItemSnapshot = z.infer<typeof MealItemSnapshot>;

export const MealEntry = AggregateBase.extend({
  preset_id: Id.nullable(),
  name: z.string().min(1).max(80),
  icon: FoodIcon,
  slot: MealSlot,
  local_date: LocalDate,
  timezone: TimeZone,
  logged_at: Instant,
  /** Multiplier relative to preset default quantity. */
  quantity: PositiveQty,
  items: z.array(MealItemSnapshot).min(1),
});
export type MealEntry = z.infer<typeof MealEntry>;

/** Whether the user considers a day's intake log complete. Absence means unknown. */
export const DailyLogStatus = z.object({
  local_date: LocalDate,
  owner_id: z.string(),
  intake_complete: z.boolean(),
  updated_at: Instant,
});
export type DailyLogStatus = z.infer<typeof DailyLogStatus>;
