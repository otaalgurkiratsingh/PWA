/**
 * Drop-in import of a new indian_dishes.json (e.g. the final 229-dish file).
 *
 *   node scripts/import-food-db.mts /path/to/indian_dishes.json          # validate only
 *   node scripts/import-food-db.mts /path/to/indian_dishes.json --write  # validate, install, check
 *
 * Validates the file with the app's own schema, prints tier / review / restaurant counts, refuses
 * files that would break the hard rules (restaurant mappings to hidden dishes, malformed macros),
 * then installs it as supabase/functions/_shared/data/indian-dishes-v1.json and runs
 * `npm run check:food-db`. Existing journal entries are never touched (logs carry their own values).
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { isPublic, parseFoodDb } from '../shared/fooddb/foodDb.ts';

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node scripts/import-food-db.mts <indian_dishes.json> [--write]');
  process.exit(2);
}
const raw = JSON.parse(readFileSync(file, 'utf8'));
const db = parseFoodDb(raw); // throws with the zod path on any schema problem
const tier1 = db.dishes.filter((d) => d.tier === 1).length;
const review = db.dishes.filter((d) => d.needs_review).length;
const tier1Incomplete = db.dishes.filter((d) => d.tier === 1 && !d.needs_review && !isPublic(d)).map((d) => d.id);
const badMaps = db.restaurants.flatMap((r) => r.dish_mappings.filter((m) => !db.publicDishes.some((d) => d.id === m.db_dish_id)).map((m) => `${r.id}→${m.db_dish_id}`));
console.log(`${file}`);
console.log(`  dishes ${db.dishes.length} · Tier 1 ${tier1} · Tier 2 ${db.dishes.length - tier1} · needs_review ${review} · public ${db.publicDishes.length}`);
console.log(`  restaurants ${db.restaurants.length} · brands ${db.brands.length}`);
if (tier1Incomplete.length) console.log(`  note: ${tier1Incomplete.length} Tier-1 dishes lack complete macros or a source and stay hidden: ${tier1Incomplete.slice(0, 12).join(', ')}${tier1Incomplete.length > 12 ? '…' : ''}`);
if (badMaps.length) {
  console.error(`  REFUSED: restaurant mappings point at hidden dishes: ${badMaps.join(', ')}`);
  process.exit(1);
}
if (flag !== '--write') {
  console.log('  valid. Re-run with --write to install it.');
  process.exit(0);
}
writeFileSync(new URL('../supabase/functions/_shared/data/indian-dishes-v1.json', import.meta.url), `${JSON.stringify(raw, null, 2)}\n`);
console.log('  installed → supabase/functions/_shared/data/indian-dishes-v1.json');
execSync('node scripts/check-food-db.mts', { stdio: 'inherit' });
console.log('Next: npm run check (unit tests that pin counts, e.g. "72 public", need their numbers updated).');
