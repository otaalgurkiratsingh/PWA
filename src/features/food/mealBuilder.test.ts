import { describe, expect, it } from 'vitest';
import { FoodVersion, MealPreset, RecipeRevision } from '@shared/contracts';
import { snapshotPreset, totalsOfItems } from '@/domain/nutrition/calc';
import { buildMeal, emptyMealForm, emptyNutrients, formFromPreset, starterForm, STARTER_MEALS, validateMealForm, type MealForm } from './mealBuilder';

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const args = (form: MealForm, existing: MealPreset | null = null, foods = new Map<string, FoodVersion>(), recipes = new Map<string, RecipeRevision>()) =>
  ({ form, ownerId: 'o', now: '2026-10-09T10:00:00.000Z', newId, synthetic: false, foods, recipes, existing });

const labelForm = (): MealForm => ({
  ...emptyMealForm(), name: 'Greek yogurt', icon: 'dahi', unit_label: 'cup', grams_per_unit: '170', default_quantity: '1', quantity_step: '0.5',
  preparation_state: 'as_sold', per100: { energy_kcal: '60', protein_g: '10', carbs_g: '4', fat_g: '', fiber_g: '' }, source_kind: 'label',
});

describe('meal builder', () => {
  it('creates a labelled food + preset; blank values stay unknown (null)', () => {
    const r = buildMeal(args(labelForm()));
    expect(r.foods).toHaveLength(1);
    FoodVersion.parse(r.foods[0]);
    MealPreset.parse(r.preset);
    expect(r.foods[0]!.per_100g.fat_g).toBeNull();
    const lib = { foods: new Map(r.foods.map((f) => [f.id, f])), recipes: new Map() };
    const items = snapshotPreset(r.preset, 1, lib);
    expect(items[0]!.grams).toBe(170);
    expect(items[0]!.nutrients.energy_kcal).toBe(102);
    expect(totalsOfItems(items).fat_g.value).toBeNull();
  });

  it('creates a recipe with batch oil counted once and a measured serving', () => {
    const form: MealForm = {
      ...emptyMealForm(), kind: 'recipe', name: 'Home dal', icon: 'dal', unit_label: 'bowl', grams_per_unit: '200', default_quantity: '1', quantity_step: '0.5',
      cooked_yield_g: '1000',
      ingredients: [
        { key: 'a', food_version_id: null, name: 'Toor dal', state: 'dry', grams: '200', per100: { ...emptyNutrients(), energy_kcal: '300', fat_g: '1' }, source_kind: 'label' },
        { key: 'b', food_version_id: null, name: 'Oil', state: 'as_sold', grams: '20', per100: { ...emptyNutrients(), energy_kcal: '900', fat_g: '100' }, source_kind: 'label' },
      ],
    };
    const r = buildMeal(args(form));
    RecipeRevision.parse(r.recipes[0]);
    const lib = { foods: new Map(r.foods.map((f) => [f.id, f])), recipes: new Map(r.recipes.map((x) => [x.id, x])) };
    const [item] = snapshotPreset(r.preset, 1, lib);
    // (600 + 180) kcal batch × 200 / 1000
    expect(item!.nutrients.energy_kcal).toBe(156);
    expect(item!.nutrients.fat_g).toBeCloseTo(4.4, 1);
    expect(item!.nutrients.protein_g).toBeNull(); // unknown stays unknown
  });

  it('editing nutrition creates a new revision; old logs keep their snapshot', () => {
    const v1 = buildMeal(args(labelForm()));
    const foods = new Map(v1.foods.map((f) => [f.id, f]));
    const oldLog = snapshotPreset(v1.preset, 1, { foods, recipes: new Map() });
    const frozen = structuredClone(oldLog);

    const edited = { ...formFromPreset(v1.preset, foods, new Map()), per100: { ...labelForm().per100, energy_kcal: '75' } };
    const v2 = buildMeal(args(edited, v1.preset, foods));
    expect(v2.newRevision).toBe(true);
    expect(v2.foods[0]!.revision).toBe(2);
    expect(v2.foods[0]!.food_id).toBe(v1.foods[0]!.food_id);
    expect(v2.preset.id).toBe(v1.preset.id);
    expect(oldLog).toEqual(frozen);
    const newLog = snapshotPreset(v2.preset, 1, { foods: new Map([...foods, ...v2.foods.map((f) => [f.id, f] as const)]), recipes: new Map() });
    expect(newLog[0]!.nutrients.energy_kcal).toBe(128);
    expect(newLog[0]!.source_ref.revision).toBe(2);
  });

  it('changing only the picture, favourite or serving keeps the same food version', () => {
    const v1 = buildMeal(args(labelForm()));
    const foods = new Map(v1.foods.map((f) => [f.id, f]));
    const v2 = buildMeal(args({ ...formFromPreset(v1.preset, foods, new Map()), favorite: true, grams_per_unit: '180' }, v1.preset, foods));
    expect(v2.foods).toHaveLength(0);
    expect(v2.newRevision).toBe(false);
    expect(v2.preset.items[0]).toMatchObject({ grams_per_unit: 180 });
  });

  it('validates required fields and rejects dry/cooked mixing with an existing food', () => {
    expect(validateMealForm(emptyMealForm())).toEqual(expect.arrayContaining(['Give the meal a name.']));
    const v1 = buildMeal(args(labelForm()));
    const foods = new Map(v1.foods.map((f) => [f.id, f]));
    const bad: MealForm = { ...emptyMealForm(), kind: 'recipe', name: 'x', grams_per_unit: '100', cooked_yield_g: '500',
      ingredients: [{ key: 'a', food_version_id: v1.foods[0]!.id, name: 'Greek yogurt', state: 'cooked', grams: '100', per100: emptyNutrients(), source_kind: 'label' }] };
    expect(() => buildMeal(args(bad, null, foods))).toThrow(/as_sold/);
  });

  it('starter meals have names and units but unknown nutrition', () => {
    const r = buildMeal(args(starterForm(STARTER_MEALS[0]!)));
    expect(r.foods[0]!.source.kind).toBe('unknown');
    expect(Object.values(r.foods[0]!.per_100g).every((v) => v === null)).toBe(true);
    expect(r.preset).toMatchObject({ name: 'Roti', favorite: true });
  });
});
