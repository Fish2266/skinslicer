/* ============================================================================
   The mark.

   Drawn on a 16×16 grid like its two siblings' marks, because an app that
   lives next to Frame & Groove should not wear a vector logo. It is a tunic —
   the one piece of clothing every Minecraft player has held — in the amber
   the landing page gives this tool, with a small fish on the chest.

   Computed rather than hand-plotted so it stays exact at any size, and every
   size is an integer multiple of 16 so the pixels never blur.
   ========================================================================= */

import { overrideArt, blitArt } from './pixelart-overrides.js';

const G = 16;

const PAL = {
  outline: '#2E1E0C',
  darker:  '#8C5B0E',
  dark:    '#B87A15',
  base:    '#DE9820',
  light:   '#F2B33D',
  lighter: '#F7CE7C',
  neck:    '#5A3A12',
  fish:    '#9BEDF1',
  fishDark:'#2BBAC2',
};

/* The silhouette, as filled cells, before the outline is traced round it. */
function tunicCells() {
  const on = new Set();
  const fill = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) on.add(`${x},${y}`); };
  fill(4, 3, 11, 14);            // body
  fill(1, 3, 3, 8);              // right sleeve
  fill(12, 3, 14, 8);            // left sleeve
  fill(2, 2, 5, 2);              // shoulders
  fill(10, 2, 13, 2);
  on.delete('7,3'); on.delete('8,3');   // the neck
  return on;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} size px; rounded down to a multiple of 16
 */
export function drawMark(canvas, size = 64) {
  const scale = Math.max(1, Math.floor(size / G));
  const px = G * scale;
  canvas.width = px; canvas.height = px;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, px, px);
  /* A hand-drawn version from the icon studio wins over the code. */
  const hand = overrideArt('mark');
  if (hand) { blitArt(g, hand, scale); return; }
  const set = (x, y, c) => { g.fillStyle = c; g.fillRect(x * scale, y * scale, scale, scale); };

  const cells = tunicCells();
  const has = (x, y) => cells.has(`${x},${y}`);

  /* ---- Cloth, lit from the upper left ----------------------------------- */
  for (const k of cells) {
    const [x, y] = k.split(',').map(Number);
    let c = PAL.base;
    if (!has(x - 1, y) || !has(x, y - 1)) c = PAL.light;
    if (!has(x + 1, y) || !has(x, y + 1)) c = PAL.dark;
    set(x, y, c);
  }
  // Cuffs and hem, a shade down, so it reads as a garment and not a sign.
  for (let x = 1; x <= 3; x++) set(x, 8, PAL.darker);
  for (let x = 12; x <= 14; x++) set(x, 8, PAL.darker);
  for (let x = 4; x <= 11; x++) set(x, 14, PAL.darker);
  set(4, 3, PAL.lighter); set(2, 2, PAL.lighter); set(3, 2, PAL.lighter);
  set(7, 3, PAL.neck); set(8, 3, PAL.neck);

  /* ---- Outline: every empty cell that touches the cloth ----------------- */
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    if (has(x, y) || (y === 3 && (x === 7 || x === 8))) continue;
    if (has(x - 1, y) || has(x + 1, y) || has(x, y - 1) || has(x, y + 1)) set(x, y, PAL.outline);
  }

  /* ---- The fish on the chest -------------------------------------------- */
  for (const [x, y] of [[7, 6], [8, 6], [6, 7], [7, 7], [8, 7], [9, 7], [7, 8], [8, 8], [10, 6], [10, 8]]) set(x, y, PAL.fish);
  set(9, 7, PAL.fishDark);
  set(6, 7, PAL.outline);        // its eye

  return canvas;
}

export function markCanvas(size = 64) {
  const c = document.createElement('canvas');
  c.style.width = size + 'px';
  c.style.height = size + 'px';
  drawMark(c, size * Math.min(2, window.devicePixelRatio || 1));
  return c;
}

export function markDataURL(size = 64) {
  const c = document.createElement('canvas');
  drawMark(c, size);
  return c.toDataURL('image/png');
}

export function installFavicon() {
  for (const link of document.querySelectorAll('link[rel~="icon"]')) link.remove();
  for (const size of [32, 64, 128]) {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.sizes = `${size}x${size}`;
    link.href = markDataURL(size);
    document.head.appendChild(link);
  }
  const apple = document.createElement('link');
  apple.rel = 'apple-touch-icon';
  apple.href = markDataURL(160);
  document.head.appendChild(apple);
}
