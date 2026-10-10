/**
 * Turn the "Create/Edit meal" form into immutable food versions / recipe revisions + a preset.
 * Nutrition edits always create a NEW revision, so meals logged earlier keep their snapshots.
 * Unknown values stay null; nothing is guessed.
 */
import type {
  FoodIcon,
  FoodVersion,
  MealPreset,
  Nutrients,
  PreparationState,
  RecipeRevision,
  SourceKind,
} from '@shared/contracts';

export interface NutrientForm {
  energy_kcal: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
  fiber_g: string;
}

export interface IngredientForm {
  key: string;
  /** Existing food version to reuse, or null to create a new food from the fields below. */
  food_version_id: string | null;
  name: string;
  state: PreparationState;
  grams: string;
  per100: NutrientForm;
  source_kind: SourceKind;
}

export interface MealForm {
  name: string;
  icon: FoodIcon;
  photo: string | null;
  favorite: boolean;
  kind: 'food' | 'recipe';
  unit_label: string;
  grams_per_unit: string;
  default_quantity: string;
  quantity_step: string;
  // simple food
  preparation_state: PreparationState;
  per100: NutrientForm;
  source_kind: SourceKind;
  source_ref: string;
  // recipe
  ingredients: IngredientForm[];
  cooked_yield_g: string;
  notes: string;
  /** Catalogue identity (kept through edits; never supplies nutrition). */
  catalogue_id: string | null;
  catalogue_version: string | null;
}

export const UNIT_OPTIONS = ['bowl', 'roti', 'cup', 'piece', 'egg', 'scoop', 'slice', 'glass', 'serving', 'tbsp', 'tsp', 'g'];

export const emptyNutrients = (): NutrientForm => ({ energy_kcal: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '' });

export function emptyMealForm(): MealForm {
  return {
    name: '', icon: 'plate', photo: null, favorite: false, kind: 'food', unit_label: 'serving', grams_per_unit: '', default_quantity: '1',
    quantity_step: '1', preparation_state: 'cooked', per100: emptyNutrients(), source_kind: 'label', source_ref: '',
    ingredients: [], cooked_yield_g: '', notes: '', catalogue_id: null, catalogue_version: null,
  };
}

const parseNum = (s: string): number | null => {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

export function nutrientsFrom(f: NutrientForm): Nutrients | string {
  const out = {} as Record<keyof Nutrients, number | null>;
  for (const k of ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'] as const) {
    const v = parseNum(f[k]);
    if (Number.isNaN(v) || (v !== null && v < 0)) return 'Nutrition values must be numbers (leave blank if unknown).';
    out[k] = v;
  }
  return out;
}

export function nutrientsToForm(n: Nutrients): NutrientForm {
  const s = (v: number | null) => (v === null ? '' : String(v));
  return { energy_kcal: s(n.energy_kcal), protein_g: s(n.protein_g), carbs_g: s(n.carbs_g), fat_g: s(n.fat_g), fiber_g: s(n.fiber_g) };
}

export function validateMealForm(f: MealForm): string[] {
  const errors: string[] = [];
  if (!f.name.trim()) errors.push('Give the meal a name.');
  // Blank = not weighed yet: allowed, and nutrition then stays unknown for this meal.
  const g = parseNum(f.grams_per_unit);
  if (g !== null && (Number.isNaN(g) || g <= 0)) errors.push(`The weight of 1 ${f.unit_label || 'serving'} must be a number of grams (or leave it blank).`);
  const q = parseNum(f.default_quantity);
  if (q === null || Number.isNaN(q) || q <= 0) errors.push('Usual amount must be more than 0.');
  const st = parseNum(f.quantity_step);
  if (st === null || Number.isNaN(st) || st <= 0) errors.push('Step must be more than 0.');
  if (f.kind === 'food') {
    if (typeof nutrientsFrom(f.per100) === 'string') errors.push('Nutrition values must be numbers (leave blank if unknown).');
  } else {
    if (f.ingredients.length === 0) errors.push('Add at least one ingredient.');
    const y = parseNum(f.cooked_yield_g);
    if (y === null || Number.isNaN(y) || y <= 0) errors.push('Enter the cooked weight of the whole batch.');
    for (const i of f.ingredients) {
      const gi = parseNum(i.grams);
      if (!i.name.trim()) errors.push('Every ingredient needs a name.');
      if (gi === null || Number.isNaN(gi) || gi <= 0) errors.push(`Enter grams for ${i.name || 'each ingredient'}.`);
      if (!i.food_version_id && typeof nutrientsFrom(i.per100) === 'string') errors.push(`${i.name || 'An ingredient'}: nutrition values must be numbers.`);
    }
  }
  return [...new Set(errors)];
}

interface BuildArgs {
  form: MealForm;
  ownerId: string;
  now: string;
  newId: () => string;
  synthetic: boolean;
  foods: ReadonlyMap<string, FoodVersion>;
  recipes: ReadonlyMap<string, RecipeRevision>;
  /** When editing. */
  existing: MealPreset | null;
}

export interface BuildResult {
  foods: FoodVersion[];
  recipes: RecipeRevision[];
  preset: MealPreset;
  newRevision: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function buildMeal(a: BuildArgs): BuildResult {
  const errors = validateMealForm(a.form);
  if (errors.length) throw new Error(errors.join(' '));
  const f = a.form;
  const base = (id: string) => ({ id, owner_id: a.ownerId, local_version: 0, created_at: a.now, updated_at: a.now, deleted_at: null, synthetic: a.synthetic });
  const outFoods: FoodVersion[] = [];
  const outRecipes: RecipeRevision[] = [];
  let item: MealPreset['items'][number];
  let newRevision = false;
  const serving = {
    unit_label: f.unit_label.trim() || 'serving',
    grams_per_unit: parseNum(f.grams_per_unit),
    default_quantity: parseNum(f.default_quantity)!,
  };
  const prevItem = a.existing?.items[0];

  if (f.kind === 'food') {
    const per = nutrientsFrom(f.per100) as Nutrients;
    const prev = prevItem?.kind === 'food' ? a.foods.get(prevItem.food_version_id) : undefined;
    const source = { kind: f.source_kind, ref: f.source_ref.trim() || null, version: null, license: f.source_kind === 'usda_fdc' ? 'CC0 1.0 (USDA FoodData Central)' : null, note: null };
    const unchanged = prev && same(prev.per_100g, per) && prev.preparation_state === f.preparation_state && same(prev.source, source) && prev.name === f.name.trim();
    let fv: FoodVersion;
    if (prev && unchanged) fv = prev;
    else {
      newRevision = Boolean(prev);
      fv = {
        ...base(a.newId()),
        food_id: prev?.food_id ?? a.newId(),
        revision: (prev?.revision ?? 0) + 1,
        name: f.name.trim(),
        preparation_state: f.preparation_state,
        per_100g: per,
        source,
        assumptions: f.notes.trim() ? [f.notes.trim().slice(0, 300)] : [],
      };
      outFoods.push(fv);
    }
    item = { kind: 'food', food_version_id: fv.id, ...serving };
  } else {
    const ingredients: RecipeRevision['ingredients'] = [];
    for (const ing of f.ingredients) {
      let fvId = ing.food_version_id;
      if (!fvId) {
        const nv: FoodVersion = {
          ...base(a.newId()),
          food_id: a.newId(),
          revision: 1,
          name: ing.name.trim(),
          preparation_state: ing.state,
          per_100g: nutrientsFrom(ing.per100) as Nutrients,
          source: { kind: ing.source_kind, ref: null, version: null, license: ing.source_kind === 'usda_fdc' ? 'CC0 1.0 (USDA FoodData Central)' : null, note: null },
          assumptions: [],
        };
        outFoods.push(nv);
        fvId = nv.id;
      } else {
        const existing = a.foods.get(fvId);
        if (existing && existing.preparation_state !== ing.state) {
          throw new Error(`${existing.name} is recorded as ${existing.preparation_state}; use the same state in the recipe.`);
        }
      }
      ingredients.push({ food_version_id: fvId, grams: parseNum(ing.grams)!, state: ing.state });
    }
    const prev = prevItem?.kind === 'recipe' ? a.recipes.get(prevItem.recipe_revision_id) : undefined;
    const yieldG = parseNum(f.cooked_yield_g)!;
    const assumptions = f.notes.trim() ? [f.notes.trim().slice(0, 300)] : [];
    const unchanged = prev && outFoods.length === 0 && same(prev.ingredients, ingredients) && prev.batch_cooked_edible_yield_g === yieldG && prev.name === f.name.trim() && same(prev.assumptions, assumptions);
    let rr: RecipeRevision;
    if (prev && unchanged) rr = prev;
    else {
      newRevision = Boolean(prev);
      rr = {
        ...base(a.newId()),
        recipe_id: prev?.recipe_id ?? a.newId(),
        revision: (prev?.revision ?? 0) + 1,
        name: f.name.trim(),
        ingredients,
        batch_cooked_edible_yield_g: yieldG,
        assumptions,
      };
      outRecipes.push(rr);
    }
    item = { kind: 'recipe', recipe_revision_id: rr.id, ...serving };
  }

  const preset: MealPreset = {
    ...(a.existing ?? base(a.newId())),
    updated_at: a.now,
    name: f.name.trim().slice(0, 60),
    icon: f.icon,
    photo: f.photo,
    favorite: f.favorite,
    quantity_step: parseNum(f.quantity_step)!,
    items: [item],
    catalogue_id: f.catalogue_id,
    catalogue_version: f.catalogue_version,
  };
  return { foods: outFoods, recipes: outRecipes, preset, newRevision };
}

/** Load a preset back into the editor form. */
export function formFromPreset(p: MealPreset, foods: ReadonlyMap<string, FoodVersion>, recipes: ReadonlyMap<string, RecipeRevision>): MealForm {
  const f = emptyMealForm();
  const it = p.items[0]!;
  const common = {
    ...f,
    name: p.name, icon: p.icon, photo: p.photo ?? null, favorite: p.favorite ?? false,
    catalogue_id: p.catalogue_id ?? null, catalogue_version: p.catalogue_version ?? null,
    unit_label: it.unit_label, grams_per_unit: it.grams_per_unit === null ? '' : String(it.grams_per_unit), default_quantity: String(it.default_quantity), quantity_step: String(p.quantity_step),
  };
  if (it.kind === 'food') {
    const fv = foods.get(it.food_version_id);
    return {
      ...common, kind: 'food',
      preparation_state: fv?.preparation_state ?? 'cooked',
      per100: fv ? nutrientsToForm(fv.per_100g) : emptyNutrients(),
      source_kind: fv?.source.kind ?? 'unknown',
      source_ref: fv?.source.ref ?? '',
      notes: fv?.assumptions.join('; ') ?? '',
    };
  }
  const rr = recipes.get(it.recipe_revision_id);
  return {
    ...common, kind: 'recipe',
    cooked_yield_g: rr ? String(rr.batch_cooked_edible_yield_g) : '',
    notes: rr?.assumptions.join('; ') ?? '',
    ingredients: (rr?.ingredients ?? []).map((ing, i) => {
      const fv = foods.get(ing.food_version_id);
      return {
        key: `${i}-${ing.food_version_id}`, food_version_id: ing.food_version_id, name: fv?.name ?? 'Ingredient', state: ing.state,
        grams: String(ing.grams), per100: fv ? nutrientsToForm(fv.per_100g) : emptyNutrients(), source_kind: fv?.source.kind ?? 'unknown',
      };
    }),
  };
}

/** Starter meals for onboarding: names and usual units only — nutrition stays unknown until set. */
export const STARTER_MEALS: { name: string; icon: FoodIcon; unit: string; grams: number; qty: number; step: number }[] = [
  { name: 'Roti', icon: 'roti', unit: 'roti', grams: 40, qty: 2, step: 1 },
  { name: 'Dal', icon: 'dal', unit: 'bowl', grams: 180, qty: 1, step: 0.5 },
  { name: 'Sabzi', icon: 'sabzi', unit: 'bowl', grams: 150, qty: 1, step: 0.5 },
  { name: 'Dahi', icon: 'dahi', unit: 'bowl', grams: 150, qty: 1, step: 0.5 },
  { name: 'Rice', icon: 'rice', unit: 'bowl', grams: 150, qty: 1, step: 0.5 },
  { name: 'Chai', icon: 'chai', unit: 'cup', grams: 150, qty: 1, step: 1 },
  { name: 'Eggs', icon: 'egg', unit: 'egg', grams: 50, qty: 2, step: 1 },
  { name: 'Paneer', icon: 'paneer', unit: 'serving', grams: 100, qty: 1, step: 0.5 },
  { name: 'Chicken curry', icon: 'curry', unit: 'bowl', grams: 200, qty: 1, step: 0.5 },
  { name: 'Whey shake', icon: 'shake', unit: 'scoop', grams: 30, qty: 1, step: 1 },
  { name: 'Oats', icon: 'oats', unit: 'bowl', grams: 200, qty: 1, step: 0.5 },
  { name: 'Fruit', icon: 'fruit', unit: 'piece', grams: 150, qty: 1, step: 1 },
];

/** Grams typically differ between households; these are only starting points the user should weigh once. */
export function starterForm(s: (typeof STARTER_MEALS)[number]): MealForm {
  return {
    ...emptyMealForm(), name: s.name, icon: s.icon, unit_label: s.unit, grams_per_unit: String(s.grams), default_quantity: String(s.qty),
    quantity_step: String(s.step), source_kind: 'unknown', favorite: true,
  };
}
