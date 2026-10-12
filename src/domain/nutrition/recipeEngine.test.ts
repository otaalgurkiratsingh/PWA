import { describe, expect, it } from 'vitest';
import raw from '../../../supabase/functions/_shared/data/indian-dishes-v1.json';
import { FoodVersion, MealPreset } from '@shared/contracts';
import { parseFoodDb } from '@shared/fooddb/foodDb';
import { buildRecipeMeal, cloneDish, computeRecipe, deltaLine } from './recipeEngine';

const db = parseFoodDb(raw);
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

describe('custom recipe engine (§6)', () => {
  it('QA: 100 g paneer + 1 roti (40 g) computes the right totals', () => {
    const r = computeRecipe({ servings_count: 1, ingredients: [
      { dish_id: 'asc195', custom_name: null, grams: 100 },
      { dish_id: 'asc096', custom_name: null, grams: 40 },
    ] }, db);
    expect(r.totalGrams).toBe(140);
    expect(r.perServing.kcal).toBeCloseTo(176.5 + 202.3 * 0.4, 1);
    expect(r.perServing.protein_g).toBeCloseTo(7.8 + 5.9 * 0.4, 1);
    expect(r.partial).toBe(false);
  });

  it('divides by servings and recomputes live', () => {
    const one = computeRecipe({ servings_count: 1, ingredients: [{ dish_id: 'asc165', custom_name: null, grams: 600 }] }, db);
    const four = computeRecipe({ servings_count: 4, ingredients: [{ dish_id: 'asc165', custom_name: null, grams: 600 }] }, db);
    expect(four.perServing.kcal).toBeCloseTo(one.perServing.kcal! / 4, 0);
  });

  it('an ingredient without values makes the result partial, never zero', () => {
    const r = computeRecipe({ servings_count: 1, ingredients: [
      { dish_id: 'asc096', custom_name: null, grams: 40 },
      { dish_id: null, custom_name: 'Homemade achaar', grams: 10, custom_per_100g: null },
    ] }, db);
    expect(r.partial).toBe(true);
    expect(r.perServing.kcal).toBeNull();
    expect(r.unknown).toEqual(['Homemade achaar']);
    const labelled = computeRecipe({ servings_count: 1, ingredients: [
      { dish_id: null, custom_name: 'Ghee (label)', grams: 10, custom_per_100g: { energy_kcal: 900, protein_g: 0, carbs_g: 0, fat_g: 100, fiber_g: 0 } },
    ] }, db);
    expect(labelled.perServing.kcal).toBe(90);
  });

  it('make it mine: combos clone into components; the delta line compares with the original', () => {
    const rajma = db.byId.get('asc165')!;
    const spec = cloneDish(rajma);
    expect(spec.ingredients).toEqual([{ dish_id: 'asc165', custom_name: null, grams: 150 }]);
    const same = computeRecipe({ ...spec }, db);
    expect(deltaLine(same, rajma)).toBe('Same as the standard Rajma curry.');
    const smaller = computeRecipe({ ...spec, ingredients: [{ dish_id: 'asc165', custom_name: null, grams: 100 }] }, db);
    expect(deltaLine(smaller, rajma)).toMatch(/^−72 kcal, −3 g protein per serving vs the standard Rajma curry\.$/);
    const combo = cloneDish(db.byId.get('combo-rajma-chawal')!);
    expect(combo.ingredients.map((i) => i.dish_id)).toEqual(['asc165', 'asc113']);
    expect(computeRecipe(combo, db).perServing.kcal).toBeCloseTo(449.9, 0);
  });

  it('saves as a valid meal; editing creates a new food revision (past logs keep theirs)', () => {
    const spec = { servings_count: 2, created_from: 'asc165', ingredients: [{ dish_id: 'asc165', custom_name: null, grams: 300 }] };
    const a = buildRecipeMeal({ name: 'My rajma, less oil', spec, db, ownerId: 'u1', now: '2026-10-12T12:00:00.000Z', newId, synthetic: false });
    expect(FoodVersion.safeParse(a.food).success).toBe(true);
    expect(MealPreset.safeParse(a.preset).success).toBe(true);
    expect(a.preset).toMatchObject({ kind: 'recipe', items: [{ unit_label: 'serving', grams_per_unit: 150 }] });
    const b = buildRecipeMeal({ name: 'My rajma, less oil', spec: { ...spec, servings_count: 3 }, db, ownerId: 'u1', now: '2026-10-13T12:00:00.000Z', newId, synthetic: false, existing: { preset: a.preset, food: a.food } });
    expect(b.preset.id).toBe(a.preset.id);
    expect(b.food.food_id).toBe(a.food.food_id);
    expect(b.food.revision).toBe(2);
    expect(b.food.id).not.toBe(a.food.id);
  });
});
