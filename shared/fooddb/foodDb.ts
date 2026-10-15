/**
 * TrainLuma food database (indian_dishes.json, "TrainLuma Indian Food DB v1").
 *
 * The ONLY source of the app's dish nutrition numbers. Rules enforced here (and by
 * scripts/check-food-db.mts):
 * - Tier 1 dishes with complete macros and a source are public (searchable, loggable).
 * - Tier 2 dishes stay hidden until their macros are complete; `needs_review` dishes (kadhi pakoda)
 *   are quarantined: never in search, only in the internal "pending verification" list.
 * - Restaurant mappings only ever point at public dishes and always carry the "typical values" label.
 * - Numbers are never invented: serving maths only scales published values (per 100 g × grams, or
 *   per serving × multiplier for brand items whose weight isn't published).
 * Self-contained (only zod) so Node can run the check script directly.
 */
import { z } from 'zod';

const Num = z.number().finite().nonnegative().nullable();
const MacrosSchema = z.object({ kcal: Num, protein_g: Num, carbs_g: Num, fat_g: Num, fiber_g: Num });
export type Macros = z.infer<typeof MacrosSchema>;
export const MACRO_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'] as const;

const DishSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1),
  name_local: z.string(),
  category: z.string(),
  brand: z.string().optional(),
  aliases: z.array(z.string()),
  serving_label: z.string(),
  serving_g: z.number().positive().nullable(),
  per_100g: MacrosSchema.nullable(),
  per_serving: MacrosSchema.nullable(),
  components: z.array(z.object({ dish_id: z.string(), grams: z.number().positive() })).nullable().optional(),
  source: z.string(),
  tier: z.union([z.literal(1), z.literal(2)]),
  needs_review: z.boolean(),
  /** Optional in newer files; inferred otherwise (see cuisineOf). */
  cuisine: z.string().optional(),
});
export type Dish = z.infer<typeof DishSchema>;

const RestaurantSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  address: z.string(),
  cuisine: z.string(),
  signature_dishes: z.array(z.string()),
  nutrition_published: z.boolean(),
  dish_mappings: z.array(z.object({ restaurant_dish: z.string(), db_dish_id: z.string(), note: z.string() })),
  unmapped_dishes: z.array(z.string()),
  source: z.string(),
});
export type Restaurant = z.infer<typeof RestaurantSchema>;

const FileSchema = z.object({
  meta: z.object({ name: z.string(), built: z.string(), licenses: z.string().optional() }).passthrough(),
  dishes: z.array(DishSchema),
  restaurants: z.array(RestaurantSchema),
});

/** Required on every restaurant dish, everywhere it appears. */
export const TYPICAL_LABEL = 'Typical values — this restaurant’s recipe will differ.';

export const ATTRIBUTION =
  'Indian dishes: Indian Food Composition Tables (ICMR-NIN, via mealPlan.fit) and the Indian Nutrient Databank (INDB) research project (via Kaggle, CC BY-SA 4.0). Chain items: each brand’s official Canadian nutrition information.';

export type Diet = 'veg' | 'egg' | 'nonveg';

export interface FoodDb {
  version: string;
  dishes: readonly Dish[];
  byId: ReadonlyMap<string, Dish>;
  /** Searchable, loggable dishes (Tier 1, complete, not under review). */
  publicDishes: readonly Dish[];
  /** Internal verification list: Tier 2 (incomplete) and quarantined dishes. Never user search. */
  pending: readonly Dish[];
  restaurants: readonly Restaurant[];
  brands: readonly string[];
}

export const complete = (m: Macros | null): m is { [K in keyof Macros]: number } =>
  m !== null && MACRO_KEYS.every((k) => m[k] !== null);

export function isPublic(d: Dish): boolean {
  return d.tier === 1 && !d.needs_review && d.source.trim().length > 0 && complete(d.per_serving) && (d.per_100g === null || complete(d.per_100g));
}

export function parseFoodDb(raw: unknown): FoodDb {
  const f = FileSchema.parse(raw);
  const byId = new Map(f.dishes.map((d) => [d.id, d]));
  const publicDishes = f.dishes.filter(isPublic);
  const publicIds = new Set(publicDishes.map((d) => d.id));
  // A mapping that doesn't point at a public dish is dropped, never shown.
  const restaurants = f.restaurants.map((r) => ({ ...r, dish_mappings: r.dish_mappings.filter((m) => publicIds.has(m.db_dish_id)) }));
  return {
    version: `${f.meta.name}@${f.meta.built}`,
    dishes: f.dishes,
    byId,
    publicDishes,
    pending: f.dishes.filter((d) => !publicIds.has(d.id)),
    restaurants,
    brands: [...new Set(publicDishes.map((d) => d.brand).filter((b): b is string => !!b))].sort(),
  };
}

// ---------- normalisation and search ----------

const SPELLING: Record<string, string> = {
  rajmah: 'rajma', parantha: 'paratha', paranthas: 'paratha', parathas: 'paratha', prantha: 'paratha', chapathi: 'chapati', chapatti: 'chapati',
  chapattis: 'chapati', rotis: 'roti', daal: 'dal', dhal: 'dal', dahl: 'dal', sarso: 'sarson', sarsoon: 'sarson', makke: 'makki', makka: 'makki',
  saag: 'saag', sag: 'saag', subzi: 'sabzi', sabji: 'sabzi', sabjee: 'sabzi', kadi: 'kadhi', kari: 'kadhi', pakora: 'pakoda', pakore: 'pakoda',
  pakode: 'pakoda', chole: 'chana', chhole: 'chana', chane: 'chana', biriyani: 'biryani', briyani: 'biryani', bhature: 'bhatura', samose: 'samosa',
  eggs: 'egg', timbits: 'timbit', tims: 'tim', mcdonalds: 'mcdonald', mcdonald: 'mcdonald', doughnut: 'donut', curd: 'dahi', kheer: 'kheer',
  da: 'ki', di: 'ki', de: 'ki', ka: 'ki', ke: 'ki',
};

export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
export function tokens(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean).map((t) => SPELLING[t] ?? t);
}

/** Romanised Punjabi forms ("da", "di", "de") in the local name, or a known Punjabi staple. */
const PUNJABI_STAPLES = new Set(['asc165', 'asc217', 'asc150', 'combo-rajma-chawal', 'combo-saag-makki', 'asc098', 'asc097', 'osr139', 'asc021', 'asc022', 'asc001']);
export function isPunjabiStaple(d: Dish): boolean {
  return PUNJABI_STAPLES.has(d.id) || /\b(da|di|de|te)\b/i.test(d.name_local);
}

const NONVEG = /chicken|mutton|fish|machli|keema|beef|bacon|pepperoni|baconator|big mac|quarter pounder|nugget|shawarma|burger|big mary|big crunch|mcmuffin|mcchicken|meat|lamb|prawn/i;
export function dietOf(d: Dish): Diet {
  const text = `${d.name} ${d.aliases.join(' ')} ${d.category}`;
  if (d.category === 'curries_nonveg' || NONVEG.test(text)) return 'nonveg';
  if (/\begg|omelette|anda\b/i.test(text)) return 'egg';
  return 'veg';
}

export type MealTime = 'breakfast' | 'lunch' | 'dinner' | 'snack';
/** T11: 6–10 breakfast, 12–14 lunch, 19–22 dinner, late night snacks; other hours have no preference. */
export function mealTimeFor(hour: number): MealTime | null {
  if (hour >= 6 && hour < 10) return 'breakfast';
  if (hour >= 12 && hour < 14) return 'lunch';
  if (hour >= 19 && hour < 22) return 'dinner';
  if (hour >= 22 || hour < 4) return 'snack';
  return null;
}
const TIME_CATEGORIES: Record<MealTime, readonly string[]> = {
  breakfast: ['breakfast', 'beverages', 'breads'],
  lunch: ['dals', 'rice', 'curries_veg', 'curries_nonveg', 'combos', 'breads', 'chain restaurants'],
  dinner: ['dals', 'curries_veg', 'curries_nonveg', 'breads', 'combos', 'rice'],
  snack: ['sweets', 'beverages', 'snacks', 'chain restaurants'],
};
export function fitsTime(d: Dish, t: MealTime | null): boolean {
  if (!t) return false;
  if (d.brand) {
    const sweetOrDrink = /coffee|double|timbit|donut|latte|fritter|cream/i.test(d.name);
    if (t === 'breakfast') return sweetOrDrink || /mcmuffin/i.test(d.name);
    if (t === 'lunch' || t === 'dinner') return !sweetOrDrink && !/mcmuffin/i.test(d.name);
  }
  return TIME_CATEGORIES[t].includes(d.category);
}

/**
 * Bicultural ranking: TrainLuma users eat dal-roti AND a Tim's double-double. Every dish is
 * 'indian', 'western' or 'neutral' (fruit, milk, nuts, eggs…: eaten by everyone). A file may set
 * `cuisine`; otherwise brand/chain items are western, a short list of Western staples is western,
 * plain pantry/fruit/vegetable/dairy items are neutral, and the rest is Indian.
 */
export type Cuisine = 'indian' | 'western' | 'neutral';
const WESTERN = /\b(oats?|oatmeal|toast|bagel|muffin|pancake|waffle|cereal|granola|pasta|spaghetti|pizza|burger|sandwich|wrap|salad|fries|latte|cappuccino|coffee|donut|doughnut|croissant|steak|chicken breast|peanut butter|protein bar|shawarma|nuggets?)\b/i;
const NEUTRAL_CATEGORIES = new Set(['pantry', 'fruits', 'vegetables', 'dairy']);
const NEUTRAL = /\b(boiled egg|omelette|milkshake|milk|banana|apple|almonds?|walnuts?|peanuts?|yogh?urt|whey|protein shake)\b/i;
const INDIAN_WORDS = /\b(ghee|paneer|dahi|lassi|chaas|raita|khoya|makhana|sattu|besan|atta|chai|curry|dal)\b/i;
export function cuisineOf(d: Dish): Cuisine {
  const c = d.cuisine?.toLowerCase();
  if (c) return /indian|punjabi|south asian|desi|indo/.test(c) ? 'indian' : /western|american|canadian|italian|mexican|chain|fast/.test(c) ? 'western' : 'neutral';
  if (d.brand || d.category === 'chain restaurants') return 'western';
  if (WESTERN.test(`${d.name} ${d.aliases.join(' ')}`)) return 'western';
  const text = `${d.name} ${d.aliases.join(' ')}`;
  if (!INDIAN_WORDS.test(text) && (NEUTRAL_CATEGORIES.has(d.category) || NEUTRAL.test(d.name))) return 'neutral';
  return 'indian';
}

/** The chain items people actually log most often get a nudge among equals (ids from the file). */
const EVERYDAY_WESTERN = /^(th-double-double-m|mcd-egg-mcmuffin|mcd-mcchicken|osm-shawarma-wrap|sbux-latte-grande)$/;

/** How many of each side the top of a list must hold, when relevant ones exist. */
export const BLEND = { window: 8, minEach: 2 } as const;

/**
 * Make sure the visible top of a ranked list mixes Indian and Western dishes: if one side has fewer
 * than `minEach` in the first `window` while relevant ones exist further down, the best of them
 * replace the lowest-scoring dishes of the over-represented side. The #1 result never moves, and
 * nothing irrelevant is promoted (search passes only real matches; see `relevant`).
 */
export function blendCuisines<T extends { dish: Dish; score: number }>(hits: readonly T[], relevant: (h: T) => boolean = () => true, opts: { window?: number; minEach?: number } = {}): T[] {
  const window = opts.window ?? BLEND.window;
  const minEach = opts.minEach ?? BLEND.minEach;
  const out = [...hits];
  if (out.length <= 1) return out;
  for (const side of ['western', 'indian'] as const) {
    const other = side === 'western' ? 'indian' : 'western';
    const top = out.slice(0, window);
    let have = top.filter((h) => cuisineOf(h.dish) === side).length;
    if (have >= minEach) continue;
    const extra = out.slice(window).filter((h) => cuisineOf(h.dish) === side && relevant(h));
    for (const add of extra) {
      if (have >= minEach) break;
      // Replace the lowest-ranked dish of the other side inside the window (never position 0).
      let at = -1;
      for (let i = Math.min(window, out.length) - 1; i >= 1; i--) if (cuisineOf(out[i]!.dish) === other) { at = i; break; }
      if (at < 0) break;
      const from = out.indexOf(add);
      const [moved] = out.splice(from, 1);
      const [bumped] = out.splice(at, 1, moved!);
      out.splice(window, 0, bumped!);
      have++;
    }
  }
  return out;
}

export interface SearchOptions {
  vegOnly?: boolean;
  /** Mix Indian and Western dishes at the top (default on). */
  blend?: boolean;
  hour?: number;
  /** How often the person logged each dish id recently (recent + frequent first). */
  usage?: ReadonlyMap<string, number>;
  limit?: number;
}

export interface SearchHit { dish: Dish; score: number; match: 'alias' | 'name' | 'prefix' | 'partial' }

function keysOf(d: Dish): { name: string; all: string[] } {
  const brand = d.brand ? [d.brand, `${d.brand} ${d.name}`] : [];
  return { name: tokens(d.name).join(' '), all: [d.name, d.name_local, ...d.aliases, ...brand].map((s) => tokens(s).join(' ')) };
}
const KEYS = new WeakMap<Dish, { name: string; all: string[] }>();
const keys = (d: Dish) => {
  let k = KEYS.get(d);
  if (!k) KEYS.set(d, (k = keysOf(d)));
  return k;
};

/** T3: exact alias → name → prefix → partial; then recent/frequent, time of day, Punjabi first. */
export function searchDishes(db: FoodDb, q: string, opts: SearchOptions = {}): SearchHit[] {
  const qt = tokens(q);
  const query = qt.join(' ');
  const time = opts.hour === undefined ? null : mealTimeFor(opts.hour);
  const hits: SearchHit[] = [];
  for (const d of db.publicDishes) {
    if (opts.vegOnly && dietOf(d) !== 'veg') continue;
    const k = keys(d);
    let base: number;
    let match: SearchHit['match'] = 'partial';
    if (!qt.length) {
      base = 10;
    } else if (k.all.some((a) => a === query) && k.name !== query) {
      base = 100; match = 'alias';
    } else if (k.name === query) {
      base = 96; match = 'name';
    } else if (k.all.some((a) => a.startsWith(query))) {
      // Closer fit first: "sarson" prefers "sarson da saag" over the longer combo name.
      const fit = Math.max(...k.all.filter((a) => a.startsWith(query)).map((a) => query.length / a.length));
      base = 80 + 6 * fit; match = 'prefix';
    } else if (k.all.some((a) => { const w = a.split(' '); return qt.every((t) => w.some((x) => x.startsWith(t))); })) {
      base = 60; match = 'prefix';
    } else {
      const words = new Set(k.all.flatMap((a) => a.split(' ')));
      const got = qt.filter((t) => t.length >= 3 && [...words].some((w) => w.startsWith(t))).length;
      if (!got) continue;
      base = 20 + (30 * got) / qt.length;
    }
    const used = opts.usage?.get(d.id) ?? 0;
    const score = base + Math.min(used, 10) * 2 + (fitsTime(d, time) ? 6 : 0) + (isPunjabiStaple(d) ? 3 : 0) + (EVERYDAY_WESTERN.test(d.id) ? 2 : 0);
    hits.push({ dish: d, score, match });
  }
  hits.sort((a, b) => b.score - a.score || a.dish.name.localeCompare(b.dish.name));
  // Search blends only real matches (alias/name/prefix/all words); suggestions blend everything.
  const ranked = opts.blend === false ? hits : blendCuisines(hits, (h) => !qt.length || h.match !== 'partial');
  return ranked.slice(0, opts.limit ?? 50);
}

/** Character-bigram similarity (0–1), for "did you mean". */
function dice(a: string, b: string): number {
  const grams = (s: string) => { const g = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const x = s.slice(i, i + 2); g.set(x, (g.get(x) ?? 0) + 1); } return g; };
  const A = grams(a.replace(/ /g, ''));
  const B = grams(b.replace(/ /g, ''));
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return total ? (2 * inter) / total : 0;
}

export interface ClosestMatch {
  dish: Dish;
  similarity: number;
  /** 'public': loggable. 'verifying': a Tier-2 dish that IS the food searched for but isn't
   *  loggable yet (shown by name only, never with numbers). */
  status: 'public' | 'verifying';
}

function similarityTo(d: Dish, query: string): { s: number; related: boolean } {
  const qw = query.split(' ');
  let best = { s: 0, related: false };
  for (const k of keys(d).all) {
    // Shared words count most ("dal tadka" → "… dal"), spelling similarity breaks ties.
    const kw = k.split(' ');
    const shared = qw.filter((w) => w.length >= 3 && kw.some((x) => x === w || (w.length >= 5 && (x.startsWith(w) || w.startsWith(x))))).length / qw.length;
    const di = dice(query, k);
    const s = Math.max(di, 0.5 * di + 0.5 * shared);
    // Related = a real shared word, or very close spelling ("rajmah chawl"). Letter overlap alone
    // ("samosa" vs "masala dosa") is not a relation.
    const related = shared > 0 || di >= 0.6;
    if (s > best.s || (s === best.s && related && !best.related)) best = { s, related };
  }
  return best;
}

/**
 * T14: the closest LOGGABLE dish for a search with no results — never an unrelated one ("samosa"
 * is not "masala dosa"). Null when nothing public is related, or when the best match overall is a
 * quarantined dish (then nothing is suggested at all).
 */
export function closestDish(db: FoodDb, q: string, opts: { vegOnly?: boolean } = {}): ClosestMatch | null {
  const m = matchesFor(db, q, opts);
  return m.quarantinedWins ? null : m.pub;
}

/**
 * The food searched for exists but is still being verified (Tier 2): returned by name so the panel
 * can say so instead of offering a lookalike. Never a quarantined (needs_review) dish, never numbers.
 */
export function pendingMatch(db: FoodDb, q: string, opts: { vegOnly?: boolean } = {}): ClosestMatch | null {
  const m = matchesFor(db, q, opts);
  if (m.quarantinedWins || !m.hidden) return null;
  return !m.pub || m.hidden.similarity > m.pub.similarity ? m.hidden : null;
}

function matchesFor(db: FoodDb, q: string, opts: { vegOnly?: boolean }) {
  const query = tokens(q).join(' ');
  let pub: ClosestMatch | null = null;
  let hidden: ClosestMatch | null = null;
  let quarantined = 0;
  if (query.length >= 2) {
    for (const d of db.dishes) {
      if (opts.vegOnly && dietOf(d) !== 'veg') continue;
      const { s, related } = similarityTo(d, query);
      if (!related || s < 0.4) continue;
      if (d.needs_review) quarantined = Math.max(quarantined, s);
      else if (isPublic(d)) { if (!pub || s > pub.similarity) pub = { dish: d, similarity: s, status: 'public' }; }
      else if (!hidden || s > hidden.similarity) hidden = { dish: d, similarity: s, status: 'verifying' };
    }
  }
  const top = Math.max(pub?.similarity ?? 0, hidden?.similarity ?? 0);
  return { pub, hidden, quarantinedWins: quarantined > 0 && quarantined >= top };
}

export interface RestaurantHit {
  kind: 'restaurant' | 'brand';
  id: string;
  name: string;
  subtitle: string;
  /** Restaurant dishes always carry TYPICAL_LABEL; brand items carry their official source. */
  label: string;
  items: { title: string; dish: Dish }[];
}

/** T22: restaurant cards by name, city or cuisine, and chain cards by brand name. */
export function searchRestaurants(db: FoodDb, q: string): RestaurantHit[] {
  const qt = tokens(q);
  if (!qt.length) return [];
  const has = (text: string) => { const w = tokens(text); return qt.every((t) => w.some((x) => x.startsWith(t))); };
  const out: RestaurantHit[] = [];
  for (const r of db.restaurants) {
    if (!has(`${r.name} ${r.city} ${r.cuisine}`)) continue;
    out.push({
      kind: 'restaurant', id: r.id, name: r.name, subtitle: `${r.cuisine} · ${r.address}`, label: TYPICAL_LABEL,
      items: r.dish_mappings.map((m) => ({ title: m.restaurant_dish, dish: db.byId.get(m.db_dish_id)! })),
    });
  }
  for (const b of db.brands) {
    if (!has(b) && !(b === 'Tim Hortons' && qt.includes('tim'))) continue;
    const items = db.publicDishes.filter((d) => d.brand === b).map((d) => ({ title: d.name, dish: d }));
    out.push({ kind: 'brand', id: `brand:${b}`, name: b, subtitle: `${items.length} menu item${items.length === 1 ? '' : 's'}`, label: 'Official Canadian nutrition information.', items });
  }
  return out;
}

// ---------- servings ----------

export const MULTIPLIERS = [0.5, 1, 2, 3] as const;

/** Custom grams need per-100 g values (not available for brand items with unpublished weights). */
export const canUseGrams = (d: Dish) => d.per_100g !== null && complete(d.per_100g) && d.serving_g !== null;

/** Grams of one serving, derived only from published data (null when the brand doesn't publish it). */
export function servingGrams(d: Dish): number | null {
  return d.serving_g;
}

/** T4: macros for `multiplier` servings, or for `grams` (per_100g × grams / 100). Never invents. */
export function scaleMacros(d: Dish, amount: { multiplier: number } | { grams: number }): Macros {
  const r = (x: number | null, f: number) => (x === null ? null : Math.round(x * f * 10) / 10);
  if ('grams' in amount) {
    if (!canUseGrams(d)) throw new Error('This item has no per-100 g values; choose servings instead.');
    const p = d.per_100g!;
    return { kcal: r(p.kcal, amount.grams / 100), protein_g: r(p.protein_g, amount.grams / 100), carbs_g: r(p.carbs_g, amount.grams / 100), fat_g: r(p.fat_g, amount.grams / 100), fiber_g: r(p.fiber_g, amount.grams / 100) };
  }
  const s = d.per_serving!;
  const m = amount.multiplier;
  return { kcal: r(s.kcal, m), protein_g: r(s.protein_g, m), carbs_g: r(s.carbs_g, m), fat_g: r(s.fat_g, m), fiber_g: r(s.fiber_g, m) };
}

/**
 * Per-100 g values for storing a dish as a food. Dishes: as published. Combos: derived from the
 * per-serving total and serving weight. Brand items without a published weight return null (they
 * are stored per serving).
 */
export function per100For(d: Dish): Macros | null {
  if (d.per_100g && complete(d.per_100g)) return d.per_100g;
  if (d.per_serving && complete(d.per_serving) && d.serving_g) {
    const f = 100 / d.serving_g;
    const s = d.per_serving;
    return { kcal: s.kcal * f, protein_g: s.protein_g * f, carbs_g: s.carbs_g * f, fat_g: s.fat_g * f, fiber_g: s.fiber_g * f };
  }
  return null;
}

/** Source line for the dish detail (T5). */
export function sourceLine(d: Dish): string {
  if (d.brand) return `Nutrition: ${d.brand} official Canadian nutrition information.`;
  if (/INDB/.test(d.source)) return 'Nutrition: Indian Nutrient Databank (INDB), from Indian Food Composition Tables (ICMR-NIN).';
  if (/IFCT/.test(d.source)) return 'Nutrition: Indian Food Composition Tables (ICMR-NIN).';
  return `Nutrition: ${d.source}`;
}

let loading: Promise<FoodDb> | null = null;
/** Lazy-load the bundled database (separate cached chunk; works offline). */
export function loadFoodDb(): Promise<FoodDb> {
  loading ??= import('../../supabase/functions/_shared/data/indian-dishes-v1.json').then((m) => parseFoodDb((m as { default: unknown }).default));
  return loading;
}

/**
 * Names (and aliases) of public dishes, normalised. A list food whose name or alias is in this set
 * is covered by the database and is hidden from "More foods", so one food never shows two sets of
 * numbers (database first; reference values only fill the gaps).
 */
export function coveredNames(db: FoodDb): Set<string> {
  return new Set(db.publicDishes.flatMap((d) => [d.name, ...d.aliases].map((x) => tokens(x).join(' '))));
}
export const coveredByDb = (names: Set<string>, food: { name: string; aliases: readonly string[] }) =>
  [food.name, ...food.aliases].some((x) => names.has(tokens(x).join(' ')));
