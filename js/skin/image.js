/* ============================================================================
   Skin and cape images — reading them in, and putting them in the shape the
   game expects.

   Everything in the app is stored as raw RGBA at the game's own size: a
   64×64 skin, a 64×32 cape. PNG only happens at the edges, on the way in and
   on the way out.
   ========================================================================= */

import { AppError } from '../core/util.js';
import { SKIN, CAPE_W, CAPE_H, NO_ALPHA } from './layout.js';

export function blankImage(w, h) { return new ImageData(w, h); }
export const cloneImage = img => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
export const imageFrom = (pixels, w, h) => new ImageData(new Uint8ClampedArray(pixels), w, h);

/** Any image source to ImageData at its natural size. */
export async function decodeImage(src) {
  let bmp;
  if (src instanceof Blob) bmp = await createImageBitmap(src);
  else if (typeof src === 'string') bmp = await createImageBitmap(await (await fetch(src)).blob());
  else bmp = src;
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

/** Nearest-neighbour resample, sampling each target pixel at its centre. */
export function resample(img, w, h) {
  const out = new ImageData(w, h);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ix = Math.min(img.width - 1, Math.floor((x + 0.5) * sx));
    const iy = Math.min(img.height - 1, Math.floor((y + 0.5) * sy));
    const s = (iy * img.width + ix) * 4, d = (y * w + x) * 4;
    out.data[d] = img.data[s]; out.data[d + 1] = img.data[s + 1];
    out.data[d + 2] = img.data[s + 2]; out.data[d + 3] = img.data[s + 3];
  }
  return out;
}

function blit(src, sx, sy, w, h, dst, dx, dy, flip = false) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = flip ? w - 1 - x : x;
    const s = ((sy + y) * src.width + sx + fx) * 4;
    const d = ((dy + y) * dst.width + dx + x) * 4;
    for (let k = 0; k < 4; k++) dst.data[d + k] = src.data[s + k];
  }
}

/**
 * Mirror one limb onto another, face by face, the way the game converts an
 * old 64×32 skin: each face is flipped, and the two side faces trade places.
 */
function mirrorLimb(img, u, v, tu, tv, w = 4, h = 12, d = 4) {
  blit(img, u + d, v, w, d, img, tu + d, tv, true);              // top
  blit(img, u + d + w, v, w, d, img, tu + d + w, tv, true);      // bottom
  blit(img, u, v + d, d, h, img, tu + d + w, tv + d, true);      // right -> left
  blit(img, u + d, v + d, w, h, img, tu + d, tv + d, true);      // front
  blit(img, u + d + w, v + d, d, h, img, tu, tv + d, true);      // left -> right
  blit(img, u + d + w + d, v + d, w, h, img, tu + d + w + d, tv + d, true); // back
}

/** An old 64×32 skin, grown to 64×64 exactly as the game does it. */
export function convertLegacy(img) {
  const out = new ImageData(SKIN, SKIN);
  out.data.set(img.data.subarray(0, SKIN * 32 * 4));
  mirrorLimb(out, 0, 16, 16, 48);   // right leg -> left leg
  mirrorLimb(out, 40, 16, 32, 48);  // right arm -> left arm
  // Notch's transparency hack: an old skin with a fully opaque hat layer
  // meant "no hat", so the whole layer goes clear.
  let opaque = true;
  for (let y = 0; y < 16 && opaque; y++) for (let x = 32; x < 64; x++) {
    if (out.data[(y * SKIN + x) * 4 + 3] < 128) { opaque = false; break; }
  }
  if (opaque) for (let y = 0; y < 16; y++) for (let x = 32; x < 64; x++) out.data[(y * SKIN + x) * 4 + 3] = 0;
  return out;
}

/** The base layer is opaque in the game whatever the file says. */
export function applyNoAlpha(img) {
  for (const [x0, y0, x1, y1] of NO_ALPHA) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data[(y * SKIN + x) * 4 + 3] = 255;
  }
  return img;
}

/**
 * Whatever came in, as a 64×64 skin. Accepts the modern square sheet, the
 * old 64×32 one, and HD multiples of either (which the game itself will not
 * read, so they are scaled down rather than refused).
 * @returns {{ img: ImageData, legacy: boolean, scaled: boolean }}
 */
export function normalizeSkin(img) {
  const { width: w, height: h } = img;
  const square = w === h, legacy = w === h * 2;
  if (!(square || legacy) || w < 64 || w % 64) {
    throw new AppError(`That is ${w}×${h}. A skin is 64×64 (or an old 64×32).`);
  }
  let src = img, scaled = false;
  if (w !== 64) { src = resample(img, 64, legacy ? 32 : 64); scaled = true; }
  const out = legacy ? convertLegacy(src) : new ImageData(new Uint8ClampedArray(src.data), 64, 64);
  return { img: applyNoAlpha(out), legacy, scaled };
}

/**
 * Whatever came in, as a 64×32 cape. Mojang's capes are 64×32; the original
 * 22×17 sheet is the same layout in the corner of a smaller file; and HD
 * capes from mods are a multiple of 64×32, scaled down to it.
 */
export function normalizeCape(img) {
  const { width: w, height: h } = img;
  const out = new ImageData(CAPE_W, CAPE_H);
  if (w === h * 2 && w >= 64 && w % 64 === 0) {
    const s = w === 64 ? img : resample(img, CAPE_W, CAPE_H);
    out.data.set(s.data);
    return { img: out, scaled: w !== 64 };
  }
  if (w <= CAPE_W && h <= CAPE_H && w >= 22 && h >= 17) {
    blit(img, 0, 0, w, h, out, 0, 0);
    return { img: out, scaled: false };
  }
  throw new AppError(`That is ${w}×${h}. A cape is 64×32.`);
}

/**
 * Slim ("Alex") arms are three pixels wide, which leaves two columns of the
 * sheet empty that a classic skin always fills. If both gaps are clear, it
 * is a slim skin.
 */
export function guessSlim(img) {
  const clear = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 0) return false;
    }
    return true;
  };
  return clear(54, 20, 55, 31) && clear(50, 16, 51, 19);
}

export function imageToCanvas(img, scale = 1) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  if (scale === 1) return c;
  const s = document.createElement('canvas');
  s.width = img.width * scale; s.height = img.height * scale;
  const g = s.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(c, 0, 0, s.width, s.height);
  return s;
}

export function imageToPng(img) {
  return new Promise((res, rej) => imageToCanvas(img).toBlob(b => (b ? res(b) : rej(new Error('Could not encode the PNG'))), 'image/png'));
}
