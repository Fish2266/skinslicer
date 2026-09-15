/* ============================================================================
   The skin sheet — where every face of every body part lives in the 64×64
   texture, for both layers and both arm widths.

   Everything that paints — the items, the brush, the fill, mirroring — asks
   this module where a pixel is rather than knowing the layout itself.
   ========================================================================= */

import { boxUV } from '../model/uv.js';

export const SKIN = 64;
export const CAPE_W = 64, CAPE_H = 32;

export const PARTS = ['head', 'body', 'armR', 'armL', 'legR', 'legL'];
export const LAYERS = ['inner', 'outer'];

/* [u, v, w, h, d] for the base layer, and the outer layer's (u, v). */
const INNER = {
  head: [0, 0, 8, 8, 8], body: [16, 16, 8, 12, 4],
  armR: [40, 16, 4, 12, 4], armL: [32, 48, 4, 12, 4],
  legR: [0, 16, 4, 12, 4], legL: [16, 48, 4, 12, 4],
};
const OUTER = {
  head: [32, 0], body: [16, 32], armR: [40, 32], armL: [48, 48], legR: [0, 32], legL: [0, 48],
};

export const PART_LABEL = {
  head: 'Head', body: 'Body', armR: 'Right arm', armL: 'Left arm', legR: 'Right leg', legL: 'Left leg',
};
export const OUTER_LABEL = {
  head: 'Hat layer', body: 'Jacket', armR: 'Right sleeve', armL: 'Left sleeve', legR: 'Right trouser', legL: 'Left trouser',
};

/** Which viewer part draws a given body part and layer. */
export const VIEW_PART = {
  inner: { head: 'head', body: 'body', armR: 'right_arm', armL: 'left_arm', legR: 'right_leg', legL: 'left_leg' },
  outer: { head: 'hat', body: 'jacket', armR: 'right_sleeve', armL: 'left_sleeve', legR: 'right_pants', legL: 'left_pants' },
};

const isArm = p => p === 'armR' || p === 'armL';

export function box(part, layer = 'inner', model = 'classic') {
  const [u0, v0, w, h, d] = INNER[part];
  const [u, v] = layer === 'outer' ? OUTER[part] : [u0, v0];
  return { u, v, w: isArm(part) && model === 'slim' ? 3 : w, h, d };
}

export function faceRect(b, face) {
  return boxUV({ uv: [b.u, b.v], size: [b.w, b.h, b.d] })[face];
}

export const FACE_NAMES = ['top', 'bottom', 'right', 'front', 'left', 'back'];

/* ---- Lookups, built once per arm width ----------------------------------
   One Int16 per texel says which region it belongs to (or -1), so "what is
   under the brush" is a single array read. */
const cache = new Map();

function build(model) {
  const regions = [];
  const at = new Int16Array(SKIN * SKIN).fill(-1);
  for (const layer of LAYERS) {
    for (const part of PARTS) {
      const b = box(part, layer, model);
      for (const face of FACE_NAMES) {
        const r = faceRect(b, face);
        const idx = regions.length;
        regions.push({ part, layer, face, ...r });
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) at[y * SKIN + x] = idx;
      }
    }
  }
  /* Inner texel -> the outer texel directly over it. The outer layer is the
     inner one's layout shifted to a new origin, so the offset is per part. */
  const toOuter = new Int16Array(SKIN * SKIN).fill(-1);
  for (const part of PARTS) {
    const bi = box(part, 'inner', model), bo = box(part, 'outer', model);
    const dx = bo.u - bi.u, dy = bo.v - bi.v;
    for (const face of FACE_NAMES) {
      const r = faceRect(bi, face);
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        toOuter[y * SKIN + x] = (y + dy) * SKIN + (x + dx);
      }
    }
  }
  return { regions, at, toOuter };
}

export function layout(model = 'classic') {
  if (!cache.has(model)) cache.set(model, build(model));
  return cache.get(model);
}

/** The region under a texel, or null for the unused parts of the sheet. */
export function regionAt(x, y, model = 'classic') {
  if (x < 0 || y < 0 || x >= SKIN || y >= SKIN) return null;
  const L = layout(model);
  const i = L.at[y * SKIN + x];
  return i < 0 ? null : L.regions[i];
}

export const isUsed = (x, y, model) => !!regionAt(x, y, model);

/**
 * The texel on the other side of the body — for the mirror brush.
 * Right and left swap parts and side faces; every face flips across.
 */
const MIRROR_PART = { head: 'head', body: 'body', armR: 'armL', armL: 'armR', legR: 'legL', legL: 'legR' };
const MIRROR_FACE = { right: 'left', left: 'right', top: 'top', bottom: 'bottom', front: 'front', back: 'back' };
export function mirrorTexel(x, y, model = 'classic') {
  const r = regionAt(x, y, model);
  if (!r) return null;
  const fx = x - r.x, fy = y - r.y;
  const t = faceRect(box(MIRROR_PART[r.part], r.layer, model), MIRROR_FACE[r.face]);
  return { x: t.x + (t.w - 1 - fx), y: t.y + fy };
}

/* The game ignores alpha on the base layer when it loads a skin. These are
   the three rectangles it forces opaque (PlayerSkin processing). */
export const NO_ALPHA = [[0, 0, 32, 16], [0, 16, 64, 32], [16, 48, 48, 64]];
