/**
 * Punjabi Canadian food catalogue: a global, read-only list of food identities for discovery.
 *
 * - It is bundled with the app (no personal data), never copied into anyone's journal.
 *   A person's favourites, recipes, calibrated servings and history are their own records
 *   (MealPreset / FoodVersion / MealEntry) that may point back here with `catalogue_id`.
 * - Every nutrient in the seed is intentionally null. Nothing here may be shown or summed as
 *   a calorie value; numbers come only from the person's label, recipe, or a verified source.
 * - Dietary hints are discovery aids that depend on the recipe, never allergy or vegan guarantees.
 */
import { z } from 'zod';

export const CATEGORY_IDS = [
  'breads', 'rice_grains', 'dals_beans', 'vegetables', 'paneer', 'eggs', 'meat_fish', 'dairy', 'drinks',
  'breakfast', 'snacks', 'sweets', 'fruit', 'nuts_seeds', 'sides_addons', 'canadian_meals',
] as const;
export const CategoryId = z.enum(CATEGORY_IDS);
export type CategoryId = z.infer<typeof CategoryId>;

export const ILLUSTRATION_FAMILIES = [
  'flatbread', 'rice_bowl', 'dal_bowl', 'sabzi_bowl', 'paneer_bowl', 'eggs_plate', 'protein_plate', 'dairy_bowl', 'drink_cup',
  'breakfast_bowl', 'snack_plate', 'sweet_plate', 'fruit', 'nuts_bowl', 'side_bowl', 'canadian_plate',
] as const;

export const DietaryHint = z.enum(['veg', 'egg', 'meat', 'fish', 'veg_or_recipe_dependent', 'mixed']);
export type DietaryHint = z.infer<typeof DietaryHint>;

const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60);
const NullableNutrient = z.number().finite().nonnegative().nullable();

export const CatalogueFood = z.object({
  id: Slug,
  name: z.string().min(1).max(60),
  aliases: z.array(z.string().min(1).max(60)).max(12),
  category_id: CategoryId,
  priority: z.enum(['starter', 'browse']),
  dietary_hint: DietaryHint,
  dietary_confirmation_required: z.boolean(),
  portion: z.object({
    /** UI starting point only, not a recommended portion. */
    suggested_quantity: z.number().positive(),
    display_unit: z.enum(['piece', 'bowl', 'serving', 'egg', 'cup', 'tsp', 'scoop']),
    /** A bowl/katori/piece is not a universal mass; null until the person calibrates it. */
    grams: z.number().positive().nullable(),
    calibration_required: z.boolean(),
  }).strict(),
  nutrition: z.object({
    status: z.enum(['unverified', 'sourced']),
    energy_kcal: NullableNutrient,
    protein_g: NullableNutrient,
    carbohydrate_g: NullableNutrient,
    fat_g: NullableNutrient,
    source_id: z.string().nullable(),
    source_version: z.string().nullable(),
  }).strict(),
  illustration: z.object({
    asset_key: z.string().regex(/^food-[a-z0-9-]+$/),
    family: z.enum(ILLUSTRATION_FAMILIES),
    brief: z.string().max(400),
    asset_status: z.string().max(60),
  }).strict(),
}).strict().superRefine((f, ctx) => {
  const values = [f.nutrition.energy_kcal, f.nutrition.protein_g, f.nutrition.carbohydrate_g, f.nutrition.fat_g];
  // Unverified entries must not carry numbers (and never zeroes standing in for "unknown").
  if (f.nutrition.status === 'unverified' && values.some((v) => v !== null)) {
    ctx.addIssue({ code: 'custom', message: `${f.id}: unverified nutrition must be null` });
  }
  if (f.nutrition.status === 'sourced' && (!f.nutrition.source_id || !f.nutrition.source_version)) {
    ctx.addIssue({ code: 'custom', message: `${f.id}: sourced nutrition needs source_id and source_version` });
  }
  if (f.illustration.asset_key !== `food-${f.id}`) {
    ctx.addIssue({ code: 'custom', message: `${f.id}: asset_key must be food-${f.id}` });
  }
});
export type CatalogueFood = z.infer<typeof CatalogueFood>;

export const CatalogueFile = z.object({
  schema_version: z.literal('1.0'),
  catalogue_id: z.literal('punjabi-canadian-starter'),
  version: z.string().min(1).max(40),
  locale: z.string().max(10),
  item_count: z.number().int().positive(),
  categories: z.array(z.object({ id: CategoryId, label: z.string().min(1).max(60), illustration_family: z.enum(ILLUSTRATION_FAMILIES) }).strict()).length(16),
  foods: z.array(CatalogueFood),
}).passthrough().superRefine((c, ctx) => {
  if (c.item_count !== c.foods.length) ctx.addIssue({ code: 'custom', message: `item_count ${c.item_count} ≠ ${c.foods.length} foods` });
  const seen = new Set<string>();
  for (const f of c.foods) {
    if (seen.has(f.id)) ctx.addIssue({ code: 'custom', message: `duplicate id ${f.id}` });
    seen.add(f.id);
    const cat = c.categories.find((x) => x.id === f.category_id);
    if (cat && cat.illustration_family !== f.illustration.family) ctx.addIssue({ code: 'custom', message: `${f.id}: family does not match its category` });
  }
  if (new Set(c.categories.map((x) => x.id)).size !== c.categories.length) ctx.addIssue({ code: 'custom', message: 'duplicate category' });
});
export type CatalogueFile = z.infer<typeof CatalogueFile>;

// ---- normalised search -------------------------------------------------------------------

/** Lower-case, strip accents and punctuation, collapse spaces. */
export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Reviewed spelling variants (transliterations people actually type). Each token maps to one
 * canonical token; this is spelling only, never a translation guess or a nutrition claim.
 */
export const SPELLING: Readonly<Record<string, string>> = {
  daal: 'dal', dhal: 'dal', daals: 'dal', dals: 'dal',
  sabji: 'sabzi', subzi: 'sabzi', sabjee: 'sabzi',
  curd: 'dahi', dahee: 'dahi', yoghurt: 'yogurt',
  chapati: 'roti', chapatti: 'roti', chappati: 'roti', phulka: 'roti', fulka: 'roti', rotis: 'roti',
  cha: 'chai', chaa: 'chai', chay: 'chai',
  prantha: 'paratha', parantha: 'paratha', parontha: 'paratha', parathas: 'paratha',
  gobi: 'gobhi', bhendi: 'bhindi',
  channa: 'chana', chhole: 'chole', cholle: 'chole', chholey: 'chole',
  rajmah: 'rajma', raajma: 'rajma',
  aaloo: 'aloo', alu: 'aloo', aalu: 'aloo',
  pakoda: 'pakora', pakodas: 'pakora', pakoras: 'pakora',
  laddu: 'ladoo', laddoo: 'ladoo', ladu: 'ladoo',
  barfi: 'burfi', burfee: 'burfi',
  kheera: 'cucumber', khira: 'cucumber',
  doodh: 'milk', dudh: 'milk',
  anda: 'egg', ande: 'egg', eggs: 'egg',
  chawal: 'rice', chaul: 'rice',
  bhatoora: 'bhatura', bhature: 'bhatura',
  poori: 'puri', puris: 'puri',
  dosai: 'dosa',
  khichri: 'khichdi', khichadi: 'khichdi',
  kabab: 'kebab', kabob: 'kebab',
  chili: 'chilli', chilly: 'chilli',
  doughnut: 'donut', donuts: 'donut',
  shakes: 'shake',
};

export function canonicalTokens(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean).map((t) => SPELLING[t] ?? t);
}

export interface IndexedFood {
  food: CatalogueFood;
  /** Canonical token strings for the name and each alias. */
  keys: string[];
}

export interface CatalogueIndex {
  /** "punjabi-canadian-starter@2026-10-09-v2" — stored on records created from the catalogue. */
  seed_version: string;
  categories: CatalogueFile['categories'];
  foods: readonly CatalogueFood[];
  byId: ReadonlyMap<string, CatalogueFood>;
  indexed: readonly IndexedFood[];
}

export function buildIndex(file: CatalogueFile): CatalogueIndex {
  const indexed = file.foods.map((food) => ({ food, keys: [food.name, ...food.aliases].map((s) => canonicalTokens(s).join(' ')) }));
  return {
    seed_version: `${file.catalogue_id}@${file.version}`,
    categories: file.categories,
    foods: file.foods,
    byId: new Map(file.foods.map((f) => [f.id, f])),
    indexed,
  };
}

/**
 * Search names and aliases. Every query token must prefix-match a token of the same name or alias.
 * Ranking: exact name/alias → starts with the query → token matches; starters before browse items,
 * then catalogue order. Empty query returns nothing (callers show categories/favourites instead).
 */
export function searchCatalogue(index: CatalogueIndex, query: string, opts: { category?: CategoryId | null; limit?: number } = {}): CatalogueFood[] {
  const q = canonicalTokens(query);
  if (q.length === 0) return [];
  const qs = q.join(' ');
  const scored: { f: CatalogueFood; score: number; order: number }[] = [];
  index.indexed.forEach(({ food, keys }, order) => {
    if (opts.category && food.category_id !== opts.category) return;
    let best = 0;
    for (const [i, key] of keys.entries()) {
      const toks = key.split(' ');
      if (!q.every((t) => toks.some((k) => k.startsWith(t)))) continue;
      const nameBonus = i === 0 ? 1 : 0;
      const s = key === qs ? 100 + nameBonus : key.startsWith(qs) ? 60 + nameBonus : 20 + nameBonus;
      best = Math.max(best, s);
    }
    // Fallback: the words are spread across the name and its aliases ("protein shake").
    if (best === 0) {
      const all = new Set(keys.flatMap((k) => k.split(' ')));
      if (q.every((t) => [...all].some((k) => k.startsWith(t)))) best = 10;
    }
    if (best > 0) scored.push({ f: food, score: best + (food.priority === 'starter' ? 5 : 0), order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, opts.limit ?? 60).map((s) => s.f);
}

/**
 * Link an existing personal meal (from before the catalogue existed) to a catalogue identity —
 * only on an exact, unique name/alias match (case and punctuation aside). "Roti" → whole-wheat-roti,
 * "Chai" → milk-chai. A generic "Dal" or "Sabzi" stays unlinked: a dish name alone doesn't say which
 * recipe it is. This is a read-only lookup; it never rewrites the meal or its logged snapshots.
 */
export function legacyMatch(index: CatalogueIndex, name: string): CatalogueFood | null {
  // Exact text only (no spelling variants): a near-miss is not a confirmed identity.
  const key = normalize(name);
  if (!key) return null;
  const hits = index.foods.filter((f) => [f.name, ...f.aliases].some((a) => normalize(a) === key));
  return hits.length === 1 ? hits[0]! : null;
}

export function parseCatalogue(raw: unknown): CatalogueIndex {
  return buildIndex(CatalogueFile.parse(raw));
}

let loading: Promise<CatalogueIndex> | null = null;

/** Lazy-load (separate chunk, cached by the service worker) and validate once per session. */
export function loadCatalogue(): Promise<CatalogueIndex> {
  loading ??= import('../../supabase/functions/_shared/data/punjabi-canadian-v2.json').then((m) => parseCatalogue((m as { default: unknown }).default));
  return loading;
}
