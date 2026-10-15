// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  activityFactor, bmr, checkDietDay, composeDay, dayTotals, dietTargets, explainTargets, missingDietInputs, ON_THE_ROAD, practicalNotes,
  SAFETY, shelfFor, timelineCheck, unrealisticPhrase, type Shelf,
} from './diet';

const shelf = JSON.parse(readFileSync(new URL('./data/diet-shelf.json', import.meta.url), 'utf8')) as Shelf;
const byId = new Map(shelf.dishes.map((d) => [d.id, d]));

describe('targets (Mifflin-St Jeor, computed in code)', () => {
  it('matches the published formula for men, women and an unstated sex (average)', () => {
    expect(bmr({ weight_kg: 80, height_cm: 180, age_years: 30, sex: 'male' })).toBe(800 + 1125 - 150 + 5);
    expect(bmr({ weight_kg: 60, height_cm: 165, age_years: 40, sex: 'female' })).toBe(600 + 1031.25 - 200 - 161);
    const avg = (bmr({ weight_kg: 70, height_cm: 170, age_years: 35, sex: 'male' }) + bmr({ weight_kg: 70, height_cm: 170, age_years: 35, sex: 'female' })) / 2;
    expect(bmr({ weight_kg: 70, height_cm: 170, age_years: 35, sex: 'unspecified' })).toBe(avg);
  });

  it('is honest about long-haul driving (sedentary, a little more with workouts)', () => {
    expect(activityFactor('trucker', 0)).toBe(1.2);
    expect(activityFactor('trucker', 3)).toBe(1.3);
    expect(activityFactor('standard', 3)).toBe(1.375);
    expect(activityFactor('standard', 5)).toBe(1.55);
  });

  it('fat loss sits 300–500 below the burn; gain 200–300 above; maintain close to it', () => {
    const base = { weight_kg: 85, height_cm: 178, age_years: 38, sex: 'male' as const, sessions_per_week: 3 };
    const loss = dietTargets({ ...base, goal: 'fat_loss' });
    expect(loss.direction).toBe('loss');
    expect(loss.tdee - loss.energy_kcal).toBeGreaterThanOrEqual(295);
    expect(loss.tdee - loss.energy_kcal).toBeLessThanOrEqual(505);
    const gain = dietTargets({ ...base, goal: 'muscle_gain' });
    expect(gain.energy_kcal - gain.tdee).toBeGreaterThanOrEqual(195);
    expect(gain.energy_kcal - gain.tdee).toBeLessThanOrEqual(305);
    const keep = dietTargets({ ...base, goal: 'consistency' });
    expect(Math.abs(keep.energy_kcal - keep.tdee)).toBeLessThanOrEqual(5);
    // Protein 1.6–2.2 g/kg (of a healthy reference weight), fat ≥ 0.8 g/kg, carbs the remainder.
    for (const t of [loss, gain, keep]) {
      expect(t.protein_g).toBeGreaterThanOrEqual(Math.floor(1.6 * 25 * 1.78 * 1.78));
      expect(t.fat_g).toBeGreaterThanOrEqual(Math.floor(0.8 * 25 * 1.78 * 1.78));
      expect(Math.abs(t.protein_g * 4 + t.fat_g * 9 + t.carbs_g * 4 - t.energy_kcal)).toBeLessThan(10);
    }
  });

  it('the picked direction steers maintenance goals only (lean → deficit, strong → surplus)', () => {
    const base = { weight_kg: 70, height_cm: 172, age_years: 30, sex: 'female' as const, goal: 'consistency' };
    expect(dietTargets({ ...base, goal_direction: 'lean' }).direction).toBe('loss');
    expect(dietTargets({ ...base, goal_direction: 'strong' }).direction).toBe('gain');
    expect(dietTargets({ ...base, goal_direction: 'athletic' }).direction).toBe('maintain');
    expect(dietTargets({ ...base, goal: 'muscle_gain', goal_direction: 'lean' }).direction).toBe('gain');
  });

  it('safety floors are enforced in code: deficit ≤ 750, ≥ 1500 men / 1200 women, loss ≤ about 1 kg a week', () => {
    const rush = dietTargets({ weight_kg: 110, height_cm: 185, age_years: 40, sex: 'male', goal: 'fat_loss', goal_weight_kg: 90, goal_weeks: 4 });
    expect(rush.tdee - rush.energy_kcal).toBeLessThanOrEqual(SAFETY.maxDeficit);
    expect(rush.capped).toBe(true);
    expect(((rush.tdee - rush.energy_kcal) * 7) / 7700).toBeLessThanOrEqual(1);
    const smallWoman = dietTargets({ weight_kg: 50, height_cm: 150, age_years: 60, sex: 'female', goal: 'fat_loss' });
    expect(smallWoman.energy_kcal).toBeGreaterThanOrEqual(1200);
    const smallMan = dietTargets({ weight_kg: 52, height_cm: 158, age_years: 65, sex: 'male', goal: 'fat_loss', goal_weight_kg: 45, goal_weeks: 2 });
    expect(smallMan.energy_kcal).toBeGreaterThanOrEqual(1500);
    const unstated = dietTargets({ weight_kg: 50, height_cm: 150, age_years: 60, sex: 'unspecified', goal: 'fat_loss' });
    expect(unstated.energy_kcal).toBeGreaterThanOrEqual(1200);
  });

  it('asks for what is missing instead of guessing', () => {
    expect(missingDietInputs({ weight_kg: null, height_cm: 170, age_years: null, sex: null })).toEqual(['weight', 'age', 'sex']);
    expect(missingDietInputs({ weight_kg: 70, height_cm: 170, age_years: 30, sex: 'unspecified' })).toEqual([]);
  });

  it('explains the numbers plainly, and honestly for drivers', () => {
    const t = dietTargets({ weight_kg: 95, height_cm: 178, age_years: 45, sex: 'male', goal: 'fat_loss', lifestyle: 'trucker', sessions_per_week: 2 });
    const text = explainTargets(t, true).join(' ');
    expect(text).toContain(`Your body burns about ${t.tdee.toLocaleString('en-US')} calories a day just existing and moving`);
    expect(text).toMatch(/mostly sitting/);
    expect(text).not.toMatch(/lazy|fault|bad/i);
  });
});

describe('timeline honesty check', () => {
  it('flags more than 1 kg a week, offers a steadier pace, and never shames', () => {
    const c = timelineCheck(90, 80, 4);
    expect(c.unsafe).toBe(true);
    expect(c.rate_kg_per_week).toBe(2.5);
    expect(c.safe_weeks).toBeGreaterThanOrEqual(13);
    expect(c.message).toMatch(/0\.5–1 kg a week/);
    expect(c.message).not.toMatch(/missed|lazy|fail|can'?t do/i);
    expect(timelineCheck(90, 85, 10).unsafe).toBe(false);
    expect(timelineCheck(90, 85, 10).message).toBeNull();
  });
  it('catches "shredded in 3 weeks" style goals', () => {
    expect(unrealisticPhrase('get shredded in 3 weeks')).toBe(true);
    expect(unrealisticPhrase('lose 10 kg in 2 weeks')).toBe(true);
    expect(unrealisticPhrase('feel stronger by summer')).toBe(false);
  });
});

describe('the shelf and the composer', () => {
  it('the shelf holds only public database dishes with real numbers', () => {
    expect(shelf.dishes.length).toBeGreaterThan(10);
    for (const d of shelf.dishes) expect(d.kcal).toBeGreaterThan(0);
  });

  it('respects the person’s own veg / egg / non-veg choice and allergies', () => {
    const veg = shelfFor(shelf.dishes, { pattern: 'vegetarian', allergies: [] });
    expect(veg.length).toBeGreaterThan(5);
    expect(veg.every((d) => d.diet === 'veg')).toBe(true);
    const egg = shelfFor(shelf.dishes, { pattern: 'eggetarian', allergies: [] });
    expect(egg.some((d) => d.diet === 'egg')).toBe(true);
    expect(egg.some((d) => d.diet === 'nonveg')).toBe(false);
    const noDairy = shelfFor(shelf.dishes, { pattern: 'vegetarian', allergies: ['dairy'] });
    expect(noDairy.some((d) => /paneer|lassi|milkshake/i.test(d.name))).toBe(false);
    // Sweets and chain meals are never composed into a plan.
    expect(shelfFor(shelf.dishes, { pattern: 'everything', allergies: [] }).some((d) => d.brand || d.category === 'sweets')).toBe(false);
  });

  const people = [
    { pattern: 'everything', i: { weight_kg: 60, height_cm: 160, age_years: 30, sex: 'female' as const, goal: 'consistency', sessions_per_week: 3 } },
    { pattern: 'eggetarian', i: { weight_kg: 72, height_cm: 175, age_years: 25, sex: 'male' as const, goal: 'muscle_gain', sessions_per_week: 4 } },
    { pattern: 'vegetarian', i: { weight_kg: 95, height_cm: 178, age_years: 45, sex: 'male' as const, goal: 'fat_loss', lifestyle: 'trucker' as const, sessions_per_week: 2 } },
  ];
  it.each(people)('composes a day of real ids within ±10% of the calorie target ($pattern)', ({ pattern, i }) => {
    const t = dietTargets(i);
    const allowed = shelfFor(shelf.dishes, { pattern, allergies: [] });
    const day = composeDay(allowed, t, { cuisine: 'punjabi_home' });
    const ids = day.meals.flatMap((m) => m.items.map((x) => x.dish_id));
    expect(ids.every((id) => byId.has(id))).toBe(true);
    expect(ids.every((id) => allowed.some((d) => d.id === id))).toBe(true);
    const tot = dayTotals(day, byId);
    expect(Math.abs(tot.kcal - t.energy_kcal)).toBeLessThanOrEqual(t.energy_kcal * 0.1);
    expect(checkDietDay(day, allowed, t, { proteinFloor: tot.protein_g }).ok).toBe(true);
    if (pattern === 'vegetarian') expect(ids.every((id) => byId.get(id)!.diet === 'veg')).toBe(true);
  });

  it('is deterministic, and Regenerate (variant) gives another valid day', () => {
    const t = dietTargets(people[0]!.i);
    const allowed = shelfFor(shelf.dishes, { pattern: 'everything', allergies: [] });
    expect(composeDay(allowed, t)).toEqual(composeDay(allowed, t));
    const other = composeDay(allowed, t, { variant: 1 });
    expect(other).not.toEqual(composeDay(allowed, t));
  });

  it('puts the person’s usual dishes first where they fit', () => {
    const t = dietTargets(people[0]!.i);
    const allowed = shelfFor(shelf.dishes, { pattern: 'vegetarian', allergies: [] });
    const usual = allowed.find((d) => d.category === 'dals')!.id;
    const day = composeDay(allowed, t, { usual: [usual] });
    expect(day.meals.flatMap((m) => m.items.map((x) => x.dish_id))).toContain(usual);
  });

  it('checkDietDay refuses invented ids, odd servings, and off-target days; totals come from the database', () => {
    const t = { energy_kcal: 2000, protein_g: 120 };
    const allowed = shelfFor(shelf.dishes, { pattern: 'vegetarian', allergies: [] });
    const nonveg = shelf.dishes.find((d) => d.diet === 'nonveg')!.id;
    const bad = checkDietDay({ meals: [{ slot: 'lunch', items: [{ dish_id: 'made-up-dish', servings: 1 }, { dish_id: nonveg, servings: 1.3 }] }] }, allowed, t);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/made-up-dish/);
    expect(bad.errors.join(' ')).toMatch(/half steps/);
    expect(bad.errors.join(' ')).toMatch(/not an allowed/);
    expect(bad.errors.join(' ')).toMatch(/kcal/);
  });
});

describe('practical copy', () => {
  it('on-the-road guidance is practical and never preachy', () => {
    const text = ON_THE_ROAD.join(' ');
    expect(text).toMatch(/dhaba/);
    expect(text).toMatch(/roasted chana/);
    expect(text).toMatch(/whey/);
    expect(text).not.toMatch(/should be ashamed|bad food|junk|cheat/i);
  });
  it('notes for drivers with sore knees or backs stay non-medical', () => {
    const notes = practicalNotes({ trucker: true, painAreas: ['knees', 'lower_back'] }).join(' ');
    expect(notes).toMatch(/knees/);
    expect(notes).not.toMatch(/cure|treat|heal|diagnos/i);
  });
});
