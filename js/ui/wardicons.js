/* ============================================================================
   Pixel icons for the wardrobe's own places and categories.

   ui/pixicons.js is a straight copy from Frame & Groove and keeps the chest
   and the export tray the rail shares with it. These are the ones only a
   wardrobe needs — a tunic, a brush, and one per shelf — drawn the same way:
   a 16×16 grid, shown at a whole multiple, with the outline traced
   automatically round whatever was filled so every icon has the same edge.
   ========================================================================= */

import { overrideArt, blitArt } from './pixelart-overrides.js';

const G = 16;

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)))));
  return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

function grid() {
  const cells = new Map();
  return {
    cells,
    px: (x, y, c) => { if (x >= 0 && y >= 0 && x < G && y < G) cells.set(`${x},${y}`, c); },
    rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.px(x, y, c); },
    clear: (x, y) => cells.delete(`${x},${y}`),
  };
}

/* Each icon fills cells with 'a' (the accent), 'A' (its light), 'd' (its
   dark), 'w' (near-white), 'm' (grey) or a literal colour. */
const ICONS = {
  tunic(d) {
    d.rect(4, 3, 11, 14, 'a'); d.rect(1, 3, 3, 8, 'a'); d.rect(12, 3, 14, 8, 'a');
    d.rect(2, 2, 5, 2, 'A'); d.rect(10, 2, 13, 2, 'A');
    d.clear(7, 3); d.clear(8, 3);
    d.rect(1, 8, 3, 8, 'd'); d.rect(12, 8, 14, 8, 'd'); d.rect(4, 14, 11, 14, 'd');
    d.rect(4, 4, 4, 13, 'A');
  },
  brush(d) {
    for (let i = 0; i < 7; i++) { d.px(13 - i, 2 + i, 'O'); d.px(12 - i, 2 + i, 'o'); }
    d.rect(5, 8, 7, 10, 'm'); d.px(6, 8, 'w');
    d.rect(2, 11, 5, 12, 'a'); d.rect(1, 13, 3, 14, 'a'); d.px(2, 11, 'A'); d.px(1, 13, 'A'); d.px(3, 14, 'd');
  },
  hats(d) {
    d.rect(4, 5, 11, 10, 'a'); d.rect(5, 4, 10, 4, 'a'); d.rect(3, 7, 3, 10, 'a'); d.rect(12, 7, 12, 10, 'a');
    d.rect(3, 11, 12, 12, 'w'); d.rect(7, 2, 8, 3, 'w');
    for (let x = 4; x <= 11; x += 2) d.rect(x, 6, x, 10, 'd');
    d.rect(5, 5, 6, 5, 'A');
  },
  tops(d) {
    d.rect(4, 4, 11, 13, 'a'); d.rect(1, 4, 3, 7, 'a'); d.rect(12, 4, 14, 7, 'a');
    d.rect(2, 3, 5, 3, 'A'); d.rect(10, 3, 13, 3, 'A'); d.clear(7, 4); d.clear(8, 4);
    d.rect(1, 7, 3, 7, 'd'); d.rect(12, 7, 14, 7, 'd'); d.rect(4, 13, 11, 13, 'd');
  },
  bottoms(d) {
    d.rect(4, 2, 11, 4, 'a'); d.rect(4, 5, 7, 13, 'a'); d.rect(8, 5, 11, 13, 'a');
    d.clear(7, 7); d.clear(8, 7); for (let y = 7; y <= 13; y++) { d.clear(7, y); d.clear(8, y); }
    d.rect(4, 2, 11, 2, 'm'); d.px(7, 2, 'w'); d.px(8, 2, 'w');
    d.rect(4, 13, 7, 13, 'd'); d.rect(8, 13, 11, 13, 'd');
  },
  shoes(d) {
    d.rect(5, 3, 9, 10, 'a'); d.rect(3, 9, 12, 11, 'a'); d.rect(3, 12, 12, 12, 'm');
    d.rect(5, 3, 9, 3, 'A'); d.px(7, 5, 'w'); d.px(7, 7, 'w'); d.rect(3, 11, 12, 11, 'd');
  },
  extras(d) {
    d.rect(1, 6, 6, 9, 'k'); d.rect(9, 6, 14, 9, 'k'); d.rect(7, 6, 8, 6, 'k');
    d.rect(2, 7, 5, 8, 'a'); d.rect(10, 7, 13, 8, 'a'); d.px(2, 7, 'w'); d.px(10, 7, 'w');
  },
  looks(d) {
    // A whole outfit, top to toe: the shirt, the trousers, the shoes.
    d.rect(4, 1, 11, 6, 'a'); d.rect(2, 1, 3, 4, 'a'); d.rect(12, 1, 13, 4, 'a');
    d.clear(7, 1); d.clear(8, 1); d.rect(4, 2, 4, 6, 'A');
    d.rect(4, 7, 11, 7, 'm');
    d.rect(4, 8, 7, 12, 'd'); d.rect(8, 8, 11, 12, 'd'); d.clear(7, 10); d.clear(8, 10); d.clear(7, 11); d.clear(8, 11); d.clear(7, 12); d.clear(8, 12);
    d.rect(3, 13, 6, 14, 'w'); d.rect(9, 13, 12, 14, 'w');
  },
  capes(d) {
    d.rect(4, 2, 11, 3, 'd');
    d.rect(4, 4, 11, 13, 'a'); d.rect(3, 7, 3, 13, 'a'); d.rect(12, 7, 12, 13, 'a');
    d.rect(4, 4, 4, 13, 'A'); d.rect(3, 13, 12, 13, 'd');
    d.px(7, 7, 'w'); d.px(8, 7, 'w'); d.px(7, 8, 'w'); d.px(8, 8, 'w');
  },
  yours(d) {
    const star = [[7, 1], [8, 1], [7, 2], [8, 2], [6, 3], [9, 3], [6, 4], [9, 4], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [10, 5], [11, 5], [12, 5], [13, 5], [14, 5]];
    for (let y = 3; y <= 13; y++) for (let x = 1; x <= 14; x++) {
      const cx = x - 7.5, cy = y - 7.5;
      const a = Math.atan2(cy, cx), r = Math.hypot(cx, cy);
      const k = 0.5 + 0.5 * Math.cos(5 * (a + Math.PI / 2));
      if (r < 2.6 + 4.4 * k) d.px(x, y, 'a');
    }
    for (const [x, y] of star) d.px(x, y, 'a');
    d.px(6, 5, 'A'); d.px(7, 4, 'A'); d.px(7, 6, 'w');
  },
};

export const WARDICON_NAMES = Object.keys(ICONS);

/**
 * @param {string} name
 * @param {number} scale integer pixels per cell
 * @param {object} o { accent }
 */
export function wardIcon(name, scale = 2, { accent = '#DE9820' } = {}) {
  const c = document.createElement('canvas');
  c.width = G * scale; c.height = G * scale;
  c.style.width = (G * scale) + 'px';
  c.style.height = (G * scale) + 'px';
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  /* A hand-drawn version from the icon studio wins over the code. It carries
     its own colours, so the accent no longer applies. */
  const hand = overrideArt(`icon:${name}`);
  if (hand) { blitArt(g, hand, scale); return c; }
  const d = grid();
  ICONS[name]?.(d);
  const P = {
    a: accent, A: shade(accent, 0.4), d: shade(accent, -0.35),
    w: '#E8ECF0', m: '#5A646F', k: '#12151A', o: '#8A6A3C', O: '#B99A62',
  };
  const set = (x, y, col) => { g.fillStyle = col; g.fillRect(x * scale, y * scale, scale, scale); };
  // The outline goes in first, round every filled cell, then the fill over it.
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    if (d.cells.has(`${x},${y}`)) continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => d.cells.has(`${x + dx},${y + dy}`));
    if (near) set(x, y, '#12151A');
  }
  for (const [k, col] of d.cells) {
    const [x, y] = k.split(',').map(Number);
    set(x, y, P[col] || col);
  }
  return c;
}
