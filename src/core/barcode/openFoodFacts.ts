/**
 * Packaged foods by barcode, from Open Food Facts (open database, ODbL). Only the barcode number
 * is sent. Values are the product's label per 100 g as entered by contributors; the person checks
 * them against the package before saving.
 */
import type { Nutrients } from '@shared/contracts';

/** GTIN check digit (EAN-13, EAN-8, UPC-A, GTIN-14). UPC-E is expanded by the scanner first. */
export function validBarcode(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** UPC-E (8 digits) → UPC-A (12 digits), so short codes on small packs look up correctly. */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [ns, d1, d2, d3, d4, d5, d6, check] = code.split('');
  let body: string;
  if (d6 === '0' || d6 === '1' || d6 === '2') body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  const upca = `${ns}${body}${check}`;
  return validBarcode(upca) ? upca : null;
}

/** The code to look up: valid as read, or a valid UPC-E expanded to UPC-A. */
export function normalizeBarcode(raw: string): string | null {
  const code = raw.replace(/\D/g, '');
  if (validBarcode(code)) return code;
  return code.length === 8 ? expandUpcE(code) : null;
}

export interface Product {
  barcode: string;
  name: string;
  brand: string | null;
  per_100g: Nutrients;
  /** "Per 100 ml" products: values are for 100 ml and treated as 100 g. */
  liquid: boolean;
  serving_label: string | null;
  serving_grams: number | null;
  complete: boolean;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 10000 ? n : null;
};

/** Parse the API's product object (untrusted input: everything validated, text trimmed). */
export function parseProduct(barcode: string, raw: unknown): Product | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const n = (p.nutriments ?? {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const name = text(p.product_name_en, 70) || text(p.product_name, 70) || text(p.generic_name, 70);
  if (!name) return null;
  const kcal = num(n['energy-kcal_100g']) ?? (num(n.energy_100g) !== null ? Math.round((num(n.energy_100g)! / 4.184) * 10) / 10 : null);
  const per_100g: Nutrients = {
    energy_kcal: kcal,
    protein_g: num(n.proteins_100g),
    carbs_g: num(n.carbohydrates_100g),
    fat_g: num(n.fat_100g),
    fiber_g: num(n.fiber_100g),
  };
  const sq = num(p.serving_quantity);
  return {
    barcode,
    name,
    brand: text(p.brands, 60).split(',')[0]?.trim() || null,
    per_100g,
    liquid: /ml|l\b/i.test(text(p.nutrition_data_per, 20)) || /\bml\b/i.test(text(p.quantity, 30)),
    serving_label: text(p.serving_size, 40) || null,
    serving_grams: sq && sq > 0 && sq < 3000 ? sq : null,
    complete: [per_100g.energy_kcal, per_100g.protein_g, per_100g.carbs_g, per_100g.fat_g].every((v) => v !== null),
  };
}

const FIELDS = 'product_name,product_name_en,generic_name,brands,nutriments,serving_size,serving_quantity,quantity,nutrition_data_per';

export class LookupError extends Error {}

export async function lookupBarcode(barcode: string, fetchImpl: typeof fetch = fetch): Promise<Product | null> {
  if (!validBarcode(barcode)) throw new LookupError('That doesn’t look like a valid barcode. Check the numbers under the bars.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new LookupError('You’re offline. Barcode lookup needs a connection; you can add the food from its label instead.');
  let res: Response;
  try {
    res = await fetchImpl(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${FIELDS}`, {
      headers: { accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12_000),
    });
  } catch (e) {
    throw new LookupError('Couldn’t reach Open Food Facts. Check your connection and try again.', { cause: e });
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new LookupError('Open Food Facts didn’t answer right now. Try again in a moment.');
  const body = (await res.json().catch(() => null)) as { status?: number; product?: unknown } | null;
  if (!body || body.status === 0) return null;
  return parseProduct(barcode, body.product);
}
