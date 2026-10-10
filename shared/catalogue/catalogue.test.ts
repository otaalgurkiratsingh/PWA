import { describe, expect, it } from 'vitest';
import raw from '../../supabase/functions/_shared/data/punjabi-canadian-v2.json';
import { CatalogueFile, legacyMatch, normalize, parseCatalogue, searchCatalogue } from './catalogue';

const index = parseCatalogue(raw);
const ids = (q: string, category?: Parameters<typeof searchCatalogue>[2]) => searchCatalogue(index, q, category).map((f) => f.id);

describe('catalogue seed', () => {
  it('validates: 293 unchanged entries, 16 categories, unique ids and asset keys', () => {
    expect(index.foods).toHaveLength(293);
    expect(index.categories).toHaveLength(16);
    expect(new Set(index.foods.map((f) => f.illustration.asset_key)).size).toBe(293);
    expect(index.seed_version).toBe('punjabi-canadian-starter@2026-10-09-v2');
    const counts = Object.fromEntries(index.categories.map((c) => [c.id, index.foods.filter((f) => f.category_id === c.id).length]));
    expect(counts).toEqual({
      breads: 21, rice_grains: 12, dals_beans: 16, vegetables: 26, paneer: 12, eggs: 10, meat_fish: 20, dairy: 13, drinks: 24,
      breakfast: 16, snacks: 22, sweets: 23, fruit: 19, nuts_seeds: 11, sides_addons: 19, canadian_meals: 29,
    });
  });

  it('keeps every nutrient unknown (null, never zero) and portions uncalibrated', () => {
    for (const f of index.foods) {
      expect([f.nutrition.energy_kcal, f.nutrition.protein_g, f.nutrition.carbohydrate_g, f.nutrition.fat_g]).toEqual([null, null, null, null]);
      expect(f.nutrition.status).toBe('unverified');
      expect(f.portion.grams).toBeNull();
    }
  });

  it('rejects a seed that slips in zero calories, duplicates or a wrong count', () => {
    const bad = structuredClone(raw) as { foods: { nutrition: { energy_kcal: number | null } }[]; item_count: number };
    bad.foods[0]!.nutrition.energy_kcal = 0;
    expect(CatalogueFile.safeParse(bad).success).toBe(false);
    const dup = structuredClone(raw) as { foods: unknown[]; item_count: number };
    dup.foods.push(dup.foods[0]);
    dup.item_count = dup.foods.length;
    expect(CatalogueFile.safeParse(dup).success).toBe(false);
    const count = structuredClone(raw) as { item_count: number };
    count.item_count = 292;
    expect(CatalogueFile.safeParse(count).success).toBe(false);
  });

  it('is idempotent: parsing twice gives the same identities', () => {
    expect(parseCatalogue(raw).foods.map((f) => f.id)).toEqual(index.foods.map((f) => f.id));
  });
});

describe('search', () => {
  it('finds roti by roti / chapati / phulka', () => {
    for (const q of ['roti', 'chapati', 'Phulka', 'chapatti']) expect(ids(q)[0], q).toBe('whole-wheat-roti');
  });
  it('treats dal/daal, sabzi/sabji, dahi/curd, chai/cha as the same', () => {
    expect(ids('daal makhani')).toContain('dal-makhani');
    expect(ids('dal makhani')).toEqual(ids('daal makhani'));
    expect(ids('sabji')).toContain('mixed-vegetable-sabzi');
    expect(ids('curd')[0]).toBe('plain-dahi');
    expect(ids('cha')[0]).toBe('milk-chai');
    expect(ids('chai')[0]).toBe('milk-chai');
  });
  it('finds Canadian names and is accent/case-insensitive', () => {
    expect(ids('double double')).toContain('double-double-style-coffee');
    expect(ids('POUTINE')).toEqual(['poutine']);
    expect(ids('shawarma')).toContain('chicken-shawarma-wrap');
    expect(ids('protein shake')).toEqual(expect.arrayContaining(['whey-shake-with-water', 'plant-protein-shake']));
    expect(normalize('Crème brûlée')).toBe('creme brulee');
  });
  it('filters by category and returns nothing for an empty or unknown query', () => {
    expect(searchCatalogue(index, 'paratha', { category: 'eggs' }).map((f) => f.id)).toEqual(['egg-paratha']);
    expect(ids('')).toEqual([]);
    expect(ids('zzzz')).toEqual([]);
  });
});

describe('legacy meal mapping', () => {
  it('maps known starter names exactly and leaves generic dishes unlinked', () => {
    expect(legacyMatch(index, 'Roti')?.id).toBe('whole-wheat-roti');
    expect(legacyMatch(index, 'Chai')?.id).toBe('milk-chai');
    expect(legacyMatch(index, 'Whey shake')?.id).toBe('whey-shake-with-water');
    expect(legacyMatch(index, 'Dal')).toBeNull();
    expect(legacyMatch(index, 'Sabzi')).toBeNull();
    expect(legacyMatch(index, 'Mom’s special dal')).toBeNull();
  });
});
