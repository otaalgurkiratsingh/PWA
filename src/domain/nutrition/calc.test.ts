import { describe, expect, it } from 'vitest';
import type { FoodVersion, MealPreset, RecipeRevision } from '@shared/contracts';
import {
  NutritionError,
  batchNutrients,
  formatTotal,
  portionNutrients,
  snapshotPreset,
  totalsOfItems,
} from './calc';

// Reference fixture with round, hand-checkable numbers (synthetic, not real food data).
const base = {
  owner_id: 'test',
  local_version: 1,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  deleted_at: null,
  synthetic: true,
};
const src = { kind: 'synthetic_demo' as const, ref: null, version: null, license: null, note: null };
const ids = {
  lentil: '00000000-0000-4000-8000-000000000001',
  oil: '00000000-0000-4000-8000-000000000002',
  mystery: '00000000-0000-4000-8000-000000000003',
  recipe: '00000000-0000-4000-8000-000000000010',
  recipeV2: '00000000-0000-4000-8000-000000000011',
};
const food = (id: string, name: string, state: FoodVersion['preparation_state'], per: Partial<FoodVersion['per_100g']>): FoodVersion => ({
  ...base,
  id,
  food_id: id,
  revision: 1,
  name,
  preparation_state: state,
  per_100g: { energy_kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, ...per },
  source: src,
  assumptions: [],
});
const lentilDry = food(ids.lentil, 'Lentils (dry)', 'dry', { energy_kcal: 300, protein_g: 20, carbs_g: 50, fat_g: 1, fiber_g: 10 });
const oil = food(ids.oil, 'Oil', 'as_sold', { energy_kcal: 900, protein_g: 0, carbs_g: 0, fat_g: 100, fiber_g: 0 });
const mystery = food(ids.mystery, 'Unknown masala', 'as_sold', { energy_kcal: null, protein_g: 5 });
const foods = new Map([lentilDry, oil, mystery].map((f) => [f.id, f]));

const dal: RecipeRevision = {
  ...base,
  id: ids.recipe,
  recipe_id: ids.recipe,
  revision: 1,
  name: 'Dal',
  ingredients: [
    { food_version_id: ids.lentil, grams: 200, state: 'dry' },
    { food_version_id: ids.oil, grams: 20, state: 'as_sold' },
  ],
  batch_cooked_edible_yield_g: 1000,
  assumptions: [],
};

describe('batch and portion formula', () => {
  it('sums ingredient contributions and counts batch oil exactly once', () => {
    const b = batchNutrients(dal, foods);
    // 200 g dry lentil: 600 kcal, 40 g protein, 2 g fat; 20 g oil: 180 kcal, 20 g fat
    expect(b.energy_kcal).toEqual({ value: 780, complete: true });
    expect(b.protein_g.value).toBeCloseTo(40);
    expect(b.fat_g.value).toBeCloseTo(22);
  });

  it('scales by portion cooked grams over edible yield', () => {
    const p = portionNutrients(batchNutrients(dal, foods), 250, 1000);
    expect(p.energy_kcal.value).toBeCloseTo(195);
    expect(p.fat_g.value).toBeCloseTo(5.5);
    // Two half portions equal one full portion — oil is not re-added per serving.
    const half = portionNutrients(batchNutrients(dal, foods), 125, 1000);
    expect(half.fat_g.value! * 2).toBeCloseTo(p.fat_g.value!);
  });

  it('rejects mixing dry and cooked states', () => {
    const bad = { ...dal, ingredients: [{ food_version_id: ids.lentil, grams: 500, state: 'cooked' as const }] };
    expect(() => batchNutrients(bad, foods)).toThrow(NutritionError);
  });

  it('rejects non-positive portion or yield', () => {
    expect(() => portionNutrients(batchNutrients(dal, foods), 0, 1000)).toThrow(NutritionError);
  });
});

describe('unknown values', () => {
  it('keeps unknown as null, never zero, and marks totals partial', () => {
    const withMystery = { ...dal, ingredients: [...dal.ingredients, { food_version_id: ids.mystery, grams: 10, state: 'as_sold' as const }] };
    const b = batchNutrients(withMystery, foods);
    expect(b.energy_kcal.complete).toBe(false);
    expect(b.energy_kcal.value).toBeCloseTo(780); // known part only
    expect(b.protein_g.complete).toBe(true);
    expect(formatTotal(b.energy_kcal, 'kcal')).toBe('≥ 780 kcal');
  });

  it('a food with no known energy gives Unknown, not 0', () => {
    const p = { ...base, id: ids.recipe, name: 'x', icon: 'generic' as const, quantity_step: 1, favorite: false, photo: null,
      items: [{ kind: 'food' as const, food_version_id: ids.mystery, unit_label: 'tsp', grams_per_unit: 5, default_quantity: 1 }] } satisfies MealPreset;
    const items = snapshotPreset(p, 1, { foods, recipes: new Map() });
    expect(items[0]!.nutrients.energy_kcal).toBeNull();
    const t = totalsOfItems(items);
    expect(t.energy_kcal.value).toBeNull();
    expect(formatTotal(t.energy_kcal, 'kcal')).toBe('Unknown');
  });
});

describe('servings that were never weighed', () => {
  it('can be logged, but every nutrient is unknown and totals become partial', () => {
    const p = { ...base, id: ids.recipe, name: 'Aloo paratha', icon: 'roti' as const, quantity_step: 1, favorite: true, photo: null, catalogue_id: 'aloo-paratha',
      items: [{ kind: 'recipe' as const, recipe_revision_id: ids.recipe, unit_label: 'piece', grams_per_unit: null, default_quantity: 1 }] } satisfies MealPreset;
    const items = snapshotPreset(p, 2, { foods, recipes: new Map([[dal.id, dal]]) });
    expect(items[0]!.grams).toBeNull();
    expect(Object.values(items[0]!.nutrients).every((v) => v === null)).toBe(true);
    const known = snapshotPreset({ ...p, items: [{ ...p.items[0]!, grams_per_unit: 200 }] }, 1, { foods, recipes: new Map([[dal.id, dal]]) });
    const t = totalsOfItems([...known, ...items]);
    expect(t.energy_kcal.complete).toBe(false);
    expect(formatTotal(t.energy_kcal, 'kcal')).toMatch(/^≥ /);
  });
});

describe('snapshots and revisions', () => {
  it('a logged snapshot is unaffected by a later recipe revision', () => {
    const preset: MealPreset = {
      ...base, id: ids.recipe, name: 'Dal katori', icon: 'bowl', quantity_step: 0.5, favorite: false, photo: null,
      items: [{ kind: 'recipe', recipe_revision_id: ids.recipe, unit_label: 'katori', grams_per_unit: 200, default_quantity: 1 }],
    };
    const lib = { foods, recipes: new Map([[dal.id, dal]]) };
    const logged = snapshotPreset(preset, 1, lib);
    const frozen = structuredClone(logged);

    // User revises recipe (more oil) → new immutable revision; old log keeps its snapshot.
    const v2: RecipeRevision = { ...dal, id: ids.recipeV2, revision: 2,
      ingredients: [dal.ingredients[0]!, { food_version_id: ids.oil, grams: 40, state: 'as_sold' }] };
    const lib2 = { foods, recipes: new Map([[dal.id, dal], [v2.id, v2]]) };
    const newLog = snapshotPreset({ ...preset, items: [{ ...preset.items[0]!, recipe_revision_id: v2.id } as MealPreset['items'][number]] }, 1, lib2);

    expect(logged).toEqual(frozen);
    expect(logged[0]!.source_ref.revision).toBe(1);
    expect(newLog[0]!.source_ref.revision).toBe(2);
    expect(newLog[0]!.nutrients.fat_g!).toBeGreaterThan(logged[0]!.nutrients.fat_g!);
  });

  it('quantity multiplier scales grams and nutrients linearly', () => {
    const preset: MealPreset = {
      ...base, id: ids.recipe, name: 'Dal', icon: 'bowl', quantity_step: 0.5, favorite: false, photo: null,
      items: [{ kind: 'recipe', recipe_revision_id: ids.recipe, unit_label: 'katori', grams_per_unit: 200, default_quantity: 1 }],
    };
    const lib = { foods, recipes: new Map([[dal.id, dal]]) };
    const one = snapshotPreset(preset, 1, lib)[0]!;
    const two = snapshotPreset(preset, 2, lib)[0]!;
    expect(two.grams).toBe(400);
    expect(two.nutrients.energy_kcal).toBe(Math.round(one.nutrients.energy_kcal! * 2));
    expect(one.estimated).toBe(true); // synthetic source is always labelled estimated
  });
});
