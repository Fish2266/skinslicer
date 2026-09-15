/* ============================================================================
   Cutting clothes out of a skin, and cutting one item into pieces.

   A skin pulled from a player is their whole body: skin, face, clothes. Two
   things turn it into something you can wear over someone else:

   Erasing. By brush, by "everything connected that is this colour" (the
   wand), by "this colour, everywhere", or by "this skin, every shade of it"
   — the quickest way to lose a player's hands and neck. Each is a mask
   first, so the maker can show what a click will take before it does.

   Splitting. A look that is a shirt, trousers and shoes becomes three items,
   each on its own shelf and tintable on its own, cut where the body is cut:
   the head is the hat, the body and arms are the top, the legs are the
   bottoms — except their last few rows, which are the shoes wherever the
   colour changes there.
   ========================================================================= */

import { PARTS, box, faceRect, layout, SKIN } from './layout.js';
import { rgbToOklab } from './color.js';

export const PIECES = [
  { id: 'hat', label: 'Hat', cat: 'hats' },
  { id: 'top', label: 'Top', cat: 'tops' },
  { id: 'bottoms', label: 'Bottoms', cat: 'bottoms' },
  { id: 'shoes', label: 'Shoes', cat: 'shoes' },
];

const LEGS = ['legR', 'legL'];
const SIDES = ['right', 'front', 'left', 'back'];
const LEG_H = 12;

function pieceOf(region, fy, shoeRows) {
  if (region.part === 'head') return 'hat';
  if (!LEGS.includes(region.part)) return 'top';
  if (region.face === 'top') return 'bottoms';
  if (region.face === 'bottom') return shoeRows > 0 ? 'shoes' : 'bottoms';
  return fy >= LEG_H - shoeRows ? 'shoes' : 'bottoms';
}

/**
 * The pieces an item image falls into.
 * @returns {{ id, label, cat, img: ImageData, count }[]} only pieces with pixels
 */
export function splitPieces(img, model, shoeRows) {
  const { at, regions } = layout(model);
  const out = new Map(PIECES.map(p => [p.id, { ...p, img: new ImageData(SKIN, SKIN), count: 0 }]));
  for (let i = 0; i < SKIN * SKIN; i++) {
    if (!img.data[i * 4 + 3] || at[i] < 0) continue;
    const r = regions[at[i]];
    const p = out.get(pieceOf(r, Math.floor(i / SKIN) - r.y, shoeRows));
    p.img.data.set(img.data.subarray(i * 4, i * 4 + 4), i * 4);
    p.count++;
  }
  return PIECES.map(p => out.get(p.id)).filter(p => p.count);
}

/**
 * How many rows at the bottom of the legs are shoes: the run of rows, from
 * the soles up, whose main colour is not the trousers'. The trousers are the
 * most typical of the main colours of the top half of the legs. At most half
 * the leg.
 *
 * Colours are compared in OKLab, lightness and all. The tint groups will not
 * do here: they are built to keep every shade of one colour together, so grey
 * trousers and black shoes are one group to them.
 */
export function guessShoeRows(img, model) {
  const d = img.data;
  const rows = [];
  for (let fy = 0; fy < LEG_H; fy++) {
    const tally = new Map();
    for (const part of LEGS) for (const face of SIDES) {
      const ri = faceRect(box(part, 'inner', model), face), ro = faceRect(box(part, 'outer', model), face);
      for (let fx = 0; fx < ri.w; fx++) {
        // What shows: the outer layer where it has a pixel, the inner below.
        const io = (ro.y + fy) * SKIN + ro.x + fx, ii = (ri.y + fy) * SKIN + ri.x + fx;
        const i = d[io * 4 + 3] ? io : d[ii * 4 + 3] ? ii : -1;
        if (i < 0) continue;
        // Near-identical shades count as one, so noise does not split a row's vote.
        const key = ((d[i * 4] >> 3) << 10) | ((d[i * 4 + 1] >> 3) << 5) | (d[i * 4 + 2] >> 3);
        const e = tally.get(key) || { n: 0, i };
        e.n++;
        tally.set(key, e);
      }
    }
    let best = null;
    for (const e of tally.values()) if (!best || e.n > best.n) best = e;
    rows.push(best ? labAt(d, best.i) : null);
  }
  const upper = rows.slice(0, LEG_H / 2).filter(Boolean);
  if (!upper.length) {
    // No trousers kept, only what is below them: all of that is shoe.
    let k = 0;
    for (let fy = LEG_H - 1; fy >= LEG_H / 2 && rows[fy]; fy--) k++;
    return k;
  }
  let trousers = upper[0], least = Infinity;
  for (const a of upper) {
    const s = upper.reduce((t, b) => t + labDist(a, b), 0);
    if (s < least) { least = s; trousers = a; }
  }
  let k = 0;
  for (let fy = LEG_H - 1; fy >= LEG_H / 2; fy--) {
    if (!rows[fy] || labDist(rows[fy], trousers) < SHOE_STEP) break;
    k++;
  }
  return k;
}
/* How different a row has to be from the trousers to be shoe: well past
   shading noise (a few hundredths), well short of grey against black. */
const SHOE_STEP = 0.09;

/* ========================================================================= */
/* ERASING BY COLOUR                                                         */
/* ========================================================================= */

const labAt = (d, i) => rgbToOklab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
const labDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Slider 0..100 to an OKLab distance: 0 is exact, 100 is very loose. */
export const tolerance = v => 0.004 + (v / 100) ** 1.4 * 0.2;

/** Clear every pixel a mask marks. Returns how many were cleared. */
export function eraseMask(img, mask) {
  const d = img.data;
  let n = 0;
  for (let i = 0; i < SKIN * SKIN; i++) if (mask[i] && d[i * 4 + 3]) { d[i * 4 + 3] = 0; n++; }
  return n;
}

/** Every pixel near a colour, as a mask. `only` limits it to a set of texels. */
export function colourMask(img, rgb, tol, only = null) {
  const ref = rgbToOklab(rgb[0], rgb[1], rgb[2]);
  const d = img.data, m = new Uint8Array(SKIN * SKIN);
  for (let i = 0; i < SKIN * SKIN; i++) {
    if (!d[i * 4 + 3] || (only && !only[i])) continue;
    if (labDist(labAt(d, i), ref) <= tol) m[i] = 1;
  }
  return m;
}
export const eraseColour = (img, rgb, tol, only = null) => eraseMask(img, colourMask(img, rgb, tol, only));

/**
 * Every pixel that is this skin, lit or in shadow, as a mask. Shading a skin
 * moves its lightness a long way but its hue and colourfulness hardly at
 * all, so the match is loose on lightness and tight on the rest — and a
 * pixel much greyer than the skin is never skin, which keeps white socks and
 * grey trousers safe from a pale hand.
 */
export function skinMask(img, tones, tol, only = null) {
  const refs = tones.map(t => { const lab = rgbToOklab(t[0], t[1], t[2]); return { lab, chroma: Math.hypot(lab[1], lab[2]) }; });
  const band = Math.max(0.16, tol * 3), near = tol * 1.25;
  const d = img.data, m = new Uint8Array(SKIN * SKIN);
  for (let i = 0; i < SKIN * SKIN; i++) {
    if (!d[i * 4 + 3] || (only && !only[i])) continue;
    const c = labAt(d, i), chroma = Math.hypot(c[1], c[2]);
    if (refs.some(r => Math.hypot(c[1] - r.lab[1], c[2] - r.lab[2]) <= near
      && Math.abs(c[0] - r.lab[0]) <= band && chroma >= r.chroma * 0.45)) m[i] = 1;
  }
  return m;
}

/**
 * The wand: everything connected to (x, y) that is near its colour, on the
 * same body part and layer. The sheet keeps a part's four sides side by
 * side, so a flood across them goes round the part — a hand is one click.
 */
export function wandSelect(img, x, y, tol, model) {
  const { at, regions } = layout(model);
  const start = y * SKIN + x;
  if (at[start] < 0 || !img.data[start * 4 + 3]) return null;
  const { part, layer } = regions[at[start]];
  const ref = labAt(img.data, start);
  const hit = new Uint8Array(SKIN * SKIN);
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    if (hit[i]) continue;
    const r = at[i] >= 0 ? regions[at[i]] : null;
    if (!r || r.part !== part || r.layer !== layer || !img.data[i * 4 + 3]) continue;
    if (labDist(labAt(img.data, i), ref) > tol) continue;
    hit[i] = 1;
    const px = i % SKIN, py = (i - px) / SKIN;
    if (px > 0) stack.push(i - 1);
    if (px < SKIN - 1) stack.push(i + 1);
    if (py > 0) stack.push(i - SKIN);
    if (py < SKIN - 1) stack.push(i + SKIN);
  }
  return hit;
}

/** Texels of the given parts (both layers unless told), as a mask. */
export function partMask(model, keep) {
  const m = new Uint8Array(SKIN * SKIN);
  const { at, regions } = layout(model);
  for (let i = 0; i < SKIN * SKIN; i++) {
    const r = at[i] >= 0 ? regions[at[i]] : null;
    if (r && keep[r.layer]?.[r.part]) m[i] = 1;
  }
  return m;
}

/** Does any kept pixel sit on this part and layer? */
export function partHasPixels(img, part, layer, model) {
  for (const face of ['top', 'bottom', ...SIDES]) {
    const r = faceRect(box(part, layer, model), face);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      if (img.data[(y * SKIN + x) * 4 + 3]) return true;
    }
  }
  return false;
}

export { PARTS };
