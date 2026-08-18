/**
 * Renders one SVG swatch per catalogue product into public/images/products/.
 *
 * Run: npm run swatches
 *
 * The catalogue has no product photography, and inventing photos would be
 * dishonest — a contractor ordering 640 sq ft of paver must never be shown an
 * image implying a finish that is not what arrives on the pallet. A colour and
 * texture SWATCH cannot be mistaken for a photograph of a specific SKU, and it
 * still carries the one thing that matters most in this vertical: hardscape is
 * chosen by colour.
 *
 * Colours live in src/core/data/product-colours.json and were measured from
 * manufacturers' own published swatches, each carrying the confidence it
 * deserves. Anything marked "low" is an inference from the product type and is
 * labelled as such rather than quietly presented as fact.
 *
 * Output is deterministic: the seed is the SKU, so regenerating never churns
 * the repo. Same rule as the catalog seed.
 */
import { mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { swatch } from './swatch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/images/products');

const colours = JSON.parse(readFileSync(join(ROOT, 'src/core/data/product-colours.json'), 'utf8'));
const products = JSON.parse(readFileSync(join(ROOT, 'src/core/data/products.json'), 'utf8'));

const bySku = new Map(colours.map((c) => [c.sku, c]));
const missing = products.filter((p) => !bySku.has(p.sku)).map((p) => p.sku);
if (missing.length > 0) {
  // Loud, not silent: a product with no colour would fall back to a glyph and
  // look like a rendering fault rather than a missing entry.
  throw new Error(`no colour for ${missing.length} product(s): ${missing.join(', ')}`);
}

mkdirSync(OUT, { recursive: true });
// Clear stale swatches so a removed SKU cannot leave an orphan behind.
for (const file of readdirSync(OUT)) {
  if (file.endsWith('.svg')) unlinkSync(join(OUT, file));
}

let bytes = 0;
for (const product of products) {
  const colour = bySku.get(product.sku);
  const svg = swatch(colour);
  bytes += svg.length;
  writeFileSync(join(OUT, `${product.sku}.svg`), svg);
}

const byConfidence = {};
for (const colour of colours) {
  byConfidence[colour.confidence] = (byConfidence[colour.confidence] ?? 0) + 1;
}
process.stdout.write(
  `${products.length} swatches, ${Math.round(bytes / 1024)} KB total\n` +
    `  confidence: ${Object.entries(byConfidence)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')}\n`,
);
