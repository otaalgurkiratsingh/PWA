/**
 * Standard reference nutrition for catalogue foods: published values per 100 g from the
 * Canadian Nutrient File (Health Canada, 2026) or USDA FNDDS, with each source's own serving
 * weight. Shown as "standard estimates" — a family recipe or brand can differ, and the person can
 * replace them with their own recipe or a package label at any time.
 */
import { z } from 'zod';

const Num = z.number().finite().nonnegative().nullable();
export const StandardFile = z.object({
  version: z.string(),
  sources: z.array(z.object({ id: z.string(), name: z.string(), version: z.string(), licence: z.string(), url: z.string(), attribution: z.string() })),
  foods: z.record(z.string(), z.object({
    source: z.string(),
    record: z.string(),
    record_name: z.string(),
    method: z.enum(['record', 'recipe']),
    match: z.enum(['exact', 'close']),
    per_100g: z.object({ energy_kcal: Num, protein_g: Num, carbs_g: Num, fat_g: Num, fiber_g: Num }),
    serving: z.object({ unit: z.string(), grams: z.number().positive(), basis: z.enum(['source', 'assumed']), note: z.string() }),
  })),
});
export type StandardFile = z.infer<typeof StandardFile>;
export type StandardSource = StandardFile['sources'][number];

export interface StandardNutrition {
  file_version: string;
  source: StandardSource;
  record: string;
  record_name: string;
  method: 'record' | 'recipe';
  match: 'exact' | 'close';
  per_100g: StandardFile['foods'][string]['per_100g'];
  serving: StandardFile['foods'][string]['serving'];
}

export function parseStandard(raw: unknown): ReadonlyMap<string, StandardNutrition> {
  const f = StandardFile.parse(raw);
  const sources = new Map(f.sources.map((s) => [s.id, s]));
  const out = new Map<string, StandardNutrition>();
  for (const [id, e] of Object.entries(f.foods)) {
    const source = sources.get(e.source);
    if (!source) continue; // a value without a known, licensed source is never shown
    out.set(id, { file_version: f.version, source, record: e.record, record_name: e.record_name, method: e.method, match: e.match, per_100g: e.per_100g, serving: e.serving });
  }
  return out;
}

/** Calories and protein for `grams` of the food (null when the source has no value). */
export function perServing(s: StandardNutrition, grams: number) {
  const k = grams / 100;
  const v = (x: number | null) => (x === null ? null : x * k);
  return { energy_kcal: v(s.per_100g.energy_kcal), protein_g: v(s.per_100g.protein_g), carbs_g: v(s.per_100g.carbs_g), fat_g: v(s.per_100g.fat_g) };
}

export const shortSource = (s: StandardSource) => (s.id.startsWith('cnf') ? 'Canadian Nutrient File' : 'USDA FoodData Central');
