import { describe, expect, it } from 'vitest';
import { dietOf, parseFoodDb } from './foodDb';
import { buildShelf } from './dietShelf';
import raw from '../../supabase/functions/_shared/data/indian-dishes-v1.json';
import shelfFile from '../../supabase/functions/_shared/data/diet-shelf.json';

const db = parseFoodDb(raw);
const file = shelfFile as ReturnType<typeof buildShelf>;

describe('diet shelf', () => {
  it('is in sync with the food database (run `node scripts/build-diet-shelf.mts` after a database update)', () => {
    expect(file).toEqual(buildShelf(db));
  });
  it('holds exactly the public dishes, with their published per-serving numbers and diet', () => {
    expect(file.dishes.map((d) => d.id)).toEqual(db.publicDishes.map((d) => d.id));
    for (const d of file.dishes) {
      const src = db.byId.get(d.id)!;
      expect(d.kcal).toBe(src.per_serving!.kcal);
      expect(d.protein_g).toBe(src.per_serving!.protein_g);
      expect(d.diet).toBe(dietOf(src));
    }
    expect(file.dishes.some((d) => db.pending.some((p) => p.id === d.id))).toBe(false);
  });
});
