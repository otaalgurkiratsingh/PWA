import { NUTRIENT_KEYS, type MealEntry, type MealItemSnapshot, type MealPreset, type MealSlot, type Nutrients } from '@shared/contracts';
import { roundNutrient, snapshotPreset, type NutritionLibrary } from '@/domain/nutrition/calc';
import type { Journal } from '@/core/database/journal';
import { localHourIn } from '@/core/time/localDate';
import { newId } from '@/core/ids';

export function slotForHour(h: number): MealSlot {
  if (h >= 4 && h < 11) return 'breakfast';
  if (h >= 11 && h < 16) return 'lunch';
  if (h >= 16 && h < 19) return 'snack';
  return 'dinner';
}

export const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' };

export function plural(unit: string, q: number): string {
  if (q === 1 || unit === 'g' || unit.endsWith('s')) return unit;
  if (unit.endsWith('ch') || unit.endsWith('sh')) return `${unit}es`;
  return `${unit}s`;
}

export function formatQty(q: number): string {
  const r = Math.round(q * 100) / 100;
  if (r === 0.5) return '½';
  if (Number.isInteger(r - 0.5) && r > 0.5) return `${r - 0.5}½`;
  return String(r);
}

export function describeAmount(unit: string, q: number): string {
  return unit === 'g' ? `${Math.round(q)} g` : `${formatQty(q)} ${plural(unit, q)}`;
}

export function describeQuantity(preset: MealPreset, multiplier: number): string {
  return preset.items.map((it) => describeAmount(it.unit_label, it.default_quantity * multiplier)).join(' + ');
}

export function buildEntry(args: {
  journal: Journal;
  preset: MealPreset;
  multiplier: number;
  lib: NutritionLibrary;
  date: string;
  timezone: string;
  now: Date;
  synthetic: boolean;
  slot?: MealSlot;
}): MealEntry {
  const nowIso = args.now.toISOString();
  return {
    id: newId(),
    owner_id: args.journal.ownerId,
    local_version: 0,
    created_at: nowIso,
    updated_at: nowIso,
    deleted_at: null,
    synthetic: args.synthetic,
    preset_id: args.preset.id,
    name: args.preset.name,
    icon: args.preset.icon,
    slot: args.slot ?? slotForHour(localHourIn(args.timezone, args.now)),
    local_date: args.date,
    timezone: args.timezone,
    logged_at: nowIso,
    quantity: args.multiplier,
    items: snapshotPreset(args.preset, args.multiplier, args.lib),
    catalogue_id: args.preset.catalogue_id ?? null,
  };
}

/**
 * Change quantity by scaling the stored snapshot. Source/version references stay as logged,
 * so editing an old meal never silently switches it to a newer recipe revision.
 */
export function rescaleEntry(entry: MealEntry, newMultiplier: number): MealEntry {
  const f = newMultiplier / entry.quantity;
  const items: MealItemSnapshot[] = entry.items.map((it) => ({
    ...it,
    quantity: Math.round(it.quantity * f * 100) / 100,
    grams: it.grams === null ? null : Math.round(it.grams * f * 10) / 10,
    nutrients: Object.fromEntries(
      NUTRIENT_KEYS.map((k) => [k, it.nutrients[k] === null ? null : roundNutrient(k, it.nutrients[k]! * f)]),
    ) as Nutrients,
  }));
  return { ...entry, quantity: newMultiplier, items };
}

/** Copy yesterday's (or any day's) entries to a date as new entries with the same snapshots. */
export function copyEntries(entries: readonly MealEntry[], date: string, now: Date, ownerId: string): MealEntry[] {
  const nowIso = now.toISOString();
  return entries.map((e) => ({
    ...e,
    id: newId(),
    owner_id: ownerId,
    local_version: 0,
    created_at: nowIso,
    updated_at: nowIso,
    deleted_at: null,
    local_date: date,
    logged_at: nowIso,
  }));
}
