import { describe, expect, it } from 'vitest';
import raw from '../../supabase/functions/_shared/data/ingredients-v1.json';
import { parseIngredients, searchIngredients } from './ingredients';

const all = parseIngredients(raw);

describe('ingredient list', () => {
  it('has unique ids and complete macros from licensed sources', () => {
    expect(all.length).toBeGreaterThanOrEqual(70);
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
    for (const i of all) for (const k of ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g'] as const) expect(i.per_100g[k], `${i.id} ${k}`).not.toBeNull();
  });

  it('energy agrees with protein, available carbs, fat and fibre (within 15%) for calorie-dense foods', () => {
    for (const i of all) {
      const { energy_kcal: e, protein_g: p, carbs_g: c, fat_g: f, fiber_g: fb } = i.per_100g;
      if (e! < 60) continue; // watery vegetables: factor differences dominate
      const est = 4 * p! + 4 * (c! - (fb ?? 0)) + 9 * f! + 2 * (fb ?? 0);
      expect(Math.abs(est - e!) / e!, i.id).toBeLessThan(0.15);
    }
  });

  it('finds Punjabi and English names', () => {
    expect(searchIngredients(all, 'atta').map((i) => i.id)).toContain('atta');
    expect(searchIngredients(all, 'sarson').map((i) => i.id)).toEqual(['mustard-greens', 'mustard-oil']); // saag and sarson ka tel
    expect(searchIngredients(all, 'palak').map((i) => i.id)).toEqual(['spinach']);
    expect(searchIngredients(all, 'desi ghee').map((i) => i.id)).toEqual(['ghee']);
  });
});
