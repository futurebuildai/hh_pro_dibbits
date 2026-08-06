/**
 * Product swatches for a catalogue with no photography.
 *
 * Deliberately NOT fake photos. A swatch says "this is the colour and texture
 * of the material" and cannot be mistaken for a picture of the specific SKU —
 * which matters, because a contractor ordering 640 sq ft of paver must never
 * be shown an image that misrepresents what arrives on the pallet.
 *
 * Colours come from manufacturer research (see the accompanying JSON); texture
 * is drawn, not photographed. Randomness is seeded from the SKU so a
 * regeneration is byte-identical — the same rule the catalog seed follows.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** mulberry32, seeded from the sku — same idea as core/lib/rng.ts. */
function rng(seed) {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (a * 31 + seed.charCodeAt(i)) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
function shade(hex, amount) {
  const h = hex.replace('#', '');
  const n = Number.parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  );
  const r = clamp(((n >> 16) & 255) * (1 + amount));
  const g = clamp(((n >> 8) & 255) * (1 + amount));
  const b = clamp((n & 255) * (1 + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const S = 96; // viewBox; SVG scales to whatever the UI asks for

const TEXTURES = {
  /**
   * "Smooth" is a finish, not a flat colour. Cast concrete always carries a
   * fine aggregate fleck, and without it the chip reads as a paint sample —
   * or worse, as an image that failed to load — at the 400px size the customer
   * quote renders it. Faint enough to stay smooth, present enough to be a
   * material.
   */
  smooth: (p, s, r) => {
    let out = `<rect width="${S}" height="${S}" fill="url(#g)"/>
     <rect x="0" y="0" width="${S}" height="${S / 2}" fill="#fff" opacity=".05"/>`;
    for (let i = 0; i < 55; i++) {
      out += `<circle cx="${Math.round(r() * S)}" cy="${Math.round(r() * S)}" r="${(0.4 + r() * 0.7).toFixed(1)}" fill="${r() > 0.5 ? s : shade(p, -0.2)}" opacity=".22"/>`;
    }
    return out;
  },

  textured: (p, s, r) => {
    let out = `<rect width="${S}" height="${S}" fill="${p}"/>`;
    // 80 speckles, integer coords. 190 at sub-pixel precision produced a 13 KB
    // file for a chip that renders at 24-80px — precision nobody can see, paid
    // for in repo weight on every one of these.
    for (let i = 0; i < 80; i++) {
      const x = Math.round(r() * S),
        y = Math.round(r() * S);
      const rad = (0.6 + r() * 1.5).toFixed(1);
      out += `<circle cx="${x}" cy="${y}" r="${rad}" fill="${r() > 0.5 ? s : shade(p, -0.16)}" opacity=".5"/>`;
    }
    return out;
  },

  tumbled: (p, s, r) => {
    let out = `<rect width="${S}" height="${S}" fill="${shade(p, -0.3)}"/>`;
    const cell = S / 2;
    for (let gx = 0; gx < 2; gx++)
      for (let gy = 0; gy < 2; gy++) {
        const tone = r() > 0.5 ? p : s;
        out += `<rect x="${gx * cell + 2}" y="${gy * cell + 2}" width="${cell - 4}" height="${cell - 4}" rx="4" fill="${shade(tone, (r() - 0.5) * 0.14)}"/>`;
      }
    return out;
  },

  slate: (p, s, r) => {
    let out = `<rect width="${S}" height="${S}" fill="${p}"/>`;
    for (let i = 0; i < 26; i++) {
      const y = (r() * S).toFixed(1);
      const w = (S * (0.35 + r() * 0.6)).toFixed(1);
      out += `<rect x="${(r() * (S - w)).toFixed(1)}" y="${y}" width="${w}" height="${(0.7 + r()).toFixed(2)}" fill="${s}" opacity=".38"/>`;
    }
    return out;
  },

  'wood-grain': (p, s, r) => {
    let out = `<rect width="${S}" height="${S}" fill="${p}"/>`;
    for (let i = 0; i < 13; i++) {
      const y = (i * S) / 13 + r() * 3;
      out += `<path d="M0 ${y.toFixed(1)} Q ${S / 3} ${(y + (r() - 0.5) * 5).toFixed(1)} ${S / 2} ${y.toFixed(1)} T ${S} ${(y + (r() - 0.5) * 4).toFixed(1)}" stroke="${s}" stroke-width="${(0.6 + r() * 0.9).toFixed(2)}" fill="none" opacity=".45"/>`;
    }
    return out;
  },

  aggregate: (p, s, r) => {
    let out = `<rect width="${S}" height="${S}" fill="${shade(p, -0.35)}"/>`;
    for (let i = 0; i < 64; i++) {
      const rad = 3 + r() * 8;
      out += `<circle cx="${(r() * S).toFixed(1)}" cy="${(r() * S).toFixed(1)}" r="${rad.toFixed(1)}" fill="${r() > 0.45 ? p : s}" opacity="${(0.75 + r() * 0.25).toFixed(2)}"/>`;
    }
    return out;
  },

  organic: (p, s, r) => {
    let out = `<rect width="${S}" height="${S}" fill="${p}"/>`;
    for (let i = 0; i < 46; i++) {
      const x = r() * S,
        y = r() * S;
      const w = 5 + r() * 16,
        h = 1.6 + r() * 3.2;
      const rot = (r() * 180).toFixed(0);
      out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(h / 2).toFixed(1)}" fill="${r() > 0.5 ? s : shade(p, 0.16)}" opacity=".62" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    }
    return out;
  },

  woven: (p, s, r) => {
    let out = `<rect width="${S}" height="${S}" fill="${p}"/>`;
    for (let i = 0; i <= S; i += 5) {
      out += `<line x1="${i}" y1="0" x2="${i}" y2="${S}" stroke="${s}" stroke-width="1.6" opacity=".33"/>`;
      out += `<line x1="0" y1="${i}" x2="${S}" y2="${i}" stroke="${shade(p, -0.22)}" stroke-width="1.6" opacity=".33"/>`;
    }
    return out;
  },

  mesh: (p, s, r) => {
    let out = `<rect width="${S}" height="${S}" fill="${shade(p, -0.42)}"/>`;
    const step = S / 4;
    for (let gx = 0; gx < 4; gx++)
      for (let gy = 0; gy < 4; gy++)
        out += `<rect x="${gx * step + 2.5}" y="${gy * step + 2.5}" width="${step - 5}" height="${step - 5}" rx="2" fill="none" stroke="${p}" stroke-width="3.5"/>`;
    return out;
  },

  metallic: (p, s, r) =>
    `<rect width="${S}" height="${S}" fill="url(#m)"/>
     <rect x="${S * 0.34}" y="0" width="${S * 0.13}" height="${S}" fill="#fff" opacity=".18"/>`,

  'split-face': (p, s, r) => {
    let out = `<rect width="${S}" height="${S}" fill="${p}"/>`;
    for (let i = 0; i < 15; i++) {
      const x = r() * S,
        y = r() * S,
        w = 12 + r() * 30,
        h = 8 + r() * 22;
      // Quarried stone is read by its FACETS, so they need real contrast —
      // at .68 opacity over a similar tone the whole chip went flat beige.
      out += `<polygon points="${x.toFixed(0)},${y.toFixed(0)} ${(x + w).toFixed(0)},${(y + r() * 8).toFixed(0)} ${(x + w * 0.75).toFixed(0)},${(y + h).toFixed(0)} ${(x - r() * 6).toFixed(0)},${(y + h * 0.8).toFixed(0)}" fill="${r() > 0.5 ? shade(s, -0.2) : shade(p, (r() - 0.5) * 0.7)}" opacity=".9"/>`;
    }
    return out;
  },
};

export function swatch({ sku, primaryHex, secondaryHex, texture }) {
  const r = rng(sku);
  const draw = TEXTURES[texture] ?? TEXTURES.textured;
  const p = primaryHex,
    s = secondaryHex || shade(primaryHex, -0.18);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(p, 0.08)}"/><stop offset="1" stop-color="${shade(p, -0.08)}"/></linearGradient><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(p, 0.22)}"/><stop offset=".5" stop-color="${p}"/><stop offset="1" stop-color="${shade(p, -0.26)}"/></linearGradient></defs>${draw(p, s, r)}</svg>`;
}

export function writeAll(products, outDir) {
  mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const product of products) {
    writeFileSync(join(outDir, `${product.sku}.svg`), swatch(product));
    n++;
  }
  return n;
}
