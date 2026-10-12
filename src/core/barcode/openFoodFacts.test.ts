import { describe, expect, it, vi } from 'vitest';
import { expandUpcE, lookupBarcode, normalizeBarcode, parseProduct, validBarcode } from './openFoodFacts';

describe('barcodes', () => {
  it('checks the GTIN check digit', () => {
    expect(validBarcode('0064200116473')).toBe(true); // EAN-13
    expect(validBarcode('064200116473')).toBe(true); // UPC-A
    expect(validBarcode('96385074')).toBe(true); // EAN-8
    expect(validBarcode('0064200116474')).toBe(false);
    expect(validBarcode('12345')).toBe(false);
    expect(validBarcode('abc0064200116')).toBe(false);
  });

  it('expands UPC-E and normalizes typed codes', () => {
    expect(expandUpcE('04252614')).toBe('042100005264');
    expect(normalizeBarcode(' 0064 2001 16473 ')).toBe('0064200116473');
    expect(normalizeBarcode('04252614')).toBe('042100005264');
    expect(normalizeBarcode('99999999')).toBeNull();
  });

  it('reads label values per 100 g, converting kJ when kcal is missing, and trims untrusted text', () => {
    const p = parseProduct('0064200116473', {
      product_name: '  Greek   Yogurt <b>Plain</b> ',
      brands: 'Oikos, Danone',
      nutriments: { energy_100g: 418.4, proteins_100g: 9, carbohydrates_100g: '4,5', fat_100g: 2, fiber_100g: 'x' },
      serving_size: '175 g', serving_quantity: 175,
    })!;
    expect(p.name).toBe('Greek Yogurt <b>Plain</b>'); // rendered as plain text by React, never as HTML
    expect(p.brand).toBe('Oikos');
    expect(p.per_100g).toEqual({ energy_kcal: 100, protein_g: 9, carbs_g: 4.5, fat_g: 2, fiber_g: null });
    expect(p.serving_grams).toBe(175);
    expect(p.complete).toBe(true);
  });

  it('rejects nameless products and absurd numbers', () => {
    expect(parseProduct('0064200116473', { nutriments: {} })).toBeNull();
    const p = parseProduct('0064200116473', { product_name: 'X', nutriments: { 'energy-kcal_100g': 1e9, proteins_100g: -3 } })!;
    expect(p.per_100g.energy_kcal).toBeNull();
    expect(p.per_100g.protein_g).toBeNull();
    expect(p.complete).toBe(false);
  });

  it('lookup: only the barcode goes out; not found and failures are reported truthfully', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: 1, product: { product_name: 'Oats', nutriments: { 'energy-kcal_100g': 379 } } })));
    const p = await lookupBarcode('0064200116473', f as unknown as typeof fetch);
    expect(p?.name).toBe('Oats');
    const url = (f.mock.calls[0] as unknown as [string, RequestInit])[0];
    expect(url).toMatch(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/0064200116473\.json\?fields=/);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].credentials).toBe('omit');
    expect(await lookupBarcode('0064200116473', (async () => new Response(JSON.stringify({ status: 0 }))) as unknown as typeof fetch)).toBeNull();
    await expect(lookupBarcode('0064200116473', (async () => { throw new TypeError('net'); }) as unknown as typeof fetch)).rejects.toThrow(/Couldn’t reach/);
    await expect(lookupBarcode('123', f as unknown as typeof fetch)).rejects.toThrow(/valid barcode/);
  });
});
