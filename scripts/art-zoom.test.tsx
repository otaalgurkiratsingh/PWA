// Renders chosen illustrations large: ZOOM_IDS=a,b,c GALLERY_OUT=... npx vitest run scripts/art-zoom.test.tsx
import { writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { it } from 'vitest';
import { CatalogueArt } from '../src/core/design/catalogueArt';
import { FoodArt } from '../src/core/design/foodArt';

it.runIf(!!process.env.ZOOM_IDS)('writes zoomed tiles', () => {
  const ids = process.env.ZOOM_IDS!.split(',');
  const tiles = ids.map((id) => `<figure><div class="tile">${id.startsWith('icon:') ? renderToStaticMarkup(<FoodArt icon={id.slice(5) as never} size={150} />) : renderToStaticMarkup(<CatalogueArt id={id} size={150} />)}</div><figcaption>${id}</figcaption></figure>`).join('');
  writeFileSync(process.env.GALLERY_OUT!, `<!doctype html><meta charset="utf-8"><style>body{font:12px system-ui;margin:8px;background:#F7F8FA}.grid{display:grid;grid-template-columns:repeat(5,170px);gap:8px}figure{margin:0;text-align:center}.tile{width:166px;height:166px;border-radius:28px;background:#FFF1E6;display:grid;place-items:center}</style><div class="grid">${tiles}</div>`);
});
