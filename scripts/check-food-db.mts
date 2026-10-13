// Verifies the TrainLuma food database before it ships (Phase 1).
// Usage: node scripts/check-food-db.mts   (Node 22 runs the TypeScript directly)
// (a) JSON parses and matches the schema
// (b) every Tier-1 dish has complete macros + a source
// (c) no Tier-2 or quarantined item is reachable through search (names, aliases, ids, partials, closest match)
// (d) every restaurant mapping points at a Tier-1, non-quarantined dish
// plus: serving maths, combos, restaurant labels, and the brief's QA searches (§11).
import { readFileSync } from 'node:fs';
import {
  closestDish, complete, coveredByDb, coveredNames, isPublic, MACRO_KEYS, parseFoodDb, scaleMacros, searchDishes, searchRestaurants, TYPICAL_LABEL, type Dish,
} from '../shared/fooddb/foodDb.ts';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail });

const path = new URL('../supabase/functions/_shared/data/indian-dishes-v1.json', import.meta.url);
let raw: { dishes: Dish[]; restaurants: { id: string; dish_mappings: { db_dish_id: string }[] }[] };
let db: ReturnType<typeof parseFoodDb>;
try {
  raw = JSON.parse(readFileSync(path, 'utf8'));
  db = parseFoodDb(raw);
  check('(a) JSON parses and matches the schema', true, `${db.dishes.length} dishes, ${db.restaurants.length} restaurants`);
} catch (e) {
  check('(a) JSON parses and matches the schema', false, String(e));
  report();
}

// (b)
const tier1 = db!.dishes.filter((d) => d.tier === 1 && !d.needs_review);
const incomplete = tier1.filter((d) => !d.source.trim() || !complete(d.per_serving) || (d.per_100g !== null && !complete(d.per_100g)));
check('(b) every Tier-1 dish has complete macros + source', incomplete.length === 0,
  incomplete.length ? incomplete.map((d) => d.id).join(', ') : `${tier1.length} Tier-1 dishes complete; ${db!.publicDishes.length} public`);

// (c)
const hidden = db!.dishes.filter((d) => !isPublic(d));
const leaks: string[] = [];
const probe = (q: string) => {
  for (const h of searchDishes(db!, q, { limit: 500 })) if (!isPublic(h.dish) || hidden.includes(h.dish)) leaks.push(`${q} → ${h.dish.id}`);
  const c = closestDish(db!, q);
  if (c && !isPublic(c.dish)) leaks.push(`closest(${q}) → ${c.dish.id}`);
  for (const r of searchRestaurants(db!, q)) for (const it of r.items) if (!isPublic(it.dish)) leaks.push(`restaurant(${q}) → ${it.dish.id}`);
};
for (const d of hidden) {
  for (const q of [d.name, d.id, d.name_local, ...d.aliases]) probe(q);
  for (const w of d.name.split(/\s+/)) if (w.length >= 3) probe(w);
}
probe('');
const quarantined = db!.dishes.filter((d) => d.needs_review).map((d) => d.id);
check('(c) no Tier-2 or quarantined item reachable in search', leaks.length === 0,
  leaks.length ? leaks.slice(0, 10).join('; ') : `${hidden.length} hidden (incl. quarantined: ${quarantined.join(', ')}); ${hidden.length * 4}+ probes`);

// (d)
const badMaps: string[] = [];
let maps = 0;
for (const r of raw!.restaurants) for (const m of r.dish_mappings) {
  maps++;
  const d = db!.byId.get(m.db_dish_id);
  if (!d || d.tier !== 1 || d.needs_review || !isPublic(d)) badMaps.push(`${r.id} → ${m.db_dish_id}`);
}
check('(d) every restaurant mapping points at a Tier-1 dish', badMaps.length === 0, badMaps.length ? badMaps.join(', ') : `${maps} mappings`);

// Extra: serving maths (per_serving == per_100g × grams/100, ±0.15; brand items use their official per-serving numbers)
const mathOff: string[] = [];
for (const d of db!.publicDishes) {
  if (!d.per_100g || !d.serving_g || d.brand) continue;
  const s = scaleMacros(d, { grams: d.serving_g });
  for (const k of MACRO_KEYS) if (Math.abs((s[k] ?? 0) - (d.per_serving![k] ?? 0)) > 0.15) mathOff.push(`${d.id}.${k}`);
}
check('serving maths: per_100g × grams/100 = per_serving (±0.15)', mathOff.length === 0, mathOff.join(', ') || 'all non-brand dishes');

// Extra: combos equal the sum of their components (±1%)
const comboOff: string[] = [];
for (const d of db!.publicDishes.filter((x) => x.components?.length)) {
  for (const k of MACRO_KEYS) {
    const sum = d.components!.reduce((a, c) => { const x = db!.byId.get(c.dish_id)!; return a + (x.per_100g![k] ?? 0) * c.grams / 100; }, 0);
    if (Math.abs(sum - d.per_serving![k]!) > Math.max(0.2, 0.01 * sum)) comboOff.push(`${d.id}.${k} ${sum.toFixed(1)}≠${d.per_serving![k]}`);
  }
  if (!d.components!.every((c) => isPublic(db!.byId.get(c.dish_id)!))) comboOff.push(`${d.id} has a hidden component`);
}
check('combos: components public and totals match (±1%)', comboOff.length === 0, comboOff.join(', ') || 'rajma chawal, saag + makki');

// Extra: every restaurant card carries the typical-values label
const cards = db!.restaurants.flatMap((r) => searchRestaurants(db!, r.name)).filter((c) => c.kind === 'restaurant');
check('restaurant cards always carry the typical-values label', cards.length > 0 && cards.every((c) => c.label === TYPICAL_LABEL), `${cards.length} cards`);

// Extra: QA searches (§11)
const first = (q: string) => searchDishes(db!, q)[0]?.dish.id ?? '(none)';
const qa: [string, string][] = [['rajma', 'asc165'], ['rajmah', 'asc165'], ['sarson', 'asc217'], ['makki', 'asc150'], ['roti', 'asc096'], ['paneer', 'asc195'], ['parantha', 'asc097'], ['rajma chawal', 'combo-rajma-chawal'], ['double double', 'th-double-double-m']];
const qaBad = qa.filter(([q, id]) => first(q) !== id).map(([q, id]) => `${q}: got ${first(q)}, want ${id}`);
check('QA searches rank the right dish first', qaBad.length === 0, qaBad.join('; ') || qa.map(([q]) => q).join(', '));
check('kadhi pakoda (quarantined) is not in search', !searchDishes(db!, 'kadhi pakoda', { limit: 500 }).some((h) => h.dish.id === 'kadhi-pakoda'), 'search "kadhi pakoda"');

// Extra: reference values (CNF/USDA) only fill gaps. Every list food the database covers is hidden
// from "More foods", so no food shows both a database value and a reference value.
{
  const cat = JSON.parse(readFileSync(new URL('../supabase/functions/_shared/data/punjabi-canadian-v2.json', import.meta.url), 'utf8')) as { foods: { id: string; name: string; aliases: string[] }[] };
  const ref = JSON.parse(readFileSync(new URL('../supabase/functions/_shared/data/food-nutrients-v1.json', import.meta.url), 'utf8')) as { foods: Record<string, unknown> };
  const names = coveredNames(db!);
  const covered = cat.foods.filter((f) => coveredByDb(names, f));
  const shown = cat.foods.filter((f) => !coveredByDb(names, f));
  const withRef = shown.filter((f) => f.id in ref.foods).length;
  // The picker hides exactly `covered` (it uses the same coveredByDb rule).
  const picker = readFileSync(new URL('../src/features/food/FoodPicker.tsx', import.meta.url), 'utf8');
  check('reference values only fill gaps (no food shows two sources)', covered.length > 0 && /filter\(\(f\) => !coveredByDb\(dbNames, f\)\)/.test(picker),
    `${covered.length} list foods covered by the database (hidden); ${withRef} others use CNF/USDA; ${shown.length - withRef} stay "not set"`);
}

report();

function report(): never {
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
