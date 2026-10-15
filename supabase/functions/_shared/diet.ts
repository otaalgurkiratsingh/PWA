/**
 * Food-plan maths and composition, computed in CODE (shared by the app and the `ai` function).
 *
 * - Targets: Mifflin-St Jeor BMR × an honest activity factor, then a goal adjustment, with safety
 *   floors the model can never override (deficit ≤ 750 kcal/day, ≥ 1500 kcal men / 1200 women,
 *   implied loss ≤ about 1 kg a week).
 * - Composition: a day of real TrainLuma food-database dishes (public Tier-1 dishes only, from the
 *   generated `data/diet-shelf.json`). Items are ids + servings; every number shown is recomputed
 *   from the database values here. An AI-proposed day is checked with `checkDietDay` exactly like
 *   plans are checked with `checkPlan`.
 * General nutrition guidance only; never medical or dietetic advice.
 */

export type Diet = 'veg' | 'egg' | 'nonveg';
export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const SLOTS: readonly Slot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** One public database dish with its published per-serving values. */
export interface ShelfDish {
  id: string;
  name: string;
  category: string;
  serving_label: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  diet: Diet;
  cuisine: 'indian' | 'western' | 'neutral';
  punjabi: boolean;
  brand: boolean;
  /** Lower-case name + aliases, for allergy matching and fish detection. */
  text: string;
}
export interface Shelf { version: string; dishes: ShelfDish[] }

export interface DietItem { dish_id: string; servings: number }
export interface DietMealPlan { slot: Slot; items: DietItem[] }
export interface DietDay { meals: DietMealPlan[] }
export interface DayTotals { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number }

// ---------------------------------------------------------------- targets

export type Sex = 'female' | 'male' | 'unspecified';
export interface DietInputs {
  weight_kg: number | null;
  height_cm: number | null;
  age_years: number | null;
  sex: Sex | null;
  /** The person's first goal (goal_priorities[0]). */
  goal: string;
  goal_direction?: 'lean' | 'athletic' | 'strong' | null;
  lifestyle?: 'standard' | 'trucker';
  sessions_per_week?: number;
  goal_weight_kg?: number | null;
  goal_weeks?: number | null;
}

export type MissingInput = 'weight' | 'height' | 'age' | 'sex';
/** What still has to be asked before a food plan can be drafted (sex may be "prefer not to say"). */
export function missingDietInputs(i: Pick<DietInputs, 'weight_kg' | 'height_cm' | 'age_years' | 'sex'>): MissingInput[] {
  const out: MissingInput[] = [];
  if (!i.weight_kg) out.push('weight');
  if (!i.height_cm) out.push('height');
  if (!i.age_years) out.push('age');
  if (!i.sex) out.push('sex');
  return out;
}

export const SAFETY = { maxDeficit: 750, floorMale: 1500, floorFemale: 1200, floorUnspecified: 1200, maxLossKgPerWeek: 1, maxGainKgPerWeek: 0.5 } as const;
const KCAL_PER_KG = 7700;

/** Mifflin-St Jeor resting burn. Without a stated sex, the average of the two formulas. */
export function bmr(i: { weight_kg: number; height_cm: number; age_years: number; sex: Sex | null }): number {
  const base = 10 * i.weight_kg + 6.25 * i.height_cm - 5 * i.age_years;
  return base + (i.sex === 'male' ? 5 : i.sex === 'female' ? -161 : -78);
}

/** Honest activity: long-haul driving is mostly sitting; workouts raise it a little. */
export function activityFactor(lifestyle: DietInputs['lifestyle'], sessions = 0): number {
  if (lifestyle === 'trucker') return sessions >= 2 ? 1.3 : 1.2;
  if (sessions <= 1) return 1.2;
  if (sessions <= 3) return 1.375;
  return 1.55;
}

export interface TimelineCheck {
  /** kg per week the stated goal implies (positive = loss). */
  rate_kg_per_week: number;
  unsafe: boolean;
  /** Weeks at a steady, safe pace (0.75 kg a week for loss, 0.4 for gain). */
  safe_weeks: number;
  message: string | null;
}

/** T5.4 + T7: a kind, plain reality check when a timeline implies an unsafe pace. Shown once. */
export function timelineCheck(weightKg: number, goalKg: number, weeks: number): TimelineCheck {
  const diff = weightKg - goalKg;
  const rate = diff / Math.max(1, weeks);
  const loss = diff > 0;
  const unsafe = loss ? rate > SAFETY.maxLossKgPerWeek : -rate > SAFETY.maxGainKgPerWeek;
  const safe_weeks = Math.max(weeks, Math.ceil(Math.abs(diff) / (loss ? 0.75 : 0.4)));
  const kg = (x: number) => `${Math.round(Math.abs(x) * 10) / 10} kg`;
  const message = !unsafe ? null : loss
    ? `Honest take: ${kg(diff)} in ${weeks} week${weeks === 1 ? '' : 's'} works out to about ${kg(rate)} a week. That pace usually costs muscle and energy, and it rarely sticks. A steadier 0.5–1 kg a week is what lasts, so I’ll plan for that: about ${safe_weeks} weeks. Still a real result, and you’ll keep it.`
    : `Honest take: gaining ${kg(diff)} in ${weeks} week${weeks === 1 ? '' : 's'} is about ${kg(rate)} a week, which would mostly be fat rather than muscle. Around 0.25–0.5 kg a week builds muscle better, so I’ll plan for that: about ${safe_weeks} weeks.`;
  return { rate_kg_per_week: Math.round(rate * 100) / 100, unsafe, safe_weeks, message };
}

/** Phrases like "shredded in 3 weeks" get the same once-only reality check. */
export function unrealisticPhrase(text: string): boolean {
  return /\b(shred(ded)?|ripped|six[- ]?pack|abs|lose \d+\s?(kg|lb|lbs|pounds))\b.{0,30}\b(in|by|within)\s+\d+\s*(days?|weeks?)\b/i.test(text);
}

export interface DietTargets {
  bmr: number;
  tdee: number;
  activity_factor: number;
  direction: 'loss' | 'gain' | 'maintain';
  /** kcal/day below (+) or above (−) the estimated burn. */
  adjustment: number;
  energy_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  /** True when a safety floor or cap changed what the inputs asked for. */
  capped: boolean;
  notes: string[];
}

const round10 = (x: number) => Math.round(x / 10) * 10;

export function dietTargets(i: DietInputs & { weight_kg: number; height_cm: number; age_years: number }): DietTargets {
  const notes: string[] = [];
  const b = bmr(i);
  const factor = activityFactor(i.lifestyle, i.sessions_per_week ?? 0);
  const tdee = b * factor;
  let direction: DietTargets['direction'] = 'maintain';
  if (i.goal_weight_kg && Math.abs(i.goal_weight_kg - i.weight_kg) >= 1) direction = i.goal_weight_kg < i.weight_kg ? 'loss' : 'gain';
  else if (i.goal === 'fat_loss') direction = 'loss';
  else if (i.goal === 'muscle_gain') direction = 'gain';
  else if (i.goal_direction === 'lean') direction = 'loss';
  else if (i.goal_direction === 'strong') direction = 'gain';

  let capped = false;
  let adjustment = 0;
  if (direction === 'loss') {
    adjustment = 400;
    if (i.goal_weight_kg && i.goal_weeks) {
      const needed = ((i.weight_kg - i.goal_weight_kg) / i.goal_weeks) * KCAL_PER_KG / 7;
      adjustment = Math.max(300, Math.min(SAFETY.maxDeficit, needed));
      if (needed > SAFETY.maxDeficit) {
        capped = true;
        notes.push('Your timeline asked for a bigger cut than is safe, so this uses the safe maximum (750 kcal a day below your burn).');
      }
    }
  } else if (direction === 'gain') {
    adjustment = -250;
    if (i.goal_weight_kg && i.goal_weeks) {
      const needed = ((i.goal_weight_kg - i.weight_kg) / i.goal_weeks) * KCAL_PER_KG / 7;
      adjustment = -Math.max(200, Math.min(300, needed));
      if (needed > 300) capped = true;
    }
  }
  let kcal = tdee - adjustment;
  const floor = i.sex === 'male' ? SAFETY.floorMale : i.sex === 'female' ? SAFETY.floorFemale : SAFETY.floorUnspecified;
  if (kcal < floor) {
    kcal = floor;
    capped = true;
    notes.push(`Never below ${floor} kcal a day: that’s the safety floor this app keeps.`);
  }
  // Round to 10 kcal, upward for a deficit so rounding can never exceed the safety cap.
  kcal = direction === 'loss' ? Math.ceil(kcal / 10) * 10 : round10(kcal);
  adjustment = Math.round(tdee - kcal);

  // Protein and fat per kg of a healthy reference weight (BMI 25) for higher body weights, so the
  // grams stay realistic; otherwise per kg of actual weight.
  const h = i.height_cm / 100;
  const refW = i.weight_kg / (h * h) > 25 ? 25 * h * h : i.weight_kg;
  const perKg = direction === 'maintain' ? 1.6 : 1.8;
  const protein = Math.round(Math.min(2.2 * refW, perKg * refW));
  let fat = Math.round(Math.max(0.8 * refW, (0.25 * kcal) / 9));
  let carbs = Math.round((kcal - 4 * protein - 9 * fat) / 4);
  if (carbs < 50) {
    fat = Math.round(0.8 * refW);
    carbs = Math.max(0, Math.round((kcal - 4 * protein - 9 * fat) / 4));
  }
  return { bmr: Math.round(b), tdee: Math.round(tdee), activity_factor: factor, direction, adjustment, energy_kcal: kcal, protein_g: protein, fat_g: fat, carbs_g: carbs, capped, notes };
}

/** Plain-language explainer under the numbers. */
export function explainTargets(t: DietTargets, trucker: boolean): string[] {
  const out = [`Your body burns about ${t.tdee.toLocaleString('en-US')} calories a day just existing and moving. Eat a bit less than that to lose weight, a bit more to gain.`];
  if (t.direction === 'loss') out.push(`This plan is about ${t.adjustment} kcal a day below that, a pace you can keep.`);
  else if (t.direction === 'gain') out.push(`This plan is about ${-t.adjustment} kcal a day above that, enough to build without piling on fat.`);
  else out.push('This plan sits close to that number, to keep your weight steady while you train.');
  if (trucker) out.push('Long hours at the wheel are mostly sitting, so the estimate is on the low side. That’s just how the maths works for driving jobs; your workouts add to it.');
  return out;
}

// ---------------------------------------------------------------- the shelf

export interface FoodChoice { pattern: string; allergies: readonly string[]; cuisine?: string }

/** Synonyms so a stated allergy also catches the obvious dish words. The app still can't confirm ingredients. */
const ALLERGY_WORDS: Record<string, string[]> = {
  dairy: ['paneer', 'dahi', 'curd', 'lassi', 'milk', 'kheer', 'latte', 'ghee', 'butter', 'malai', 'makhani', 'cheese', 'rasmalai', 'raita', 'milkshake', 'khoya'],
  milk: ['paneer', 'dahi', 'curd', 'lassi', 'milk', 'kheer', 'latte', 'ghee', 'butter', 'malai', 'makhani', 'cheese', 'rasmalai', 'raita', 'milkshake'],
  lactose: ['paneer', 'dahi', 'curd', 'lassi', 'milk', 'kheer', 'latte', 'milkshake', 'cheese', 'raita'],
  egg: ['egg', 'omelette', 'anda', 'mcmuffin'],
  eggs: ['egg', 'omelette', 'anda', 'mcmuffin'],
  gluten: ['roti', 'chapati', 'paratha', 'naan', 'wheat', 'atta', 'suji', 'upma', 'bread', 'bun', 'pizza', 'donut', 'muffin', 'wrap'],
  wheat: ['roti', 'chapati', 'paratha', 'naan', 'wheat', 'atta', 'suji', 'upma', 'bread'],
  peanut: ['peanut', 'groundnut', 'moongphali'],
  peanuts: ['peanut', 'groundnut', 'moongphali'],
  nuts: ['almond', 'cashew', 'walnut', 'pista', 'peanut', 'kaju', 'badam'],
  fish: ['fish', 'machli', 'prawn'],
  shellfish: ['prawn', 'shrimp', 'crab'],
  soy: ['soya', 'soy', 'tofu'],
};

export function allergyBlocked(d: ShelfDish, allergies: readonly string[]): boolean {
  return allergies.some((a) => {
    const k = a.toLowerCase().trim();
    if (k.length < 3) return false;
    const words = [k, ...(ALLERGY_WORDS[k] ?? [])];
    return words.some((w) => d.text.includes(w));
  });
}

/** Dishes allowed for the person's own stated choices (never inferred). Sweets and chain meals are left out of plans. */
export function shelfFor(shelf: readonly ShelfDish[], c: FoodChoice): ShelfDish[] {
  const ok = (d: ShelfDish) => {
    if (d.brand || d.category === 'chain restaurants' || d.category === 'sweets') return false;
    if (c.pattern === 'vegetarian' && d.diet !== 'veg') return false;
    if (c.pattern === 'eggetarian' && d.diet === 'nonveg') return false;
    if (c.pattern === 'pescatarian' && d.diet === 'nonveg' && !/fish|machli|prawn/.test(d.text)) return false;
    return !allergyBlocked(d, c.allergies);
  };
  return shelf.filter(ok);
}

export function dayTotals(day: DietDay, byId: ReadonlyMap<string, ShelfDish>): DayTotals {
  const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  for (const m of day.meals) for (const it of m.items) {
    const d = byId.get(it.dish_id);
    if (!d) continue;
    t.kcal += d.kcal * it.servings;
    t.protein_g += d.protein_g * it.servings;
    t.carbs_g += d.carbs_g * it.servings;
    t.fat_g += d.fat_g * it.servings;
    t.fiber_g += d.fiber_g * it.servings;
  }
  const r = (x: number) => Math.round(x * 10) / 10;
  return { kcal: Math.round(t.kcal), protein_g: r(t.protein_g), carbs_g: r(t.carbs_g), fat_g: r(t.fat_g), fiber_g: r(t.fiber_g) };
}

export const mealTotals = (m: DietMealPlan, byId: ReadonlyMap<string, ShelfDish>) => dayTotals({ meals: [m] }, byId);

// ---------------------------------------------------------------- composer

const POOLS: Record<Slot, { role: string; categories: readonly string[] }[]> = {
  breakfast: [
    { role: 'main', categories: ['breakfast', 'breads'] },
    { role: 'protein', categories: ['dairy', 'breakfast'] },
    { role: 'drink', categories: ['beverages'] },
  ],
  lunch: [
    { role: 'main', categories: ['dals', 'curries_veg', 'curries_nonveg', 'combos'] },
    { role: 'base', categories: ['breads', 'rice'] },
  ],
  dinner: [
    { role: 'protein', categories: ['curries_nonveg', 'curries_veg', 'dals', 'dairy'] },
    { role: 'base', categories: ['breads'] },
    { role: 'side', categories: ['curries_veg', 'vegetables'] },
  ],
  snack: [{ role: 'snack', categories: ['dairy', 'beverages', 'pantry', 'fruits', 'snacks', 'breakfast'] }],
};
const maxFor = (d: ShelfDish) => {
  if (/boiled egg|idli|chapati|roti\b/i.test(d.name) && !/makki/i.test(d.name)) return 4;
  if (d.category === 'breads' || d.category === 'breakfast' || d.category === 'beverages' || d.category === 'rice' || d.category === 'combos') return 2;
  return 2.5;
};
const density = (d: ShelfDish) => (d.kcal > 0 ? d.protein_g / d.kcal : 0);

export interface ComposeOptions {
  cuisine?: string;
  /** Database ids of the person's usual meals: placed first where they fit. */
  usual?: readonly string[];
  /** 0 = first choice; Regenerate steps through alternatives. */
  variant?: number;
}

function score(d: ShelfDish, role: string, o: ComposeOptions): number {
  let s = 0;
  if (o.usual?.includes(d.id)) s += 100;
  if (o.cuisine === 'punjabi_home') s += d.punjabi ? 12 : d.cuisine === 'indian' ? 6 : 0;
  else if (o.cuisine === 'mixed') s += 4; // Indian and Canadian food on equal footing
  else if (o.cuisine === 'western') s += d.cuisine === 'western' || d.cuisine === 'neutral' ? 10 : 0;
  const dens = density(d) * 100; // grams of protein per 100 kcal
  if (role === 'protein' || role === 'snack') s += dens * 4;
  else if (role === 'main') s += dens * 2;
  else if (role === 'base') s += d.fat_g < 5 ? 6 : 0; // plain roti/rice over fried breads
  else if (role === 'side') s += d.kcal < 150 ? 6 : 0;
  if (d.kcal > 450) s -= 8; // very heavy single servings scale badly
  return s;
}

/**
 * Deterministic day: one dish per role from the person's allowed shelf (usual meals and chosen
 * cuisine first, protein-dense where it matters), then servings scaled in half steps to land within
 * about ±5% of the calorie target with as much protein as the shelf allows.
 */
export function composeDay(allowed: readonly ShelfDish[], targets: Pick<DietTargets, 'energy_kcal' | 'protein_g'>, o: ComposeOptions = {}): DietDay {
  const used = new Set<string>();
  const v = Math.max(0, Math.floor(o.variant ?? 0));
  const meals: DietMealPlan[] = [];
  for (const slot of SLOTS) {
    const items: DietItem[] = [];
    let mainIsCombo = false;
    for (const pool of POOLS[slot]) {
      if (pool.role === 'base' && mainIsCombo) continue;
      const ranked = allowed
        .filter((d) => pool.categories.includes(d.category) && !used.has(d.id))
        // Breakfast: the main is a veg staple (paratha, poha, idli…); the protein side is dairy or eggs.
        .filter((d) => !(slot === 'breakfast' && pool.role === 'main' && d.diet !== 'veg'))
        .filter((d) => !(slot === 'breakfast' && pool.role === 'protein' && d.diet === 'veg' && d.category === 'breakfast'))
        .map((d) => ({ d, s: score(d, pool.role, o) }))
        .sort((a, b) => b.s - a.s || a.d.id.localeCompare(b.d.id));
      if (!ranked.length) continue;
      const pick = ranked[Math.min(ranked.length - 1, ranked.length > 1 ? v % Math.min(3, ranked.length) : 0)]!.d;
      used.add(pick.id);
      if (pool.role === 'main' && (pick.category === 'combos' || pick.category === 'rice')) mainIsCombo = true;
      items.push({ dish_id: pick.id, servings: pick.category === 'breads' ? 2 : pick.id === 'asc056' ? 2 : 1 });
    }
    if (items.length) meals.push({ slot, items });
  }
  let day = scaleDay({ meals }, allowed, targets);
  // Bigger targets: add one more snack item at a time (protein-dense first) until it can fit.
  const byId = new Map(allowed.map((d) => [d.id, d]));
  for (let extra = 0; extra < 3 && dayTotals(day, byId).kcal < targets.energy_kcal * 0.95; extra++) {
    const pick = allowed
      .filter((d) => POOLS.snack[0]!.categories.includes(d.category) && !used.has(d.id))
      .map((d) => ({ d, s: score(d, 'snack', o) }))
      .sort((a, b) => b.s - a.s || a.d.id.localeCompare(b.d.id))[0]?.d;
    if (!pick) break;
    used.add(pick.id);
    const snack = day.meals.find((m) => m.slot === 'snack');
    const meals2 = snack
      ? day.meals.map((m) => (m.slot === 'snack' ? { ...m, items: [...m.items, { dish_id: pick.id, servings: 1 }] } : m))
      : [...day.meals, { slot: 'snack' as const, items: [{ dish_id: pick.id, servings: 1 }] }];
    day = scaleDay({ meals: meals2 }, allowed, targets);
  }
  return day;
}

/** Adjust servings in 0.5 steps toward the targets (bounded, deterministic). */
export function scaleDay(day: DietDay, allowed: readonly ShelfDish[], targets: Pick<DietTargets, 'energy_kcal' | 'protein_g'>): DietDay {
  const byId = new Map(allowed.map((d) => [d.id, d]));
  const meals = day.meals.map((m) => ({ ...m, items: m.items.map((i) => ({ ...i })) }));
  const flat = meals.flatMap((m) => m.items).filter((i) => byId.has(i.dish_id));
  const T = targets.energy_kcal;
  const total = () => dayTotals({ meals }, byId);
  for (let n = 0; n < 120; n++) {
    const t = total();
    if (t.kcal < T * 0.97) {
      const up = flat.filter((i) => i.servings + 0.5 <= maxFor(byId.get(i.dish_id)!))
        .sort((a, b) => density(byId.get(b.dish_id)!) - density(byId.get(a.dish_id)!) || a.servings - b.servings)[0];
      if (!up) break;
      up.servings += 0.5;
    } else if (t.kcal > T * 1.03) {
      const down = flat.filter((i) => i.servings - 0.5 >= 0.5)
        .sort((a, b) => density(byId.get(a.dish_id)!) - density(byId.get(b.dish_id)!) || b.servings - a.servings)[0];
      if (!down) break;
      down.servings -= 0.5;
    } else break;
  }
  // Trade low-protein servings for high-protein ones while calories stay within ±10%.
  for (let n = 0; n < 40; n++) {
    const t = total();
    if (t.protein_g >= targets.protein_g * 0.9) break;
    const hi = flat.filter((i) => i.servings + 0.5 <= maxFor(byId.get(i.dish_id)!)).sort((a, b) => density(byId.get(b.dish_id)!) - density(byId.get(a.dish_id)!))[0];
    const lo = flat.filter((i) => i !== hi && i.servings - 0.5 >= 0.5).sort((a, b) => density(byId.get(a.dish_id)!) - density(byId.get(b.dish_id)!))[0];
    if (!hi || !lo || density(byId.get(hi.dish_id)!) <= density(byId.get(lo.dish_id)!)) break;
    hi.servings += 0.5;
    lo.servings -= 0.5;
    const after = total();
    if (Math.abs(after.kcal - T) > T * 0.1 || after.protein_g <= t.protein_g) {
      hi.servings -= 0.5;
      lo.servings += 0.5;
      break;
    }
  }
  return { meals };
}

// ---------------------------------------------------------------- validation

export interface DietCheck { ok: boolean; errors: string[]; day: DietDay; totals: DayTotals }

/**
 * Check a proposed day (from AI or edited by hand): every item a real dish on the person's allowed
 * shelf, half-step servings 0.5–4, at most 6 items per meal, one entry per slot, calories within
 * ±10% of the target, and protein at least 90% of target (or, when the shelf can't reach that,
 * at least what the app's own composer reaches).
 */
export function checkDietDay(day: DietDay, allowed: readonly ShelfDish[], targets: Pick<DietTargets, 'energy_kcal' | 'protein_g'>, opts: { proteinFloor?: number; strictTotals?: boolean } = {}): DietCheck {
  const errors: string[] = [];
  const byId = new Map(allowed.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const meals: DietMealPlan[] = [];
  for (const m of day.meals) {
    if (!SLOTS.includes(m.slot)) { errors.push(`Unknown meal "${String(m.slot).slice(0, 20)}".`); continue; }
    if (seen.has(m.slot)) errors.push(`Two ${m.slot} entries.`);
    seen.add(m.slot);
    if (m.items.length > 6) errors.push(`${m.slot} has more than 6 items.`);
    const items = m.items.map((it) => {
      if (!byId.has(it.dish_id)) errors.push(`"${String(it.dish_id).slice(0, 40)}" is not an allowed food-database dish.`);
      if (!(it.servings >= 0.5 && it.servings <= 4) || Math.round(it.servings * 2) !== it.servings * 2) errors.push(`${it.dish_id}: servings must be 0.5–4 in half steps.`);
      return { dish_id: it.dish_id, servings: it.servings };
    });
    meals.push({ slot: m.slot, items });
  }
  if (!meals.some((m) => m.items.length)) errors.push('The day has no food.');
  const totals = dayTotals({ meals }, byId);
  if (opts.strictTotals !== false) {
    if (Math.abs(totals.kcal - targets.energy_kcal) > targets.energy_kcal * 0.1) errors.push(`The day adds up to ${totals.kcal} kcal; the target is ${targets.energy_kcal} (±10%).`);
    const floor = Math.min(targets.protein_g * 0.9, opts.proteinFloor ?? Infinity);
    if (totals.protein_g < floor) errors.push(`Protein adds up to ${totals.protein_g} g; at least ${Math.round(floor)} g is needed.`);
  }
  const order = (s: Slot) => SLOTS.indexOf(s);
  return { ok: errors.length === 0, errors: [...new Set(errors)].slice(0, 8), day: { meals: meals.sort((a, b) => order(a.slot) - order(b.slot)) }, totals };
}

// ---------------------------------------------------------------- practical guidance (copy)

/** "On the road" guidance for long-haul drivers: practical, never preachy. */
export const ON_THE_ROAD: readonly string[] = [
  'At a dhaba: tandoori chicken or paneer tikka, a bowl of dal and plain roti fill you up for less than creamy curries and butter naan.',
  'Portable protein for the cab: a whey shake, roasted chana, peanuts or boiled eggs keep you going between stops.',
  'Gas-station traps worth limiting: big sodas, energy drinks, donuts and chips. A coffee, milk, nuts or a banana travel better.',
  'Keep a big water bottle within reach and sip through the shift; thirst often feels like hunger on long drives.',
];

/** Plain, non-medical notes for long drives and sore backs/knees. */
export function practicalNotes(o: { trucker: boolean; painAreas: readonly string[] }): string[] {
  const out: string[] = [];
  if (o.trucker) out.push('Long drives: fibre from dal, sabzi and fruit plus steady water helps you stay regular when you sit for hours.');
  if (o.painAreas.includes('knees')) out.push('Every kilo you lose takes some load off your knees on stairs and getting in and out of the cab.');
  if (o.painAreas.includes('lower_back') && o.trucker) out.push('At each stop, a two-minute walk and a few hip stretches give your back a break from the seat.');
  return out;
}
