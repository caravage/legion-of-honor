/**
 * Découpe les planches en cartes individuelles.
 * Grille : 10 colonnes ; le nombre de lignes se déduit du pas vertical (~585 px).
 * Les cases vides (canevas noir) sont ignorées.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const DIR = 'public/cards';
const OUT = 'public/cards/slices';
const COLS = 10;
const ROW_PITCH = 585;
const WIDTH = 320; // largeur de sortie

const PLATES = {
  'garnison generique.png': 'ig',
  'garnison evenement.png': 'ige',
  'campagne generique.png': 'oc',
  'campagne evenement.png': 'oce',
  'combat.png': 'cbt',
};

fs.mkdirSync(OUT, { recursive: true });

/** Boîte du contenu (hors canevas noir). */
async function bbox(file) {
  const img = sharp(path.join(DIR, file));
  const meta = await img.metadata();
  const s = 4;
  const w = Math.round(meta.width / s);
  const h = Math.round(meta.height / s);
  const { data } = await img.resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[y * w + x] > 24) { if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { W: (x1 + 1) * s, H: (y1 + 1) * s, full: [meta.width, meta.height] };
}

const manifest = {};

for (const [file, prefix] of Object.entries(PLATES)) {
  if (!fs.existsSync(path.join(DIR, file))) { console.log(`absent : ${file}`); continue; }
  const { W, H, full } = await bbox(file);
  const rows = Math.max(1, Math.round(H / ROW_PITCH));
  const cw = W / COLS;
  const chh = H / rows;
  console.log(`\n${file} → contenu ${W}x${H}, grille ${COLS}x${rows}, case ${cw.toFixed(1)}x${chh.toFixed(1)}`);

  const src = sharp(path.join(DIR, file));
  const kept = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      const left = Math.round(c * cw);
      const top = Math.round(r * chh);
      const width = Math.min(Math.round(cw), full[0] - left);
      const height = Math.min(Math.round(chh), full[1] - top);
      if (width < 20 || height < 20) continue;
      const buf = await src.clone().extract({ left, top, width, height }).toBuffer();
      // case vide ?
      const st = await sharp(buf).greyscale().stats();
      if (st.channels[0].mean < 12) continue;
      const idx = r * COLS + c;
      const name = `${prefix}-${String(idx).padStart(2, '0')}.jpg`;
      await sharp(buf).resize(WIDTH).jpeg({ quality: 82 }).toFile(path.join(OUT, name));
      kept.push({ idx, row: r, col: c, file: `cards/slices/${name}` });
    }
  }
  manifest[prefix] = { plate: file, cols: COLS, rows, cells: kept };
  console.log(`  ${kept.length} cartes extraites`);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('\nmanifest écrit.');
