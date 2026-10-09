import { useCallback, useMemo } from 'react';
import type { MealEntry, MealPreset, MealSlot } from '@shared/contracts';
import { useJournal, useQuery } from '@/app/JournalContext';
import { StorageWriteError } from '@/core/database/journal';
import type { NutritionLibrary } from '@/domain/nutrition/calc';
import { buildEntry, describeQuantity } from './mealActions';
import type { BuildResult } from './mealBuilder';

export function useLibrary() {
  const data = useQuery((j) => j.library(), []);
  const nutrition = useMemo<NutritionLibrary | null>(
    () => (data ? { foods: new Map(data.foods.map((f) => [f.id, f])), recipes: new Map(data.recipes.map((r) => [r.id, r])) } : null),
    [data],
  );
  return { data, nutrition };
}

/** Favourites first, then most used in the last 14 days, then A–Z. */
export function sortPresets(presets: readonly MealPreset[], recent: readonly MealEntry[]): MealPreset[] {
  const counts = new Map<string, number>();
  for (const e of recent) if (e.preset_id) counts.set(e.preset_id, (counts.get(e.preset_id) ?? 0) + 1);
  return [...presets].sort(
    (a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false) || (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name),
  );
}

export function saveErrorMessage(e: unknown): string {
  return e instanceof StorageWriteError
    ? 'Not saved — this phone refused the write (storage full or blocked). Nothing else changed.'
    : e instanceof Error && e.message
      ? e.message
      : 'Not saved — something went wrong.';
}

export function useMealLogging() {
  const { journal, profile, today, refresh, notify } = useJournal();
  const { nutrition } = useLibrary();

  const undo = useCallback(
    async (entryId: string, name: string) => {
      const current = await journal.db.get('meal_entries', entryId);
      if (!current || current.deleted_at) return;
      await journal.remove('meal_entries', current);
      refresh();
      notify({ kind: 'info', message: `Removed ${name}` });
    },
    [journal, refresh, notify],
  );

  const logPreset = useCallback(
    async (preset: MealPreset, multiplier = 1, opts: { slot?: MealSlot; date?: string } = {}) => {
      if (!nutrition) return null;
      try {
        const entry = buildEntry({
          journal, preset, multiplier, lib: nutrition, date: opts.date ?? today, timezone: profile.timezone, now: new Date(),
          synthetic: profile.synthetic, slot: opts.slot,
        });
        await journal.commit('meal_entries', entry);
        refresh();
        notify({ kind: 'info', message: `Added ${preset.name} · ${describeQuantity(preset, multiplier)}`, action: { label: 'Undo', run: () => void undo(entry.id, preset.name) } });
        return entry;
      } catch (e) {
        notify({ kind: 'error', message: saveErrorMessage(e) });
        return null;
      }
    },
    [journal, nutrition, today, profile, refresh, notify, undo],
  );

  return { logPreset, undo, ready: nutrition !== null };
}

/** Persist a created/edited meal: new food versions and recipe revisions first, then the preset. */
export async function saveBuiltMeal(journal: ReturnType<typeof useJournal>['journal'], r: BuildResult) {
  for (const f of r.foods) await journal.commit('foods', f);
  for (const rr of r.recipes) await journal.commit('recipes', rr);
  const existing = await journal.db.get('presets', r.preset.id);
  await journal.commit('presets', { ...r.preset, local_version: existing?.local_version ?? 0 });
}
