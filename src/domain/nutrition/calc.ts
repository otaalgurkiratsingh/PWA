import {
  NUTRIENT_KEYS,
  type FoodVersion,
  type MealEntry,
  type MealItemSnapshot,
  type MealPreset,
  type NutrientKey,
  type Nutrients,
  type PresetItem,
  type RecipeRevision,
  type SourceKind,
} from '@shared/contracts';

/**
 * A nutrient total that remembers whether every contributor was known.
 * `value` is the sum of KNOWN contributions (null if none were known).
 * `complete === false` means the value is a partial lower bound and must be labelled.
 */
export interface NutrientTotal {
  value: number | null;
  complete: boolean;
}
export type NutrientTotals = Record<NutrientKey, NutrientTotal>;

export class NutritionError extends Error {}

export function emptyTotals(): NutrientTotals {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, { value: null, complete: true }])) as NutrientTotals;
}

function addInto(acc: NutrientTotals, nutrients: Nutrients, factor: number, complete?: Record<string, boolean>) {
  for (const k of NUTRIENT_KEYS) {
    const v = nutrients[k];
    const t = acc[k];
    if (v === null) {
      t.complete = false;
    } else {
      t.value = (t.value ?? 0) + v * factor;
      if (complete && complete[k] === false) t.complete = false;
    }
  }
}

/**
 * batch = SUM(edible_ingredient_g / 100 * nutrient_per_100g)
 * Oil/ghee incorporated into the batch is an ingredient line and is therefore counted exactly once here.
 * Ingredient state must match the food version's preparation state (no dry/cooked mixing).
 */
export function batchNutrients(recipe: RecipeRevision, foods: ReadonlyMap<string, FoodVersion>): NutrientTotals {
  const acc = emptyTotals();
  for (const ing of recipe.ingredients) {
    const food = foods.get(ing.food_version_id);
    if (!food) throw new NutritionError(`Missing food version ${ing.food_version_id} for recipe ${recipe.name}`);
    if (food.preparation_state !== ing.state) {
      throw new NutritionError(
        `${food.name}: ingredient recorded as ${ing.state} but nutrient profile is ${food.preparation_state}`,
      );
    }
    addInto(acc, food.per_100g, ing.grams / 100);
  }
  return acc;
}

/** portion = batch * portion_cooked_g / batch_cooked_edible_yield_g */
export function portionNutrients(batch: NutrientTotals, portionCookedG: number, yieldG: number): NutrientTotals {
  if (!(portionCookedG > 0) || !(yieldG > 0)) throw new NutritionError('Portion and yield must be positive');
  const f = portionCookedG / yieldG;
  const out = emptyTotals();
  for (const k of NUTRIENT_KEYS) {
    out[k] = { value: batch[k].value === null ? null : batch[k].value * f, complete: batch[k].complete };
  }
  return out;
}

export function foodPortion(food: FoodVersion, grams: number): NutrientTotals {
  if (!(grams > 0)) throw new NutritionError('Grams must be positive');
  const acc = emptyTotals();
  addInto(acc, food.per_100g, grams / 100);
  return acc;
}

export interface NutritionLibrary {
  foods: ReadonlyMap<string, FoodVersion>;
  recipes: ReadonlyMap<string, RecipeRevision>;
}

function sourceKindsForRecipe(r: RecipeRevision, foods: ReadonlyMap<string, FoodVersion>): SourceKind[] {
  return [...new Set(r.ingredients.map((i) => foods.get(i.food_version_id)?.source.kind ?? 'unknown'))];
}

const ESTIMATED_KINDS: ReadonlySet<SourceKind> = new Set(['generic_assumption', 'synthetic_demo', 'unknown', 'user_recipe']);

/** Snapshot one preset item at a given quantity. The snapshot is stored and never recomputed. */
export function snapshotPresetItem(item: PresetItem, quantity: number, lib: NutritionLibrary): MealItemSnapshot {
  if (!(quantity > 0)) throw new NutritionError('Quantity must be positive');
  const grams = item.grams_per_unit * quantity;
  let totals: NutrientTotals;
  let label: string;
  let sourceKinds: SourceKind[];
  let ref: MealItemSnapshot['source_ref'];
  if (item.kind === 'food') {
    const food = lib.foods.get(item.food_version_id);
    if (!food) throw new NutritionError(`Missing food version ${item.food_version_id}`);
    totals = foodPortion(food, grams);
    label = food.name;
    sourceKinds = [food.source.kind];
    ref = { kind: 'food', id: food.id, revision: food.revision };
  } else {
    const recipe = lib.recipes.get(item.recipe_revision_id);
    if (!recipe) throw new NutritionError(`Missing recipe revision ${item.recipe_revision_id}`);
    totals = portionNutrients(batchNutrients(recipe, lib.foods), grams, recipe.batch_cooked_edible_yield_g);
    label = recipe.name;
    sourceKinds = sourceKindsForRecipe(recipe, lib.foods);
    ref = { kind: 'recipe', id: recipe.id, revision: recipe.revision };
  }
  const nutrients = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, roundNutrient(k, totals[k].value)])) as Nutrients;
  const complete = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, totals[k].complete])) as Record<string, boolean>;
  return {
    label,
    quantity,
    unit_label: item.unit_label,
    grams: round(grams, 1),
    nutrients,
    complete,
    source_kinds: sourceKinds,
    source_ref: ref,
    estimated: sourceKinds.some((s) => ESTIMATED_KINDS.has(s)),
  };
}

/** Snapshot a whole preset at a multiple of its default quantities. */
export function snapshotPreset(preset: MealPreset, multiplier: number, lib: NutritionLibrary): MealItemSnapshot[] {
  return preset.items.map((it) => snapshotPresetItem(it, it.default_quantity * multiplier, lib));
}

/** Sum stored snapshots. Unknown values stay unknown; partial totals are flagged. */
export function totalsOfItems(items: readonly MealItemSnapshot[]): NutrientTotals {
  const acc = emptyTotals();
  for (const it of items) addInto(acc, it.nutrients, 1, it.complete);
  return acc;
}

export function totalsOfEntries(entries: readonly MealEntry[]): NutrientTotals {
  return totalsOfItems(entries.filter((e) => e.deleted_at === null).flatMap((e) => e.items));
}

function round(v: number, dp: number) {
  const m = 10 ** dp;
  return Math.round(v * m) / m;
}

/** Store with modest precision: energy to 1 kcal, grams to 0.1 g. */
export function roundNutrient(k: NutrientKey, v: number | null): number | null {
  if (v === null) return null;
  return k === 'energy_kcal' ? Math.round(v) : round(v, 1);
}

/** Display text for a total, e.g. "1,240 kcal", "≥ 1,240 kcal (partial)", "Unknown". */
export function formatTotal(t: NutrientTotal, unit: string): string {
  if (t.value === null) return 'Unknown';
  const n = Math.round(t.value).toLocaleString('en-US');
  return t.complete ? `${n} ${unit}` : `≥ ${n} ${unit}`;
}
