import { describe, expect, it } from 'vitest';
import { demoFoods, demoPresets, demoRecipes } from '@shared/fixtures/demo';
import { MealEntry } from '@shared/contracts';
import { copyEntries, describeQuantity, rescaleEntry, slotForHour } from './mealActions';
import { snapshotPreset } from '@/domain/nutrition/calc';

const lib = {
  foods: new Map(demoFoods('o').map((f) => [f.id, f])),
  recipes: new Map(demoRecipes('o').map((r) => [r.id, r])),
};
const roti = demoPresets('o').find((p) => p.name === 'Roti')!;
const entry: MealEntry = {
  id: crypto.randomUUID(), owner_id: 'o', local_version: 1, created_at: '2026-10-09T08:00:00.000Z', updated_at: '2026-10-09T08:00:00.000Z',
  deleted_at: null, synthetic: true, preset_id: roti.id, name: roti.name, icon: roti.icon, slot: 'lunch', local_date: '2026-10-09',
  timezone: 'UTC', logged_at: '2026-10-09T08:00:00.000Z', quantity: 1, items: snapshotPreset(roti, 1, lib),
};

describe('meal actions', () => {
  it('describes calibrated quantities in personal units', () => {
    expect(describeQuantity(roti, 1)).toBe('2 rotis');
    expect(describeQuantity(roti, 1.5)).toBe('3 rotis');
  });

  it('rescaling keeps the logged source revision and scales grams/nutrients', () => {
    const r = rescaleEntry(entry, 1.5);
    MealEntry.parse(r);
    expect(r.items[0]!.grams).toBe(120);
    expect(r.items[0]!.source_ref).toEqual(entry.items[0]!.source_ref);
    expect(r.items[0]!.nutrients.energy_kcal).toBe(Math.round(entry.items[0]!.nutrients.energy_kcal! * 1.5));
  });

  it('copying a day creates new ids on the target date', () => {
    const [c] = copyEntries([entry], '2026-10-10', new Date('2026-10-10T09:00:00Z'), 'o');
    expect(c!.id).not.toBe(entry.id);
    expect(c!.local_date).toBe('2026-10-10');
    expect(c!.items).toEqual(entry.items);
  });

  it('infers meal slot from local hour', () => {
    expect([7, 13, 17, 21, 2].map(slotForHour)).toEqual(['breakfast', 'lunch', 'snack', 'dinner', 'dinner']);
  });
});
