/**
 * App-side helpers for the food plan. The maths and the composer are the SAME code the `ai`
 * function uses (supabase/functions/_shared/diet.ts), on the same generated shelf of public
 * food-database dishes, so every number shown comes from the database or from code.
 */
import { useEffect, useState } from 'react';
import type { DietPlan, LocalProfile, MealPreset } from '@shared/contracts';
import {
  dayTotals, dietTargets, missingDietInputs, shelfFor, type DietDay, type DietTargets, type MissingInput, type Shelf, type ShelfDish,
} from '../../../supabase/functions/_shared/diet';

/** Hand-off from a weekly suggestion's "Edit" to the food-plan editor (one-shot, this tab only). */
export const DIET_SEED_KEY = 'trainluma.dietSeed';

export function takeDietSeed(): DietDay | null {
  try {
    const raw = sessionStorage.getItem(DIET_SEED_KEY);
    sessionStorage.removeItem(DIET_SEED_KEY);
    return raw ? (JSON.parse(raw) as DietDay) : null;
  } catch {
    return null;
  }
}

let loading: Promise<Shelf> | null = null;
export function loadShelf(): Promise<Shelf> {
  loading ??= import('../../../supabase/functions/_shared/data/diet-shelf.json').then((m) => (m as { default: Shelf }).default);
  return loading;
}

export function useShelf(): Shelf | null {
  const [shelf, setShelf] = useState<Shelf | null>(null);
  useEffect(() => {
    let live = true;
    void loadShelf().then((s) => live && setShelf(s));
    return () => {
      live = false;
    };
  }, []);
  return shelf;
}

export interface DietSetup {
  missing: MissingInput[];
  targets: DietTargets | null;
  allowed: ShelfDish[];
  byId: Map<string, ShelfDish>;
}

export function dietSetup(p: LocalProfile, shelf: Shelf): DietSetup {
  const inputs = { weight_kg: p.body.weight_kg, height_cm: p.height_cm, age_years: p.body.age_years, sex: p.body.sex };
  const missing = missingDietInputs(inputs);
  const t = p.training;
  const targets = missing.length ? null : dietTargets({
    weight_kg: inputs.weight_kg!, height_cm: inputs.height_cm!, age_years: inputs.age_years!, sex: inputs.sex,
    goal: t?.goal_priorities[0] ?? p.goal, goal_direction: t?.goal_direction ?? null, lifestyle: t?.lifestyle,
    sessions_per_week: t?.sessions_per_week ?? 0, goal_weight_kg: p.body.goal_weight_kg, goal_weeks: p.body.goal_weeks,
  });
  const allowed = shelfFor(shelf.dishes, p.food_prefs);
  return { missing, targets, allowed, byId: new Map(shelf.dishes.map((d) => [d.id, d])) };
}

/** The person's usual meals that are database dishes (by id, or by the exact dish name). */
export function usualDishIds(presets: readonly MealPreset[], allowed: readonly ShelfDish[]): string[] {
  const ids = new Set(allowed.map((d) => d.id));
  const byName = new Map(allowed.map((d) => [d.name.toLowerCase(), d.id]));
  const out: string[] = [];
  for (const p of presets) {
    if (p.deleted_at) continue;
    if (p.dish_id && ids.has(p.dish_id)) out.push(p.dish_id);
    const n = byName.get(p.name.toLowerCase().trim());
    if (n) out.push(n);
  }
  return [...new Set(out)].slice(0, 15);
}

/** What gets saved when the person accepts: dish ids + servings and the code-computed targets. */
export function acceptedPlan(day: DietDay, targets: Pick<DietTargets, 'energy_kcal' | 'protein_g' | 'carbs_g' | 'fat_g'>, source: 'ai' | 'code', profileVersion: number): DietPlan {
  return {
    targets: { energy_kcal: targets.energy_kcal, protein_g: targets.protein_g, carbs_g: targets.carbs_g, fat_g: targets.fat_g },
    meals: day.meals.filter((m) => m.items.length).map((m) => ({ slot: m.slot, items: m.items.map((i) => ({ dish_id: i.dish_id, servings: i.servings })) })),
    source, accepted_at: new Date().toISOString(), profile_version: profileVersion,
  };
}

export { dayTotals };
