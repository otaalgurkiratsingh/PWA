/**
 * Common cooking ingredients with standard values per 100 g (Canadian Nutrient File 2026; paneer
 * from USDA FNDDS), so a personal recipe starts from real numbers instead of blank fields.
 */
import { z } from 'zod';
import { canonicalTokens } from './catalogue';

const Num = z.number().finite().nonnegative().nullable();
export const Ingredient = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  state: z.enum(['raw', 'dry', 'cooked', 'as_sold']),
  source: z.enum(['cnf-2026', 'fndds-2019-2020']),
  record: z.string(),
  record_name: z.string(),
  per_100g: z.object({ energy_kcal: Num, protein_g: Num, carbs_g: Num, fat_g: Num, fiber_g: Num }),
});
export type Ingredient = z.infer<typeof Ingredient>;
const IngredientFile = z.object({ version: z.string(), ingredients: z.array(Ingredient) });

export function parseIngredients(raw: unknown): Ingredient[] {
  return IngredientFile.parse(raw).ingredients;
}

let loading: Promise<Ingredient[]> | null = null;
export function loadIngredients(): Promise<Ingredient[]> {
  loading ??= import('../../supabase/functions/_shared/data/ingredients-v1.json').then((m) => parseIngredients((m as { default: unknown }).default));
  return loading;
}

/** Every query word must start a word of the name or an alias ("atta", "sarson", "palak"). */
export function searchIngredients(all: readonly Ingredient[], q: string): Ingredient[] {
  const toks = canonicalTokens(q);
  if (!toks.length) return [...all];
  return all.filter((i) => [i.name, ...i.aliases].some((n) => {
    const words = canonicalTokens(n);
    return toks.every((t) => words.some((w) => w.startsWith(t)));
  }));
}
