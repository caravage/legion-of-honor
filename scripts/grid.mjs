/**
 * Détecte la grille d'une planche de cartes.
 * Les planches sont posées sur un canevas noir ; entre les cartes,
 * les gouttières sont d'un gris uniforme (variance faible), tandis que
 * les cartes elles-mêmes sont très contrastées (variance forte).
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export const DIR = 'public/cards';
const SCALE = 4;

function runs(flags) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

export async function detect(file) {
  const img = sharp(path.join(DIR, file));
  const meta = await img.metadata();
  const w = Math.round(meta.width / SCALE);
  const h = Math.round(meta.height / SCALE);
  const { data } = await img
    .resize(w, h, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const at = (x, y) => data[y * w + x];

  // 1. boîte du contenu : ce qui n'est pas le noir du canevas
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  // 2. écart-type par colonne et par ligne, dans la boîte
  const colSd = [], rowSd = [];
  for (let x = x0; x <= x1; x++) {
    let s = 0, s2 = 0, n = 0;
    for (let y = y0; y <= y1; y++) { const v = at(x, y); s += v; s2 += v * v; n++; }
    colSd.push(Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)));
  }
  for (let y = y0; y <= y1; y++) {
    let s = 0, s2 = 0, n = 0;
    for (let x = x0; x <= x1; x++) { const v = at(x, y); s += v; s2 += v * v; n++; }
    rowSd.push(Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)));
  }

  // 3. bandes de cartes = variance au-dessus d'une fraction du maximum
  const band = (sd, minLen) => {
    const max = Math.max(...sd);
    const thr = max * 0.45;
    return runs(sd.map((v) => v >= thr)).filter(([a, b]) => b - a + 1 >= minLen);
  };
  const cols = band(colSd, Math.round((x1 - x0) / 30));
  const rows = band(rowSd, Math.round((y1 - y0) / 30));

  const s = (v) => v * SCALE;
  return {
    file,
    width: meta.width,
    height: meta.height,
    bbox: [s(x0), s(y0), s(x1 + 1), s(y1 + 1)],
    cols: cols.map(([a, b]) => [s(x0 + a), s(x0 + b + 1)]),
    rows: rows.map(([a, b]) => [s(y0 + a), s(y0 + b + 1)]),
  };
}

if (process.argv[1] && process.argv[1].endsWith('grid.mjs')) {
  for (const f of fs.readdirSync(DIR).filter((x) => /\.(png|jpe?g)$/i.test(x))) {
    const g = await detect(f);
    const cw = g.cols.map(([a, b]) => b - a);
    const rh = g.rows.map(([a, b]) => b - a);
    console.log(`\n${f}  ${g.width}x${g.height}  contenu=${g.bbox.join(',')}`);
    console.log(`  ${g.cols.length} colonnes (largeurs ${Math.min(...cw)}–${Math.max(...cw)})`);
    console.log(`  ${g.rows.length} lignes   (hauteurs ${Math.min(...rh)}–${Math.max(...rh)})`);
    console.log(`  → ${g.cols.length * g.rows.length} cases`);
  }
}
