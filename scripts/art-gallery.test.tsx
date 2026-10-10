// Renders every catalogue illustration into an HTML gallery for visual review.
// Run: GALLERY_OUT=/path/gallery.html npx vitest run scripts/art-gallery.test.tsx
import { writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { it } from 'vitest';
import raw from '../shared/catalogue/punjabi-canadian-v2.json';
import { parseCatalogue } from '../shared/catalogue/catalogue';
import { CatalogueArt } from '../src/core/design/catalogueArt';

it.runIf(!!process.env.GALLERY_OUT)('writes the gallery', () => {
  const index = parseCatalogue(raw);
  const sections = index.categories.map((c) => {
    const tiles = index.foods.filter((f) => f.category_id === c.id).map((f) =>
      `<figure><div class="tile">${renderToStaticMarkup(<CatalogueArt id={f.id} size={72} />)}</div><figcaption>${f.name}</figcaption></figure>`).join('');
    return `<h2>${c.label}</h2><div class="grid">${tiles}</div>`;
  }).join('');
  writeFileSync(process.env.GALLERY_OUT!, `<!doctype html><meta charset="utf-8"><style>
body{font:12px system-ui;margin:12px;background:#F7F8FA;color:#1b1f24}h2{font-size:14px;margin:14px 0 6px}
.grid{display:grid;grid-template-columns:repeat(8,92px);gap:6px}figure{margin:0;text-align:center}
.tile{width:84px;height:84px;border-radius:18px;background:#FFF1E6;display:grid;place-items:center;margin:auto}
figcaption{font-size:10px;line-height:1.2;height:24px;overflow:hidden}</style>${sections}`);
});
