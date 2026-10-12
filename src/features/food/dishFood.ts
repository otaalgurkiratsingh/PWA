/**
 * Turn a TrainLuma database dish into the person's own loggable meal (preset + food versions).
 *
 * - Values come only from indian_dishes.json (per 100 g as published; combos derived from their
 *   component dishes; brand items per official serving). Nothing is estimated here.
 * - Combos become one meal with one item per component, so each part stays editable (T7).
 * - The person's existing journal is never rewritten: logging creates new entries only, and a meal
 *   made from a dish is reused next time (one personal meal per dish).
 */
import type { FoodIcon, FoodVersion, MealPreset, Nutrients, PreparationState } from '@shared/contracts';
import { ATTRIBUTION, per100For, type Dish, type FoodDb, type Macros } from '@shared/fooddb/foodDb';

const ICON: Record<string, FoodIcon> = {
  breads: 'roti', dals: 'dal', curries_veg: 'sabzi', curries_nonveg: 'curry', rice: 'rice', sweets: 'plate', beverages: 'chai',
  breakfast: 'egg', combos: 'plate', snacks: 'plate', dairy: 'dahi', pantry: 'bowl', fruits: 'fruit', vegetables: 'salad',
  'chain restaurants': 'sandwich',
};

export function iconForDish(d: Dish): FoodIcon {
  if (/coffee|latte|double/i.test(d.name)) return 'coffee';
  if (/lassi|milkshake/i.test(d.name)) return 'shake';
  if (/paneer/i.test(d.name)) return 'paneer';
  if (/egg|omelette/i.test(d.name)) return 'egg';
  return ICON[d.category] ?? 'plate';
}

const toNutrients = (m: Macros): Nutrients => ({ energy_kcal: m.kcal, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, fiber_g: m.fiber_g });

/** "1 katori (150g)" → "katori"; "1 chapati" → "chapati"; anything else → "serving". */
export function unitFor(d: Dish): string {
  const m = /^1\s+([a-z]+)(?=\s|\(|$)/i.exec(d.serving_label);
  const w = m?.[1]?.toLowerCase();
  return w && w.length <= 20 && !['medium', 'large', 'small'].includes(w) ? w : 'serving';
}

export interface Built { foods: FoodVersion[]; preset: MealPreset }

export function foodFromDish(d: Dish, db: FoodDb, ownerId: string, now: string, newId: () => string): { food: FoodVersion; perServing: boolean } {
  const per100 = per100For(d);
  const perServing = per100 === null; // brand item without a published weight: values are per serving
  const base = { id: newId(), owner_id: ownerId, local_version: 0, created_at: now, updated_at: now, deleted_at: null, synthetic: false };
  const food: FoodVersion = {
    ...base,
    food_id: newId(),
    revision: 1,
    name: d.name.slice(0, 80),
    preparation_state: (d.brand || d.category === 'beverages' ? 'as_sold' : 'cooked') as PreparationState,
    per_100g: toNutrients(perServing ? d.per_serving! : per100),
    source: {
      kind: 'trainluma_db', ref: d.id, version: db.version, license: d.brand ? `${d.brand} official nutrition information` : ATTRIBUTION,
      note: d.source.slice(0, 500),
    },
    assumptions: perServing ? ['Values are per official serving (the brand doesn’t publish the weight); stored as 1 serving = 100 units.'] : [],
  };
  return { food, perServing };
}

/** One personal meal for a dish (or combo). */
export function presetFromDish(d: Dish, db: FoodDb, ownerId: string, now: string, newId: () => string): Built {
  const baseMeta = { owner_id: ownerId, local_version: 0, created_at: now, updated_at: now, deleted_at: null, synthetic: false };
  if (d.components?.length) {
    const foods: FoodVersion[] = [];
    const items: MealPreset['items'] = [];
    for (const c of d.components) {
      const part = db.byId.get(c.dish_id);
      if (!part) throw new Error(`Combo part ${c.dish_id} is missing from the food database.`);
      const { food } = foodFromDish(part, db, ownerId, now, newId);
      foods.push(food);
      items.push({ kind: 'food', food_version_id: food.id, unit_label: 'g', grams_per_unit: 1, default_quantity: c.grams });
    }
    return { foods, preset: { ...baseMeta, id: newId(), name: d.name.slice(0, 60), icon: iconForDish(d), items, quantity_step: 0.5, favorite: false, photo: null, dish_id: d.id, kind: 'meal' } };
  }
  const { food, perServing } = foodFromDish(d, db, ownerId, now, newId);
  return {
    foods: [food],
    preset: {
      ...baseMeta, id: newId(), name: d.name.slice(0, 60), icon: iconForDish(d),
      items: [{ kind: 'food', food_version_id: food.id, unit_label: unitFor(d), grams_per_unit: perServing ? 100 : d.serving_g!, default_quantity: 1 }],
      quantity_step: 0.5, favorite: false, photo: null, dish_id: d.id, kind: 'meal',
    },
  };
}

/** The person's existing meal made from this dish (newest), if any. */
export function existingDishPreset(presets: readonly MealPreset[], dishId: string): MealPreset | null {
  return [...presets].filter((p) => !p.deleted_at && p.dish_id === dishId && p.kind !== 'quick').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

/**
 * T1: the existing demo/starter "usual meals" that map to database dishes (identity only — the
 * person's own numbers are never replaced without their tap). Dahi and chicken curry map to
 * Tier-2 dishes, which stay hidden until complete, so they are not linked yet.
 */
export const LEGACY_DISH_MAP: Readonly<Record<string, string>> = {
  'boiled eggs': 'asc056', 'boiled egg': 'asc056', chai: 'asc001', roti: 'asc096', rice: 'asc113',
};
export function legacyDishFor(preset: MealPreset, db: FoodDb): string | null {
  if (preset.dish_id) return preset.dish_id;
  const id = LEGACY_DISH_MAP[preset.name.trim().toLowerCase()];
  return id && db.publicDishes.some((d) => d.id === id) ? id : null;
}
