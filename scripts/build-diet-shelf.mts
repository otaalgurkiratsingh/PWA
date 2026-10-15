// Regenerate supabase/functions/_shared/data/diet-shelf.json from the bundled food database.
// Usage: node scripts/build-diet-shelf.mts        (writes the file)
//        node scripts/build-diet-shelf.mts --check (exits 1 when the file is out of date)
// Run it whenever indian-dishes-v1.json changes; `npm run test` also fails until it is in sync.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseFoodDb } from '../shared/fooddb/foodDb.ts';
import { buildShelf } from '../shared/fooddb/dietShelf.ts';

const SRC = 'supabase/functions/_shared/data/indian-dishes-v1.json';
const OUT = 'supabase/functions/_shared/data/diet-shelf.json';
const next = `${JSON.stringify(buildShelf(parseFoodDb(JSON.parse(readFileSync(SRC, 'utf8')))))}\n`;
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    // missing file counts as out of date
  }
  if (current !== next) {
    console.error(`${OUT} is out of date. Run: node scripts/build-diet-shelf.mts`);
    process.exit(1);
  }
  console.log('diet shelf up to date');
} else {
  writeFileSync(OUT, next);
  console.log(`wrote ${OUT} (${JSON.parse(next).dishes.length} public dishes)`);
}
