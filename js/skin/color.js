/* ============================================================================
   Colour in OKLab.

   Tinting has to move a colour to a new hue while keeping its shading, and
   RGB and HSV are both bad at that: a yellow and a blue of the same HSV value
   are wildly different brightnesses, so a shaded red tinted blue in HSV goes
   muddy in the shadows and neon in the highlights. OKLab's lightness is
   perceptual, so "this pixel is 0.12 lighter than the colour it was drawn
   from" means the same thing in every hue.
   ========================================================================= */

import { clamp } from '../core/util.js';

const s2l = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const l2s = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255;

export function rgbToOklab(r, g, b) {
  const lr = s2l(r), lg = s2l(g), lb = s2l(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

export function rgbToOklch(r, g, b) {
  const [L, a, bb] = rgbToOklab(r, g, b);
  return [L, Math.hypot(a, bb), Math.atan2(bb, a)];
}

const inGamut = lin => lin.every(c => c >= -0.0005 && c <= 1.0005);

/**
 * OKLCh back to sRGB bytes. Colours outside sRGB keep their lightness and
 * hue and give up chroma until they fit — the standard way to land a colour
 * that cannot be displayed, and the one that keeps a ramp's shading intact.
 */
export function oklchToRgb(L, C, H) {
  L = clamp(L, 0, 1);
  C = Math.max(0, C);
  let lin = oklabToLinear(L, C * Math.cos(H), C * Math.sin(H));
  if (!inGamut(lin)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const t = oklabToLinear(L, mid * Math.cos(H), mid * Math.sin(H));
      if (inGamut(t)) lo = mid; else hi = mid;
    }
    lin = oklabToLinear(L, lo * Math.cos(H), lo * Math.sin(H));
  }
  return lin.map(c => clamp(Math.round(l2s(clamp(c, 0, 1))), 0, 255));
}

/** Signed difference between two angles, in (-π, π]. */
export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** A plain English name for a colour — used to label colour groups. */
export function colorName(L, C, H) {
  if (C < 0.035) return L < 0.3 ? 'Black' : L > 0.86 ? 'White' : 'Grey';
  const deg = ((H * 180 / Math.PI) + 360) % 360;
  if ((deg < 75 || deg > 350) && L < 0.55 && C < 0.13) return 'Brown';
  if (deg < 12 || deg >= 350) return L > 0.72 ? 'Pink' : 'Red';
  if (deg < 40) return L > 0.75 ? 'Pink' : 'Red';
  if (deg < 75) return 'Orange';
  if (deg < 115) return 'Yellow';
  if (deg < 165) return 'Green';
  if (deg < 215) return 'Teal';
  if (deg < 280) return 'Blue';
  if (deg < 320) return 'Purple';
  return 'Pink';
}

/* Minecraft's sixteen dye colours, as the game tints leather and banners
   with them — the most familiar palette there is for recolouring clothes. */
export const DYES = [
  ['White', '#F9FFFE'], ['Light grey', '#9D9D97'], ['Grey', '#474F52'], ['Black', '#1D1D21'],
  ['Brown', '#835432'], ['Red', '#B02E26'], ['Orange', '#F9801D'], ['Yellow', '#FED83D'],
  ['Lime', '#80C71F'], ['Green', '#5E7C16'], ['Cyan', '#169C9C'], ['Light blue', '#3AB3DA'],
  ['Blue', '#3C44AA'], ['Purple', '#8932B8'], ['Magenta', '#C74EBD'], ['Pink', '#F38BAA'],
];
