import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import raw from '../../../supabase/functions/_shared/data/punjabi-canadian-v2.json';
import { parseCatalogue } from '@shared/catalogue/catalogue';
import { CATALOGUE_ART, CatalogueArt } from './catalogueArt';

const index = parseCatalogue(raw);

describe('catalogue illustration coverage', () => {
  it('every catalogue asset key resolves to bundled artwork', () => {
    const missing = index.foods.filter((f) => !CATALOGUE_ART[f.illustration.asset_key.replace(/^food-/, '')]).map((f) => f.id);
    expect(missing).toEqual([]);
  });

  it('has no orphan artwork for ids that are not in the catalogue', () => {
    const extra = Object.keys(CATALOGUE_ART).filter((id) => !index.byId.has(id));
    expect(extra).toEqual([]);
  });

  it('every drawing renders real shapes, no text, no external references', () => {
    for (const f of index.foods) {
      const svg = renderToStaticMarkup(<CatalogueArt id={f.id} size={56} />);
      expect(svg, f.id).toMatch(/^<svg/);
      expect((svg.match(/<(path|ellipse|circle|rect)\b/g) ?? []).length, f.id).toBeGreaterThanOrEqual(4);
      expect(svg, f.id).not.toMatch(/<text|<image|href=|NaN|undefined/);
    }
  });

  it('no two foods share an identical picture (no repeated placeholders)', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const f of index.foods) {
      const svg = renderToStaticMarkup(<CatalogueArt id={f.id} />).replace(/ data-art="[^"]+"/, '');
      const prior = seen.get(svg);
      if (prior) dupes.push(`${prior} = ${f.id}`);
      seen.set(svg, f.id);
    }
    expect(dupes).toEqual([]);
  });
});
