import { describe, expect, it } from 'vitest';
import raw from '../../../supabase/functions/_shared/data/indian-dishes-v1.json';
import { FoodVersion, MealPreset } from '@shared/contracts';
import { parseFoodDb } from '@shared/fooddb/foodDb';
import { snapshotPreset, totalsOfItems } from '@/domain/nutrition/calc';
import { legacyDishFor, presetFromDish, unitFor } from './dishFood';

const db = parseFoodDb(raw);
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const now = '2026-10-12T12:00:00.000Z';
const totals = (p: MealPreset, foods: FoodVersion[], m = 1) => totalsOfItems(snapshotPreset(p, m, { foods: new Map(foods.map((f) => [f.id, f])), recipes: new Map() }));

describe('database dish → personal meal', () => {
  it('a dish logs exactly its published per-serving values', () => {
    const d = db.byId.get('asc165')!;
    const { foods, preset } = presetFromDish(d, db, 'u1', now, newId);
    expect(foods.every((f) => FoodVersion.safeParse(f).success)).toBe(true);
    expect(MealPreset.safeParse(preset).success).toBe(true);
    expect(preset).toMatchObject({ dish_id: 'asc165', items: [{ unit_label: 'katori', grams_per_unit: 150 }] });
    expect(foods[0]!.source).toMatchObject({ kind: 'trainluma_db', ref: 'asc165' });
    const t = totals(preset, foods);
    expect(t.energy_kcal.value).toBe(216); // 215.5 published, shown to the whole kcal
    expect(t.protein_g.value).toBeCloseTo(9.0, 1);
  });

  it('a combo stores each component so edits stay possible, and totals match the combo', () => {
    const d = db.byId.get('combo-rajma-chawal')!;
    const { foods, preset } = presetFromDish(d, db, 'u1', now, newId);
    expect(preset.items).toHaveLength(2);
    expect(foods.map((f) => f.source.ref)).toEqual(['asc165', 'asc113']);
    expect(totals(preset, foods).energy_kcal.value).toBeCloseTo(449.9, 0);
  });

  it('a brand item without a published weight logs its official per-serving numbers', () => {
    const d = db.byId.get('th-double-double-m')!;
    const { foods, preset } = presetFromDish(d, db, 'u1', now, newId);
    expect(totals(preset, foods).energy_kcal.value).toBe(200);
    expect(totals(preset, foods, 2).energy_kcal.value).toBe(400);
    expect(foods[0]!.assumptions[0]).toMatch(/per official serving/);
  });

  it('units and the T1 legacy mapping', () => {
    expect(unitFor(db.byId.get('asc096')!)).toBe('chapati');
    expect(unitFor(db.byId.get('combo-rajma-chawal')!)).toBe('serving');
    const p = { name: 'Boiled eggs', dish_id: undefined } as unknown as MealPreset;
    expect(legacyDishFor(p, db)).toBe('asc056');
    expect(legacyDishFor({ name: 'Dahi' } as MealPreset, db)).toBeNull(); // maps to a Tier-2 dish: not linked yet
  });
});
