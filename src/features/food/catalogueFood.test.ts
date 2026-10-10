import { describe, expect, it } from 'vitest';
import raw from '../../../supabase/functions/_shared/data/punjabi-canadian-v2.json';
import { parseCatalogue } from '@shared/catalogue/catalogue';
import { FoodVersion, MealPreset } from '@shared/contracts';
import { snapshotPreset, totalsOfItems } from '@/domain/nutrition/calc';
import { existingPresetFor, presetFromCatalogue, visibleFor } from './catalogueFood';

const index = parseCatalogue(raw);
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const now = '2026-10-10T12:00:00.000Z';
const make = (id: string, grams: number | null = null) =>
  presetFromCatalogue({ food: index.byId.get(id)!, seedVersion: index.seed_version, choice: { grams_per_unit: grams, default_quantity: 1, favorite: true }, ownerId: 'u1', now, newId });

describe('presetFromCatalogue', () => {
  it('creates a valid personal meal with the catalogue identity and unknown nutrition', () => {
    const { food, preset } = make('aloo-paratha');
    expect(FoodVersion.safeParse(food).success).toBe(true);
    expect(MealPreset.safeParse(preset).success).toBe(true);
    expect(preset.catalogue_id).toBe('aloo-paratha');
    expect(preset.catalogue_version).toBe('punjabi-canadian-starter@2026-10-09-v2');
    expect(Object.values(food.per_100g)).toEqual([null, null, null, null, null]);
    expect(food.source).toMatchObject({ kind: 'unknown', ref: 'aloo-paratha' });
    expect(preset.items[0]).toMatchObject({ unit_label: 'piece', grams_per_unit: null });
  });

  it('logging it never produces calories, even after the person weighs the serving', () => {
    for (const g of [null, 90]) {
      const { food, preset } = make('dal-makhani', g);
      const items = snapshotPreset(preset, 1, { foods: new Map([[food.id, food]]), recipes: new Map() });
      const t = totalsOfItems(items);
      expect(t.energy_kcal.value).toBeNull();
      expect(t.energy_kcal.complete).toBe(false);
      expect(items[0]!.grams).toBe(g);
    }
  });

  it('rejects zero or negative amounts', () => {
    expect(() => make('banana', 0)).toThrow();
  });
});

describe('existingPresetFor', () => {
  it('finds a meal created from the catalogue, or an exact legacy name match, but never a generic dish', () => {
    const { preset } = make('masala-chai');
    const legacyRoti = { ...make('whole-wheat-roti').preset, catalogue_id: null, name: 'Roti' };
    const legacyDal = { ...make('dal-tadka').preset, catalogue_id: null, name: 'Dal' };
    const all = [preset, legacyRoti, legacyDal];
    expect(existingPresetFor(index, all, 'masala-chai')?.id).toBe(preset.id);
    expect(existingPresetFor(index, all, 'whole-wheat-roti')?.id).toBe(legacyRoti.id);
    expect(existingPresetFor(index, all, 'dal-tadka')).toBeNull();
    expect(existingPresetFor(index, [{ ...preset, deleted_at: now }], 'masala-chai')).toBeNull();
  });
});

describe('visibleFor (browse filter from the person’s own choices)', () => {
  const chicken = index.byId.get('butter-chicken')!;
  const fish = index.byId.get('amritsari-fish')!;
  const egg = index.byId.get('boiled-eggs')!;
  const dal = index.byId.get('dal-tadka')!;
  it('shows everything when nothing is stated', () => {
    for (const f of [chicken, fish, egg, dal]) expect(visibleFor(f, { pattern: 'unspecified', meatless_weekdays: [] }, 2)).toBe(true);
  });
  it('respects vegetarian, eggetarian, pescatarian and meat-free weekdays', () => {
    expect(visibleFor(egg, { pattern: 'vegetarian', meatless_weekdays: [] }, 1)).toBe(false);
    expect(visibleFor(egg, { pattern: 'eggetarian', meatless_weekdays: [] }, 1)).toBe(true);
    expect(visibleFor(fish, { pattern: 'pescatarian', meatless_weekdays: [] }, 1)).toBe(true);
    expect(visibleFor(chicken, { pattern: 'pescatarian', meatless_weekdays: [] }, 1)).toBe(false);
    expect(visibleFor(chicken, { pattern: 'everything', meatless_weekdays: [2] }, 2)).toBe(false);
    expect(visibleFor(chicken, { pattern: 'everything', meatless_weekdays: [2] }, 3)).toBe(true);
    expect(visibleFor(dal, { pattern: 'vegetarian', meatless_weekdays: [2] }, 2)).toBe(true);
  });
});
