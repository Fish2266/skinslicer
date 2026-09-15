/* ============================================================================
   Composing — a base and what is worn over it, flattened into the one skin
   the game reads.

   Items are drawn in order over the base, each through its tints. An item
   that covers the base layer can also clear the base skin's own outer layer
   over the same pixels ("hide what is under it"), so a jacket drawn into the
   old skin's sleeves does not show through a new shirt. Only the base's outer
   layer is cleared — other items are never touched.
   ========================================================================= */

import { SKIN, CAPE_W, CAPE_H, layout } from './layout.js';
import { recolor } from './tint.js';
import { applyNoAlpha } from './image.js';
import { ATLAS, CAPE_V } from '../model/models.js';

/** Straight alpha "over", in place. */
function over(dst, src) {
  for (let i = 0; i < src.length; i += 4) {
    const sa = src[i + 3];
    if (!sa) continue;
    if (sa === 255) { dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; dst[i + 3] = 255; continue; }
    const a = sa / 255, da = dst[i + 3] / 255;
    const oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) dst[i + k] = (src[i + k] * a + dst[i + k] * da * (1 - a)) / oa;
    dst[i + 3] = oa * 255;
  }
}

/**
 * @param {ImageData} base  64×64
 * @param {'classic'|'slim'} model
 * @param {{layer?, pixels?, tints, hideUnder}[]} worn  in draw order. An
 *   entry with `pixels` (raw RGBA) is drawn as it is, untinted — the Paint
 *   view uses that for the item under the brush, whose layer is being redrawn.
 */
export function composeSkin(base, model, worn = []) {
  const out = new Uint8ClampedArray(base.data);
  const { toOuter } = layout(model);
  for (const w of worn) {
    if (!w.hideUnder) continue;
    const px = w.pixels, a = w.layer?.alpha;
    for (let i = 0; i < SKIN * SKIN; i++) {
      const o = toOuter[i];
      if (o >= 0 && (px ? px[i * 4 + 3] : a[i])) out[o * 4 + 3] = 0;
    }
  }
  for (const w of worn) over(out, w.pixels || recolor(w.layer, w.tints));
  return applyNoAlpha(new ImageData(out, SKIN, SKIN));
}

export function composeCape(layer, tints = {}) {
  return new ImageData(recolor(layer, tints), CAPE_W, CAPE_H);
}

/** Skin and cape stacked into the viewer's one texture. */
export function atlas(skin, cape = null) {
  const [w, h] = ATLAS;
  const out = new ImageData(w, h);
  out.data.set(skin.data, 0);
  if (cape) out.data.set(cape.data, CAPE_V * w * 4);
  return out;
}
