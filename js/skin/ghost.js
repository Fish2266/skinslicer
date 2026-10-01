/* ============================================================================
   The ghost layer — the glitched, corrupted-looking skin.

   A skin's outer layer is normally the hat, the jacket, the sleeves: a second
   shell drawn half a pixel proud of the body. Fill that shell with a copy of
   the body itself, half see-through, and the game draws every pixel twice
   with a sliver of air between the two — the figure reads as smeared out of
   register with itself. It works on any skin, because the only colours it
   uses are the skin's own.

   Only the outer layer is touched. The base layer underneath is left exactly
   as it was, which is just as well: the game forces that layer opaque
   whatever the file says, so a ghost drawn there would simply go solid.
   ========================================================================= */

import { SKIN, layout } from './layout.js';
import { cloneImage } from './image.js';

/** What the effect is usually drawn at: half solid. */
export const GHOST_OPACITY = 0.5;

/**
 * A copy of the skin with its outer layer ghosted.
 *
 * @param {ImageData} img              a 64×64 skin
 * @param {'classic'|'slim'} model     which arm width the sheet is laid out for
 * @param {object} o
 *   opacity    0..1, how solid the ghost is
 *   keepOuter  leave the outer layer be wherever it already has pixels, so a
 *              hat or a jacket survives and only the bare parts are ghosted
 * @returns {ImageData} a new skin — the one passed in is not touched
 */
export function ghostOuter(img, model = 'classic', { opacity = GHOST_OPACITY, keepOuter = false } = {}) {
  const out = cloneImage(img);
  const { toOuter } = layout(model);
  /* Alpha 0 would be nothing at all and 255 would hide the body it is a copy
     of, so the ghost is kept inside those. */
  const a = Math.max(1, Math.min(254, Math.round(opacity * 255)));
  for (let i = 0; i < SKIN * SKIN; i++) {
    const o2 = toOuter[i];
    if (o2 < 0) continue;                                   // not under the outer layer
    if (keepOuter && out.data[o2 * 4 + 3]) continue;         // something is already there
    if (!img.data[i * 4 + 3]) { out.data[o2 * 4 + 3] = 0; continue; }
    out.data[o2 * 4] = img.data[i * 4];
    out.data[o2 * 4 + 1] = img.data[i * 4 + 1];
    out.data[o2 * 4 + 2] = img.data[i * 4 + 2];
    out.data[o2 * 4 + 3] = a;
  }
  return out;
}

/** How many pixels of a skin are a ghost: on the outer layer, and see-through. */
export function ghostPixels(img) {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0 && img.data[i] < 255) n++;
  return n;
}
