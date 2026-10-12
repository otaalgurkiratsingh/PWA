/**
 * Custom recipe engine (§6 "optimize your own recipe").
 * per_serving = Σ(ingredient.per_100g × grams / 100) ÷ servings_count — recomputed on every edit,
 * never hand-entered. Ingredients are dishes from the TrainLuma food database, or the person's own
 * ingredients with label values they typed (or no values: then the result is marked partial).
 */
import type { FoodVersion, MealPreset, Nutrients } from '@shared/contracts';
import { MACRO_KEYS, per100For, type Dish, type FoodDb, type Macros } from '@shared/fooddb/foodDb';

export type RecipeSpec = NonNullable<MealPreset['recipe']>;
export type Ingredient = RecipeSpec['ingredients'][number];

const fromNutrients = (n: Nutrients): Macros => ({ kcal: n.energy_kcal, protein_g: n.protein_g, carbs_g: n.carbs_g, fat_g: n.fat_g, fiber_g: n.fiber_g });
const toNutrients = (m: Macros): Nutrients => ({ energy_kcal: m.kcal, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, fiber_g: m.fiber_g });

/** A dish can be an ingredient when per-100 g values exist (published, or derived for combos). */
export const usableAsIngredient = (d: Dish) => per100For(d) !== null;

export function ingredientPer100(ing: Ingredient, db: FoodDb): Macros | null {
  if (ing.dish_id) {
    const d = db.byId.get(ing.dish_id);
    return d ? per100For(d) : null;
  }
  return ing.custom_per_100g ? fromNutrients(ing.custom_per_100g) : null;
}

export interface RecipeResult {
  totalGrams: number;
  /** Per serving; a macro is null when any ingredient's value for it is unknown. */
  perServing: Macros;
  /** Per 100 g of the finished recipe (for storing as a food). */
  per100: Macros;
  partial: boolean;
  unknown: string[];
}

export function computeRecipe(spec: Pick<RecipeSpec, 'ingredients' | 'servings_count'>, db: FoodDb): RecipeResult {
  const totals: Record<(typeof MACRO_KEYS)[number], number | null> = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  const unknown: string[] = [];
  let grams = 0;
  for (const ing of spec.ingredients) {
    grams += ing.grams;
    const p = ingredientPer100(ing, db);
    if (!p) unknown.push(ing.custom_name ?? db.byId.get(ing.dish_id ?? '')?.name ?? 'ingredient');
    for (const k of MACRO_KEYS) {
      const v = p?.[k] ?? null;
      totals[k] = totals[k] === null || v === null ? null : totals[k]! + (v * ing.grams) / 100;
    }
  }
  const n = Math.max(1, spec.servings_count);
  const r = (x: number | null, f: number) => (x === null ? null : Math.round(x * f * 10) / 10);
  const perServing = Object.fromEntries(MACRO_KEYS.map((k) => [k, r(totals[k], 1 / n)])) as Macros;
  const per100 = Object.fromEntries(MACRO_KEYS.map((k) => [k, grams > 0 ? (totals[k] === null ? null : (totals[k]! * 100) / grams) : null])) as Macros;
  return { totalGrams: grams, perServing, per100, partial: unknown.length > 0, unknown };
}

/** "Make it mine": a dish as editable ingredients (combos → their components). */
export function cloneDish(d: Dish): Pick<RecipeSpec, 'ingredients' | 'servings_count' | 'created_from'> {
  const ingredients: Ingredient[] = d.components?.length
    ? d.components.map((c) => ({ dish_id: c.dish_id, custom_name: null, grams: c.grams }))
    : [{ dish_id: d.id, custom_name: null, grams: d.serving_g ?? 100 }];
  return { ingredients, servings_count: 1, created_from: d.id };
}

/** The optimize line: "−120 kcal vs standard Rajma curry". Null when nothing to compare. */
export function deltaLine(result: RecipeResult, original: Dish | null): string | null {
  if (!original?.per_serving || result.perServing.kcal === null) return null;
  const dk = Math.round(result.perServing.kcal - original.per_serving.kcal!);
  const dp = result.perServing.protein_g === null ? null : Math.round((result.perServing.protein_g - original.per_serving.protein_g!) * 10) / 10;
  if (dk === 0 && (dp === null || dp === 0)) return `Same as the standard ${original.name}.`;
  const sign = (x: number) => (x > 0 ? `+${x}` : `−${Math.abs(x)}`);
  const protein = dp !== null && dp !== 0 ? `, ${sign(dp)} g protein` : '';
  return `${sign(dk)} kcal${protein} per serving vs the standard ${original.name}.`;
}

/** Save as the person's own meal: a food version (derived per 100 g) + preset with the recipe spec. */
export function buildRecipeMeal(args: {
  name: string; spec: RecipeSpec; db: FoodDb; ownerId: string; now: string; newId: () => string; synthetic: boolean;
  existing?: { preset: MealPreset; food: FoodVersion | null } | null;
}): { food: FoodVersion; preset: MealPreset } {
  const res = computeRecipe(args.spec, args.db);
  if (res.totalGrams <= 0) throw new Error('Add at least one ingredient with grams.');
  const name = args.name.trim().slice(0, 60);
  if (!name) throw new Error('Give your recipe a name.');
  const prev = args.existing?.food ?? null;
  const base = { owner_id: args.ownerId, local_version: 0, created_at: args.now, updated_at: args.now, deleted_at: null, synthetic: args.synthetic };
  const food: FoodVersion = {
    ...base, id: args.newId(), food_id: prev?.food_id ?? args.newId(), revision: (prev?.revision ?? 0) + 1, name,
    preparation_state: 'cooked', per_100g: toNutrients(res.per100),
    source: { kind: 'user_recipe', ref: null, version: null, license: null, note: 'Computed from your recipe ingredients (TrainLuma food database values and your own label values).' },
    assumptions: res.partial ? [`Unknown values for: ${res.unknown.join(', ').slice(0, 200)}`] : [],
  };
  const preset: MealPreset = {
    ...(args.existing?.preset ?? { ...base, id: args.newId(), favorite: false, photo: null }),
    updated_at: args.now, name, icon: args.existing?.preset.icon ?? 'plate', kind: 'recipe', dish_id: null, quantity_step: 0.5,
    items: [{ kind: 'food', food_version_id: food.id, unit_label: 'serving', grams_per_unit: Math.round((res.totalGrams / args.spec.servings_count) * 10) / 10, default_quantity: 1 }],
    recipe: args.spec,
  };
  return { food, preset };
}
