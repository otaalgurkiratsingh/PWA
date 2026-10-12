import { describe, expect, it } from 'vitest';
import raw from '../../../supabase/functions/_shared/data/indian-dishes-v1.json';
import type { MealEntry, MealPreset } from '@shared/contracts';
import { parseFoodDb } from '@shared/fooddb/foodDb';
import { autoUsuals, routineNudge, slotSuggestions, templateFromEntries } from './routines';
import { parseVoice, splitPhrases } from './voiceParse';

const db = parseFoodDb(raw);
const preset = (id: string, name: string, extra: Partial<MealPreset> = {}) => ({
  id, name, deleted_at: null, kind: 'meal', items: [{ kind: 'food', food_version_id: `f-${id}`, unit_label: 'serving', grams_per_unit: 100, default_quantity: 1 }], ...extra,
}) as unknown as MealPreset;
const entry = (preset_id: string, date: string, slot: MealEntry['slot'], time = '08:10') => ({
  id: `${preset_id}-${date}-${slot}`, preset_id, local_date: date, slot, deleted_at: null, timezone: 'UTC', logged_at: `${date}T${time}:00.000Z`,
  name: preset_id, icon: 'chai', quantity: 1,
  items: [{ label: preset_id, quantity: 1, unit_label: 'cup', grams: 120, nutrients: {}, complete: {}, source_kinds: [], source_ref: { kind: 'food', id: `00000000-0000-4000-8000-00000000000${preset_id.length}`, revision: 1 }, estimated: false }],
}) as unknown as MealEntry;
const days = (end: string, n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(`${end}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - i); return d.toISOString().slice(0, 10); });

describe('usuals, suggestions, nudges, templates', () => {
  const dd = preset('dd', 'Double-Double Coffee (Medium)');
  const roti = preset('roti', 'Roti', { items: [{ kind: 'food', food_version_id: 'f', unit_label: 'roti', grams_per_unit: 40, default_quantity: 2 }] } as Partial<MealPreset>);
  const rare = preset('rare', 'Kheer');
  const quick = preset('q', 'Quick add', { kind: 'quick' });

  it('a meal becomes a usual after 3 logs in 30 days; quick-adds never do', () => {
    const entries = [...days('2026-10-11', 3).map((d) => entry('dd', d, 'breakfast')), ...days('2026-10-11', 2).map((d) => entry('rare', d, 'snack')),
      ...days('2026-10-11', 5).map((d) => entry('q', d, 'snack')), entry('roti', '2026-08-01', 'lunch'), ...days('2026-10-11', 3).map((d) => entry('roti', d, 'lunch'))];
    expect(autoUsuals([dd, roti, rare, quick], entries, '2026-10-12').map((p) => p.id).sort()).toEqual(['dd', 'roti']);
  });

  it('time-aware: this slot’s usual meals, minus what is already logged today', () => {
    const entries = [entry('dd', '2026-10-10', 'breakfast'), entry('dd', '2026-10-11', 'breakfast'), entry('roti', '2026-10-11', 'lunch')];
    expect(slotSuggestions([dd, roti], entries, '2026-10-12', 'breakfast').map((p) => p.id)).toEqual(['dd']);
    expect(slotSuggestions([dd, roti], [...entries, entry('dd', '2026-10-12', 'breakfast')], '2026-10-12', 'breakfast')).toEqual([]);
  });

  it('same as last time: 4 mornings in a row → day 5 nudge around the usual time', () => {
    const entries = days('2026-10-11', 4).map((d) => entry('dd', d, 'breakfast', '08:10'));
    expect(routineNudge([dd], entries, '2026-10-12', 8 * 60)).toMatchObject({ preset: { id: 'dd' }, slot: 'breakfast', days: 4 });
    expect(routineNudge([dd], entries, '2026-10-12', 14 * 60)).toBeNull(); // not around the usual time
    expect(routineNudge([dd], entries.slice(0, 3), '2026-10-12', 8 * 60)).toBeNull(); // only 3 days
    expect(routineNudge([dd], [...entries, entry('dd', '2026-10-12', 'breakfast')], '2026-10-12', 8 * 60)).toBeNull(); // done today
  });

  it('a template keeps every item of the meal', () => {
    const t = templateFromEntries([entry('dd', '2026-10-11', 'breakfast'), entry('roti', '2026-10-11', 'breakfast')], 'My Tim’s run', 'u1', '2026-10-12T00:00:00Z', () => '00000000-0000-4000-8000-000000000099');
    expect(t).toMatchObject({ kind: 'template', name: 'My Tim’s run', items: [{ unit_label: 'cup', grams_per_unit: 120, default_quantity: 1 }, { unit_label: 'cup' }] });
  });
});

describe('voice parsing', () => {
  it('splits on and / commas / aur / te', () => {
    expect(splitPhrases('I had rajma chawal and two rotis, chai aur lassi te dahi')).toEqual(['i had rajma chawal', 'two rotis', 'chai', 'lassi', 'dahi']);
  });

  it('matches own meals first, then database aliases; quantities as servings', () => {
    const roti = { id: 'r', name: 'Roti', deleted_at: null, kind: 'meal', items: [{ kind: 'food', food_version_id: 'f', unit_label: 'roti', grams_per_unit: 40, default_quantity: 2 }] } as unknown as MealPreset;
    const ghee = { id: 'g', name: 'Ghee on roti', deleted_at: null, kind: 'meal', items: [{ kind: 'food', food_version_id: 'f2', unit_label: 'tsp', grams_per_unit: 5, default_quantity: 1 }] } as unknown as MealPreset;
    const items = parseVoice('I had rajma chawal and two rotis and half a katori sarson da saag', db, [ghee, roti]);
    expect(items.map((i) => [i.match?.kind, i.match?.kind === 'dish' ? i.match.dish.id : i.match?.kind === 'preset' ? i.match.preset.id : null, i.match?.multiplier]))
      .toEqual([['dish', 'combo-rajma-chawal', 1], ['preset', 'r', 1], ['dish', 'asc217', 0.5]]);
  });

  it('never guesses: an unknown food stays unmatched', () => {
    expect(parseVoice('two xyzzy bars', db, [])[0]).toMatchObject({ phrase: 'two xyzzy bars', match: null });
  });
});
