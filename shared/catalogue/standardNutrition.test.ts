import { describe, expect, it } from 'vitest';
import raw from '../../supabase/functions/_shared/data/punjabi-canadian-v2.json';
import std from '../../supabase/functions/_shared/data/food-nutrients-v1.json';
import { FoodVersion, MealPreset } from '@shared/contracts';
import { snapshotPreset, totalsOfItems } from '@/domain/nutrition/calc';
import { presetFromCatalogue } from '@/features/food/catalogueFood';
import { parseCatalogue } from './catalogue';
import { parseStandard, perServing, StandardFile } from './standardNutrition';

const index = parseCatalogue(raw);
const standard = parseStandard(std);
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

describe('standard nutrition data file', () => {
  it('every entry is a real catalogue food from a licensed source (CNF or USDA only)', () => {
    const file = StandardFile.parse(std);
    expect(file.sources.map((s) => s.id).sort()).toEqual(['cnf-2026', 'fndds-2019-2020']);
    for (const id of Object.keys(file.foods)) expect(index.byId.has(id), id).toBe(true);
    expect(standard.size).toBe(Object.keys(file.foods).length);
    expect(standard.size).toBeGreaterThanOrEqual(140);
  });

  it('energy matches 4·protein + 4·carbs + 9·fat within 15% (or the food is near zero)', () => {
    for (const [id, s] of standard) {
      const { energy_kcal: e, protein_g: p, carbs_g: c, fat_g: f } = s.per_100g;
      if (e === null || p === null || c === null || f === null || e < 5) continue;
      expect(Math.abs(4 * p + 4 * c + 9 * f - e) / e, id).toBeLessThan(0.15);
    }
  });

  it('a value whose source is not listed is never shown', () => {
    const bad = { ...std, foods: { 'whole-wheat-roti': { ...(std as { foods: Record<string, object> }).foods['whole-wheat-roti'], source: 'indb-2024' } } };
    expect(parseStandard(bad).size).toBe(0);
  });
});

describe('list foods with standard values', () => {
  const make = (id: string, grams: number | null = null) => presetFromCatalogue({
    food: index.byId.get(id)!, seedVersion: index.seed_version, ownerId: 'u1', now: '2026-10-12T12:00:00.000Z', newId,
    choice: { grams_per_unit: grams, default_quantity: 1, favorite: true }, standard: standard.get(id),
  });

  it('roti starts with the CNF values and the standard 1-piece weight, recorded as an assumption', () => {
    const { food, preset } = make('whole-wheat-roti');
    expect(FoodVersion.safeParse(food).success).toBe(true);
    expect(MealPreset.safeParse(preset).success).toBe(true);
    expect(food.source).toMatchObject({ kind: 'cnf', ref: '7250' });
    expect(food.source.license).toContain('Health Canada');
    expect(food.per_100g.energy_kcal).toBeCloseTo(303.36, 1);
    expect(preset.items[0]).toMatchObject({ unit_label: 'piece', grams_per_unit: 43 });
    expect(food.assumptions[0]).toMatch(/43 g/);
    const totals = totalsOfItems(snapshotPreset(preset, 2, { foods: new Map([[food.id, food]]), recipes: new Map() }));
    expect(Math.round(totals.energy_kcal.value!)).toBe(Math.round(303.363454 * 0.86));
    expect(totals.energy_kcal.complete).toBe(true);
  });

  it('the person’s own weighed serving wins over the standard weight', () => {
    const { food, preset } = make('whole-wheat-roti', 35);
    expect(preset.items[0]!.grams_per_unit).toBe(35);
    expect(food.assumptions).toEqual([]);
  });

  it('per-serving maths', () => {
    const s = standard.get('whole-wheat-roti')!;
    expect(perServing(s, 100).energy_kcal).toBeCloseTo(s.per_100g.energy_kcal!, 6);
  });
});
