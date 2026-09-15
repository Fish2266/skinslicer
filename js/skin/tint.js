/* ============================================================================
   Tinting — recolour a thing one colour group at a time.

   A red-and-green hat is two groups, and tinting it blue-and-yellow means the
   red becomes blue and the green becomes yellow: every shade of red follows
   the red, every shade of green follows the green, and neither bleeds into the
   other. Tinting the whole item with one colour would turn it into one muddy
   blob, which is exactly what this is here to avoid.

   So every opaque pixel of a layer carries
     group  which colour family it belongs to, and
     lch    its own colour in OKLCh,
   and each group has a reference colour. Recolouring moves the reference to
   the new colour and carries every pixel along by its own offset from the
   reference — lighter stays lighter, a hue-shifted shadow stays hue-shifted.

   Preset items are drawn with their groups named up front (items.js), so
   their groups are exact. Anything imported — your own items, a cape pulled
   from a player — is split into groups here by clustering its colours.
   ========================================================================= */

import { clamp, hexToRgba, rgbaToHex, lerp } from '../core/util.js';
import { rgbToOklch, oklchToRgb, angleDiff, colorName } from './color.js';

/* Chroma below this is treated as grey: its hue is noise. */
const GREY = 0.03;
/* One step of preset shading, in OKLab lightness. */
export const SHADE_STEP = 0.06;

function emptyLayer(w, h) {
  const n = w * h;
  return {
    w, h,
    alpha: new Uint8Array(n),
    group: new Int8Array(n).fill(-1),
    rgb: new Uint8Array(n * 3),
    lch: new Float32Array(n * 3),
    groups: [],
  };
}

function setPixel(layer, i, r, g, b, a, gi) {
  layer.alpha[i] = a;
  layer.group[i] = gi;
  layer.rgb[i * 3] = r; layer.rgb[i * 3 + 1] = g; layer.rgb[i * 3 + 2] = b;
  const [L, C, H] = rgbToOklch(r, g, b);
  layer.lch[i * 3] = L; layer.lch[i * 3 + 1] = C; layer.lch[i * 3 + 2] = H;
}

function refOf(hex) {
  const [r, g, b] = hexToRgba(hex);
  const [L, C, H] = rgbToOklch(r, g, b);
  return { L, C, H, hex: rgbaToHex(r, g, b) };
}

/* ========================================================================= */
/* BUILDING LAYERS                                                           */
/* ========================================================================= */

/**
 * A layer drawn in named groups ("slots"). Each pixel is a slot and a shade;
 * the shade is a lightness step away from the slot's colour.
 * @param {{w,h, slot:Int8Array, shade:Float32Array, alpha:Uint8Array, slots:{name,color}[]}} o
 */
export function layerFromSlots({ w, h, slot, shade, alpha, slots }) {
  const layer = emptyLayer(w, h);
  const refs = slots.map(s => refOf(s.color));
  const counts = new Array(slots.length).fill(0);
  for (let i = 0; i < w * h; i++) {
    const s = slot[i];
    if (s < 0 || !alpha[i]) continue;
    const ref = refs[s];
    const sh = shade[i] || 0;
    // Highlights lose a touch of chroma and shadows keep it, the way paint
    // does — flat lightness steps alone look plastic.
    const C = ref.C * (sh > 0 ? Math.max(0.55, 1 - sh * 0.1) : 1);
    const [r, g, b] = oklchToRgb(ref.L + sh * SHADE_STEP, C, ref.H);
    setPixel(layer, i, r, g, b, alpha[i], s);
    counts[s]++;
  }
  layer.groups = slots.map((s, i) => ({ name: s.name, ...refs[i], count: counts[i] }));
  return layer;
}

/**
 * A layer from plain pixels, split into colour groups automatically.
 * @param {ImageData|{width,height,data}} img
 * @param {number} split 0..1 — how readily colours become separate groups
 */
export function layerFromPixels(img, split = 0.5) {
  const w = img.width, h = img.height, d = img.data;
  const layer = emptyLayer(w, h);

  /* ---- Unique colours --------------------------------------------------- */
  const uniq = new Map();
  for (let i = 0; i < w * h; i++) {
    if (d[i * 4 + 3] < 8) continue;
    const key = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
    uniq.set(key, (uniq.get(key) || 0) + 1);
  }
  /* A shaded or noisy texture can have a couple of thousand colours, and the
     clustering below compares every pair, so they are bucketed — the more
     colours, the coarser — until there are at most MAX_BUCKETS. That is for
     the clustering only: every pixel still keeps its exact colour. */
  const MAX_BUCKETS = 256;
  let drop = 0, buckets, bucketOf;
  for (;;) {
    const m = (0xFF << drop) & 0xFF, mask = (m << 16) | (m << 8) | m;
    bucketOf = key => key & mask;
    buckets = new Map();
    for (const [key, n] of uniq) {
      const b = bucketOf(key);
      const e = buckets.get(b) || { n: 0, r: 0, g: 0, bl: 0 };
      e.n += n; e.r += ((key >> 16) & 255) * n; e.g += ((key >> 8) & 255) * n; e.bl += (key & 255) * n;
      buckets.set(b, e);
    }
    if (buckets.size <= MAX_BUCKETS || drop >= 6) break;
    drop++;
  }

  /* ---- Cluster ----------------------------------------------------------
     Agglomerative, merging the closest pair until nothing is close enough.
     Distance is mostly hue (weighted by how colourful both sides are), then
     colourfulness, and only a little lightness — shades of one colour must
     land together, but black and white are still different things. */
  const clusters = [];
  const feat = c => ({ L: c.L / c.n, k: c.k / c.n, H: Math.atan2(c.hy, c.hx) });
  for (const [b, e] of buckets) {
    const [L, C, H] = rgbToOklch(e.r / e.n, e.g / e.n, e.bl / e.n);
    const k = Math.min(1, C / 0.09);
    const c = { n: e.n, L: L * e.n, k: k * e.n, hx: Math.cos(H) * k * e.n, hy: Math.sin(H) * k * e.n, members: [b], alive: true };
    c.f = feat(c);
    clusters.push(c);
  }
  const dist = (fa, fb) => {
    const dh = Math.abs(angleDiff(fa.H, fb.H)) / Math.PI;
    return Math.hypot(3.0 * dh * Math.min(fa.k, fb.k), 1.1 * (fa.k - fb.k), 0.8 * (fa.L - fb.L));
  };
  const threshold = lerp(0.7, 0.14, clamp(split, 0, 1));
  const MAX_GROUPS = 12;
  /* Every distance is worked out once into a table; a merge only redoes the
     merged cluster's row. The pairs are searched in the same order as ever,
     so the same colours make the same groups. */
  const N = clusters.length;
  const D = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) D[i * N + j] = D[j * N + i] = dist(clusters[i].f, clusters[j].f);
  let alive = N;
  while (alive > 1) {
    let best = Infinity, bi = -1, bj = -1;
    for (let i = 0; i < N; i++) {
      if (!clusters[i].alive) continue;
      const row = i * N;
      for (let j = i + 1; j < N; j++) {
        if (clusters[j].alive && D[row + j] < best) { best = D[row + j]; bi = i; bj = j; }
      }
    }
    if (best > threshold && alive <= MAX_GROUPS) break;
    const ba = clusters[bi], bb = clusters[bj];
    ba.n += bb.n; ba.L += bb.L; ba.k += bb.k; ba.hx += bb.hx; ba.hy += bb.hy;
    ba.members.push(...bb.members);
    bb.alive = false;
    alive--;
    ba.f = feat(ba);
    for (let j = 0; j < N; j++) if (j !== bi && clusters[j].alive) D[bi * N + j] = D[j * N + bi] = dist(ba.f, clusters[j].f);
  }

  /* ---- Groups, biggest first --------------------------------------------- */
  const live = clusters.filter(c => c.alive).sort((a, b) => b.n - a.n);
  const groupOfBucket = new Map();
  live.forEach((c, gi) => { for (const m of c.members) groupOfBucket.set(m, gi); });

  const acc = live.map(() => ({ n: 0, L: 0, a: 0, b: 0 }));
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3];
    if (a < 8) continue;
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const gi = groupOfBucket.get(bucketOf((r << 16) | (g << 8) | b));
    setPixel(layer, i, r, g, b, a, gi);
    const L = layer.lch[i * 3], C = layer.lch[i * 3 + 1], H = layer.lch[i * 3 + 2];
    const e = acc[gi];
    e.n++; e.L += L; e.a += C * Math.cos(H); e.b += C * Math.sin(H);
  }
  layer.groups = acc.map((e, gi) => {
    const L = e.L / e.n, a = e.a / e.n, b = e.b / e.n;
    const C = Math.hypot(a, b), H = Math.atan2(b, a);
    const [r, g, bl] = oklchToRgb(L, C, H);
    // The reference is the group's hex, not the unrounded mean, so a layer
    // rebuilt later from the kept groups (layerFromGroups) tints identically.
    return { name: colorName(L, C, H), ...refOf(rgbaToHex(r, g, bl)), count: e.n, gi };
  });
  numberNames(layer.groups);
  return layer;
}

/* Two groups called "Red" are fine, but number them so a list reads. The
   first of a name keeps it, so a group that was already there is never renamed. */
function numberNames(groups) {
  const seen = {};
  for (const g of groups) {
    seen[g.name] = (seen[g.name] || 0) + 1;
    if (seen[g.name] > 1) g.name = `${g.name} ${seen[g.name]}`;
  }
}

const joinThreshold = split => lerp(0.7, 0.14, clamp(split, 0, 1));
function featOfHex(hex) {
  const [r, g, b] = hexToRgba(hex);
  const [L, C, H] = rgbToOklch(r, g, b);
  return { L, k: Math.min(1, C / 0.09), H };
}
const featDist = (fa, fb) => Math.hypot(
  3.0 * (Math.abs(angleDiff(fa.H, fb.H)) / Math.PI) * Math.min(fa.k, fb.k), 1.1 * (fa.k - fb.k), 0.8 * (fa.L - fb.L));

/**
 * A layer whose groups are already known — kept from the last time it was
 * built, or inherited from a preset — so a group keeps its number, its name
 * and its reference colour for as long as it has pixels, and every tint
 * keyed by that number stays put.
 *
 * Only pixels with no group (painted since, or never grouped) are clustered,
 * among themselves; each cluster joins the nearest known group if it is as
 * close as the clustering would merge, or becomes a new group at the end.
 *
 * @param {{ map: Int8Array, groups: {name, hex}[] }} known  a group index per pixel (-1: none)
 */
export function layerFromGroups(img, known, split = 0.5) {
  const w = img.width, h = img.height, d = img.data, n = w * h;
  const layer = emptyLayer(w, h);
  const defs = known.groups.map(g => ({ name: g.name, hex: g.hex }));
  const assign = new Int8Array(n).fill(-1);
  let loose = 0;
  for (let i = 0; i < n; i++) {
    if (d[i * 4 + 3] < 8) continue;
    const g = known.map[i];
    if (g >= 0 && g < defs.length) assign[i] = g; else loose++;
  }
  if (loose) {
    const sub = new Uint8ClampedArray(d.length);
    for (let i = 0; i < n; i++) if (d[i * 4 + 3] >= 8 && assign[i] < 0) sub.set(d.subarray(i * 4, i * 4 + 4), i * 4);
    const fresh = layerFromPixels({ width: w, height: h, data: sub }, split);
    const limit = joinThreshold(split);
    const to = fresh.groups.map(fg => {
      const ff = featOfHex(fg.hex);
      let best = -1, bd = Infinity;
      defs.forEach((kg, gi) => { const dd = featDist(ff, featOfHex(kg.hex)); if (dd < bd) { bd = dd; best = gi; } });
      if (best >= 0 && (bd <= limit || defs.length >= 120)) return best;   // Int8 has room for 127
      defs.push({ name: fg.name, hex: fg.hex });
      return defs.length - 1;
    });
    for (let i = 0; i < n; i++) if (assign[i] < 0 && fresh.alpha[i]) assign[i] = to[fresh.group[i]];
  }
  const counts = new Array(defs.length).fill(0);
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3];
    if (a < 8 || assign[i] < 0) continue;
    setPixel(layer, i, d[i * 4], d[i * 4 + 1], d[i * 4 + 2], a, assign[i]);
    counts[assign[i]]++;
  }
  layer.groups = defs.map((g, gi) => ({ name: g.name, ...refOf(g.hex), count: counts[gi], gi }));
  numberNames(layer.groups);
  return layer;
}

/* ========================================================================= */
/* RECOLOURING                                                               */
/* ========================================================================= */

/**
 * Move one pixel from its group's reference colour to the tint.
 * Lightness is remapped proportionally rather than offset, so a white
 * highlight on a dark reference stays near white instead of clipping, and a
 * black shadow on a light one stays near black.
 */
function shift(pL, pC, pH, ref, t) {
  const L = pL >= ref.L
    ? t.L + (pL - ref.L) * (1 - t.L) / Math.max(0.04, 1 - ref.L)
    : t.L * pL / Math.max(0.04, ref.L);
  let C, H;
  if (ref.C > GREY) {
    C = t.C * (pC / ref.C);
    H = pC > GREY ? t.H + angleDiff(pH, ref.H) : t.H;
  } else {
    // A grey group has no hue to keep: every pixel takes the tint's, at the
    // tint's colourfulness.
    C = t.C;
    H = t.H;
  }
  return oklchToRgb(L, Math.min(C, 0.37), H);
}

/**
 * The layer's pixels with tints applied.
 * @param {object} layer
 * @param {{[group:number]: string}} tints hex per group index; missing = as drawn
 * @returns {Uint8ClampedArray} RGBA
 */
export function recolor(layer, tints = {}) {
  const n = layer.w * layer.h;
  const out = new Uint8ClampedArray(n * 4);
  const targets = layer.groups.map((g, gi) => {
    const hex = tints[gi];
    return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) && hex.toLowerCase() !== g.hex.toLowerCase() ? refOf(hex) : null;
  });
  for (let i = 0; i < n; i++) {
    const a = layer.alpha[i];
    if (!a) continue;
    const gi = layer.group[i];
    const t = gi >= 0 ? targets[gi] : null;
    let r = layer.rgb[i * 3], g = layer.rgb[i * 3 + 1], b = layer.rgb[i * 3 + 2];
    if (t) [r, g, b] = shift(layer.lch[i * 3], layer.lch[i * 3 + 1], layer.lch[i * 3 + 2], layer.groups[gi], t);
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
  }
  return out;
}

/**
 * Carry tints across a re-clustering of the same pixels — after painting an
 * item, splitting it into pieces, or turning a preset into your own copy —
 * where the group numbers are no longer the ones the tints were keyed by.
 *
 * A new group takes the tint of the old group most of its pixels came from,
 * if most of them did. Only pixels that are still the colour they were get a
 * vote: a stroke of fresh orange over a blue that was tinted is a new colour,
 * and shows as drawn rather than inheriting the blue's tint.
 */
export function remapTints(oldLayer, newLayer, tints = {}) {
  if (!oldLayer || !newLayer || !Object.keys(tints).length) return {};
  const votes = newLayer.groups.map(() => new Map());
  const n = Math.min(oldLayer.alpha.length, newLayer.alpha.length);
  const o = oldLayer.rgb, w = newLayer.rgb;
  for (let i = 0; i < n; i++) {
    if (!oldLayer.alpha[i] || !newLayer.alpha[i]) continue;
    if (o[i * 3] !== w[i * 3] || o[i * 3 + 1] !== w[i * 3 + 1] || o[i * 3 + 2] !== w[i * 3 + 2]) continue;
    const og = oldLayer.group[i], ng = newLayer.group[i];
    if (og < 0 || ng < 0) continue;
    votes[ng].set(og, (votes[ng].get(og) || 0) + 1);
  }
  const out = {};
  votes.forEach((m, ng) => {
    let best = -1, most = 0, total = 0;
    for (const [og, c] of m) { total += c; if (c > most) { most = c; best = og; } }
    if (best >= 0 && tints[best] && most * 2 >= total) out[ng] = tints[best];
  });
  return out;
}

/**
 * The main colours of a skin, biggest first, for matching an outfit to it.
 * Only the parts of the sheet the game draws count; the face's own colour —
 * the skin tone — is left out by default, because clothes matched to it come
 * out as more skin.
 */
export function skinPalette(img, usedMask, { skipFace = true, faceRect = null } = {}) {
  const d = new Uint8ClampedArray(img.data);
  for (let i = 0; i < usedMask.length; i++) if (!usedMask[i]) d[i * 4 + 3] = 0;
  const layer = layerFromPixels({ width: img.width, height: img.height, data: d }, 0.5);
  let skip = -1;
  if (skipFace && faceRect) {
    const tally = new Map();
    for (let y = faceRect.y + faceRect.h / 2; y < faceRect.y + faceRect.h; y++) for (let x = faceRect.x; x < faceRect.x + faceRect.w; x++) {
      const g = layer.group[y * img.width + x];
      if (g >= 0) tally.set(g, (tally.get(g) || 0) + 1);
    }
    let most = 0;
    for (const [g, c] of tally) if (c > most) { most = c; skip = g; }
  }
  const groups = visibleGroups(layer).filter(g => g.gi !== skip).sort((a, b) => b.count - a.count);
  return { all: visibleGroups(layer).sort((a, b) => b.count - a.count).map(g => g.hex), match: groups.map(g => g.hex) };
}

/** The colour a group shows as, tinted or not. */
export const groupHex = (layer, gi, tints = {}) => (typeof tints[gi] === 'string' ? tints[gi] : null) || layer.groups[gi]?.hex || '#000000';

/** Groups that actually have pixels, biggest first, with their index. */
export function visibleGroups(layer) {
  return layer.groups.map((g, gi) => ({ ...g, gi })).filter(g => g.count > 0);
}
