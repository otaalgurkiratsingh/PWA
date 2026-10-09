import { useCallback, useMemo } from 'react';
import type { MealEntry, MealPreset } from '@shared/contracts';
import { useJournal, useQuery } from '@/app/JournalContext';
import type { NutritionLibrary } from '@/domain/nutrition/calc';
import { StorageWriteError } from '@/core/database/journal';
import { buildEntry, describeQuantity } from './mealActions';

export function useLibrary() {
  const data = useQuery((j) => j.library(), []);
  const nutrition = useMemo<NutritionLibrary | null>(
    () =>
      data
        ? { foods: new Map(data.foods.map((f) => [f.id, f])), recipes: new Map(data.recipes.map((r) => [r.id, r])) }
        : null,
    [data],
  );
  return { data, nutrition };
}

/** Most-used presets first (last 14 days), then alphabetical. */
export function sortByUse(presets: readonly MealPreset[], recent: readonly MealEntry[]): MealPreset[] {
  const counts = new Map<string, number>();
  for (const e of recent) if (e.preset_id) counts.set(e.preset_id, (counts.get(e.preset_id) ?? 0) + 1);
  return [...presets].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name));
}

export function saveErrorMessage(e: unknown): string {
  return e instanceof StorageWriteError
    ? 'Not saved — this device refused the write (storage full or blocked). Your previous data is unchanged.'
    : 'Not saved — unexpected error.';
}

export function useMealLogging() {
  const { journal, profile, today, refresh, notify } = useJournal();
  const { nutrition } = useLibrary();

  const undo = useCallback(
    async (entry: MealEntry) => {
      const current = await journal.db.get('meal_entries', entry.id);
      if (!current) return;
      await journal.remove('meal_entries', current);
      refresh();
      notify({ kind: 'info', message: `Removed ${entry.name}` });
    },
    [journal, refresh, notify],
  );

  const logPreset = useCallback(
    async (preset: MealPreset, multiplier = 1) => {
      if (!nutrition) return;
      try {
        const entry = buildEntry({
          journal, preset, multiplier, lib: nutrition, date: today, timezone: profile.timezone, now: new Date(), synthetic: profile.synthetic,
        });
        await journal.commit('meal_entries', entry);
        refresh();
        notify({
          kind: 'info',
          message: `Saved on this device · ${preset.name}, ${describeQuantity(preset, multiplier)}`,
          action: { label: 'Undo', run: () => void undo(entry) },
        });
      } catch (e) {
        notify({ kind: 'error', message: saveErrorMessage(e) });
      }
    },
    [journal, nutrition, today, profile, refresh, notify, undo],
  );

  return { logPreset, undo, ready: nutrition !== null };
}
