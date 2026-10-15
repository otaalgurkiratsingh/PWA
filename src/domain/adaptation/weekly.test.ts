import { describe, expect, it } from 'vitest';
import type { DietPlan, MealEntry, ProgramVersion, WorkoutSession } from '@shared/contracts';
import shelf from '../../../supabase/functions/_shared/data/diet-shelf.json';
import { shelfFor, type Shelf } from '../../../supabase/functions/_shared/diet';
import { weekStart, weeklyProposal, type AdaptationInput } from './weekly';

const T = '2026-10-15'; // a Thursday
const set = (rep_max = 12) => ({ type: 'working' as const, rep_min: 8, rep_max, target_load: null, target_unit: 'kg' as const, rest_seconds: 90, rir_target: null });
const ex = (id: string, muscle: 'chest' | 'legs' | 'back' | 'shoulders') => ({ id, exercise_key: id, name: id, variant: 'dumbbell', load_convention: 'per_dumbbell' as const, unilateral: false, muscle_group: muscle, measurement: 'weight_reps' as const, sets: [set(), set(), set()] });
const program: ProgramVersion = {
  id: 'p1', owner_id: 'o', local_version: 0, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', deleted_at: null, synthetic: false,
  program_id: 'prog', version: 1, name: 'My plan', schedule: 'rotation',
  days: [
    { id: 'd1', name: 'A', muscle_groups: [], weekday: null, exercises: [ex('bench', 'chest'), ex('squat', 'legs')] },
    { id: 'd2', name: 'B', muscle_groups: [], weekday: null, exercises: [ex('press', 'shoulders'), ex('row', 'back')] },
    { id: 'd3', name: 'C', muscle_groups: [], weekday: null, exercises: [ex('row2', 'back')] },
  ],
};
const session = (date: string, rir: number | null, discomfort = false): WorkoutSession => ({
  id: `s-${date}`, owner_id: 'o', local_version: 0, created_at: `${date}T10:00:00Z`, updated_at: `${date}T11:00:00Z`, deleted_at: null, synthetic: false,
  program_version_id: 'p1', program_version: 1, day_id: 'd1', day_name: 'A', local_date: date, timezone: 'UTC', started_at: `${date}T10:00:00Z`, finished_at: `${date}T11:00:00Z`, status: 'finished',
  exercises: [{
    planned_exercise_id: 'bench', exercise_key: 'bench', name: 'bench', variant: 'dumbbell', load_convention: 'per_dumbbell', unilateral: false, muscle_group: 'chest', measurement: 'weight_reps',
    sets: [0, 1, 2].map((k) => ({ id: `${date}-${k}`, index: k, type: 'working' as const, planned: set(), draft: { reps: null, load: null }, actual: { reps: 10, load: 20, unit: 'kg' as const, rir, discomfort }, status: 'completed' as const, completed_at: `${date}T10:30:00Z`, added: false })),
  }],
});
const base: AdaptationInput = { today: T, units: 'kg', program, programSince: program.created_at, sessions: [], meals: [], sessionsPerWeek: 3, proteinTarget: null, dietPlan: null, decisions: {} };

describe('weekly adaptation (one proposal a week, from logged data)', () => {
  it('weeks start on Monday', () => {
    expect(weekStart(T)).toBe('2026-10-12');
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(weekStart('2026-10-18')).toBe('2026-10-12');
  });

  it('a busy week offers a 2-day version (never "missed")', () => {
    const p = weeklyProposal({ ...base, sessions: [session('2026-10-10', 2)] })!;
    expect(p.kind).toBe('busy_version');
    expect(p.plan!.days).toHaveLength(2);
    expect(`${p.title} ${p.detail}`).not.toMatch(/miss/i);
    // A brand-new plan isn't judged on a week it didn't exist for.
    expect(weeklyProposal({ ...base, programSince: '2026-10-13T00:00:00Z' })).toBeNull();
  });

  it('recovering well (reps to spare, no discomfort) → add a set to pressing movements', () => {
    const p = weeklyProposal({ ...base, sessions: ['2026-10-09', '2026-10-11', '2026-10-13'].map((d) => session(d, 3)) })!;
    expect(p.kind).toBe('add_set');
    expect(p.title).toMatch(/recovering well/);
    const sets = (id: string) => p.plan!.days.flatMap((d) => d.exercises).find((e) => e.id === id)!.sets.length;
    expect(sets('bench')).toBe(4);
    expect(sets('press')).toBe(4);
    expect(sets('squat')).toBe(3);
  });

  it('discomfort or hard sets → no extra volume', () => {
    expect(weeklyProposal({ ...base, sessions: ['2026-10-09', '2026-10-11', '2026-10-13'].map((d) => session(d, 3, true)) })).toBeNull();
    expect(weeklyProposal({ ...base, sessions: ['2026-10-09', '2026-10-11', '2026-10-13'].map((d) => session(d, 0)) })).toBeNull();
  });

  it('protein under target on 5 of 7 days → a higher-protein breakfast from real database dishes', () => {
    const allowed = shelfFor((shelf as Shelf).dishes, { pattern: 'vegetarian', allergies: [] });
    const dietPlan: DietPlan = { targets: { energy_kcal: 2000, protein_g: 120, carbs_g: 250, fat_g: 60 }, meals: [{ slot: 'breakfast', items: [{ dish_id: 'asc144', servings: 2 }] }, { slot: 'lunch', items: [{ dish_id: 'asc151', servings: 1 }] }], source: 'code', accepted_at: '2026-10-01T00:00:00Z', profile_version: 1 };
    const meal = (date: string): MealEntry => ({
      id: `m-${date}`, owner_id: 'o', local_version: 0, created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z`, deleted_at: null, synthetic: false,
      preset_id: null, name: 'Lunch', icon: 'dal', slot: 'lunch', local_date: date, timezone: 'UTC', logged_at: `${date}T12:00:00Z`, quantity: 1, catalogue_id: null,
      items: [{ label: 'Dal', quantity: 1, unit_label: 'bowl', grams: 150, nutrients: { energy_kcal: 600, protein_g: 40, carbs_g: 80, fat_g: 15, fiber_g: 5 }, complete: { energy_kcal: true, protein_g: true }, source_kinds: ['trainluma_db'], source_ref: { kind: 'food', id: '00000000-0000-4000-8000-000000000001', revision: 1 }, estimated: false }],
    });
    const meals = ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'].map(meal);
    const p = weeklyProposal({ ...base, program: null, meals, proteinTarget: 120, dietPlan, allowedDishes: allowed })!;
    expect(p.kind).toBe('protein_breakfast');
    expect(p.title).toMatch(/Protein has been under target 6 of 7 days/);
    const breakfast = p.diet!.meals.find((m) => m.slot === 'breakfast')!.items;
    expect(breakfast.length).toBeGreaterThan(1);
    expect(breakfast.every((x) => allowed.some((d) => d.id === x.dish_id))).toBe(true);
  });

  it('once decided (accepted, edited or dismissed) nothing more is proposed that week', () => {
    expect(weeklyProposal({ ...base, sessions: [session('2026-10-10', 2)], decisions: { '2026-10-12': 'dismissed' } })).toBeNull();
  });
});
