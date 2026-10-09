import { describe, expect, it } from 'vitest';
import { FoodVersion, MealPreset, ProgramVersion, RecipeRevision } from '../contracts';
import { DEMO_PROFILES, demoFoods, demoPresets, demoProgram, demoRecipes } from './demo';
import { fixtureId } from './ids';

describe('synthetic fixtures', () => {
  it('validate against the shared contracts', () => {
    for (const f of demoFoods('demo-a')) FoodVersion.parse(f);
    for (const r of demoRecipes('demo-a')) RecipeRevision.parse(r);
    for (const p of demoPresets('demo-a')) MealPreset.parse(p);
    ProgramVersion.parse(demoProgram('demo-a'));
  });

  it('are all flagged synthetic', () => {
    expect(DEMO_PROFILES.every((p) => p.synthetic)).toBe(true);
    expect(demoFoods('x').every((f) => f.synthetic && ['synthetic_demo', 'unknown'].includes(f.source.kind))).toBe(true);
  });

  it('reference only existing foods and recipes', () => {
    const foods = new Set(demoFoods('x').map((f) => f.id));
    const recipes = new Set(demoRecipes('x').map((r) => r.id));
    for (const r of demoRecipes('x')) for (const i of r.ingredients) expect(foods.has(i.food_version_id)).toBe(true);
    for (const p of demoPresets('x'))
      for (const it of p.items) expect(it.kind === 'food' ? foods.has(it.food_version_id) : recipes.has(it.recipe_revision_id)).toBe(true);
  });

  it('fixture ids are stable and unique', () => {
    expect(fixtureId('a')).toBe(fixtureId('a'));
    const ids = [...demoFoods('x'), ...demoRecipes('x'), ...demoPresets('x')].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
