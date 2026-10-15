/**
 * The food-plan "shelf": every PUBLIC TrainLuma database dish (Tier 1, complete, not under review)
 * with its published per-serving values, diet (veg / egg / non-veg via `dietOf`) and cuisine.
 * Generated into `supabase/functions/_shared/data/diet-shelf.json` by `scripts/build-diet-shelf.mts`
 * so the `ai` function and the app use exactly the same numbers; a unit test fails if the file is
 * out of date with the database. Counts are never hard-coded: the shelf follows the file.
 */
import { cuisineOf, dietOf, isPunjabiStaple, type FoodDb } from './foodDb.ts';
import type { Shelf } from '../../supabase/functions/_shared/diet.ts';

export function buildShelf(db: FoodDb): Shelf {
  return {
    version: db.version,
    dishes: db.publicDishes.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      serving_label: d.serving_label,
      kcal: d.per_serving!.kcal!,
      protein_g: d.per_serving!.protein_g!,
      carbs_g: d.per_serving!.carbs_g!,
      fat_g: d.per_serving!.fat_g!,
      fiber_g: d.per_serving!.fiber_g!,
      diet: dietOf(d),
      cuisine: cuisineOf(d),
      punjabi: isPunjabiStaple(d),
      brand: Boolean(d.brand),
      text: [d.name, d.name_local, ...d.aliases].join(' ').toLowerCase(),
    })),
  };
}
