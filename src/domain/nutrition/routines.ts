/**
 * Frictionless logging (T10–T13): usuals, time-aware suggestions, "same as last time" nudges and
 * meal templates — all computed on the phone from the person's own log.
 */
import type { MealEntry, MealPreset, MealSlot } from '@shared/contracts';
import { shiftDate } from '../../../supabase/functions/_shared/retention';

const live = (p: MealPreset) => !p.deleted_at && p.kind !== 'quick';

/** T10: a meal becomes a "usual" after 3 logs in the last 30 days; top 6 by frequency, then recency. */
export function autoUsuals(presets: readonly MealPreset[], entries: readonly MealEntry[], today: string, limit = 6): MealPreset[] {
  const from = shiftDate(today, -29);
  const stats = new Map<string, { n: number; last: string }>();
  for (const e of entries) {
    if (e.deleted_at || !e.preset_id || e.local_date < from || e.local_date > today) continue;
    const s = stats.get(e.preset_id) ?? { n: 0, last: '' };
    s.n++;
    if (e.logged_at > s.last) s.last = e.logged_at;
    stats.set(e.preset_id, s);
  }
  return presets
    .filter((p) => live(p) && (stats.get(p.id)?.n ?? 0) >= 3)
    .sort((a, b) => stats.get(b.id)!.n - stats.get(a.id)!.n || stats.get(b.id)!.last.localeCompare(stats.get(a.id)!.last))
    .slice(0, limit);
}

/** T11: meals the person usually has in this slot (last 30 days), not yet logged in it today. */
export function slotSuggestions(presets: readonly MealPreset[], entries: readonly MealEntry[], today: string, slot: MealSlot, limit = 4): MealPreset[] {
  const from = shiftDate(today, -29);
  const counts = new Map<string, number>();
  const doneToday = new Set<string>();
  for (const e of entries) {
    if (e.deleted_at || !e.preset_id || e.slot !== slot || e.local_date < from) continue;
    if (e.local_date === today) doneToday.add(e.preset_id);
    else counts.set(e.preset_id, (counts.get(e.preset_id) ?? 0) + 1);
  }
  return presets
    .filter((p) => live(p) && (counts.get(p.id) ?? 0) >= 1 && !doneToday.has(p.id))
    .sort((a, b) => counts.get(b.id)! - counts.get(a.id)!)
    .slice(0, limit);
}

export interface Nudge { preset: MealPreset; slot: MealSlot; days: number; usualMinutes: number }

const minutesOf = (iso: string, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
};

/**
 * T12: the same meal logged in the same slot on ≥ 4 consecutive days ending yesterday, not logged
 * in that slot today, and it's around the usual time (−60 / +90 minutes) → "Your usual X?".
 */
export function routineNudge(presets: readonly MealPreset[], entries: readonly MealEntry[], today: string, nowMinutes: number): Nudge | null {
  const byPreset = new Map(presets.filter(live).map((p) => [p.id, p]));
  const key = (id: string, slot: MealSlot) => `${id}|${slot}`;
  const days = new Map<string, Map<string, number>>(); // preset|slot → date → minutes
  const todaySlots = new Set<string>();
  for (const e of entries) {
    if (e.deleted_at || !e.preset_id || !byPreset.has(e.preset_id)) continue;
    if (e.local_date === today) { todaySlots.add(e.slot); continue; }
    const k = key(e.preset_id, e.slot);
    if (!days.has(k)) days.set(k, new Map());
    days.get(k)!.set(e.local_date, minutesOf(e.logged_at, e.timezone));
  }
  let best: Nudge | null = null;
  for (const [k, dates] of days) {
    const [id, slot] = k.split('|') as [string, MealSlot];
    if (todaySlots.has(slot)) continue;
    let run = 0;
    const times: number[] = [];
    for (let d = shiftDate(today, -1); dates.has(d); d = shiftDate(d, -1)) { run++; times.push(dates.get(d)!); }
    if (run < 4) continue;
    const usual = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]!;
    if (nowMinutes < usual - 60 || nowMinutes > usual + 90) continue;
    if (!best || run > best.days) best = { preset: byPreset.get(id)!, slot, days: run, usualMinutes: usual };
  }
  return best;
}

/** T13: a multi-item template from a day's slot (e.g. 2 roti + dal + sabzi) — logs in one tap. */
export function templateFromEntries(entries: readonly MealEntry[], name: string, ownerId: string, now: string, newId: () => string): MealPreset {
  const items: MealPreset['items'] = entries.flatMap((e) => e.items.map((it) => {
    const per = it.grams === null ? null : Math.round((it.grams / it.quantity) * 10) / 10;
    return it.source_ref.kind === 'food'
      ? { kind: 'food' as const, food_version_id: it.source_ref.id, unit_label: it.unit_label, grams_per_unit: per, default_quantity: it.quantity }
      : { kind: 'recipe' as const, recipe_revision_id: it.source_ref.id, unit_label: it.unit_label, grams_per_unit: per, default_quantity: it.quantity };
  }));
  if (!items.length) throw new Error('Nothing to save yet.');
  return {
    id: newId(), owner_id: ownerId, local_version: 0, created_at: now, updated_at: now, deleted_at: null, synthetic: false,
    name: name.trim().slice(0, 60) || 'My typical meal', icon: entries[0]?.icon ?? 'plate', items: items.slice(0, 20), quantity_step: 1,
    favorite: true, photo: null, kind: 'template',
  };
}
