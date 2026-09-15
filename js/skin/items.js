/* ============================================================================
   The preset wardrobe.

   Every item is drawn in code onto the skin sheet, in named colour groups
   ("slots"), so tinting it is exact: the beanie's knit, its fold and its pom
   are three groups because they were drawn as three, not because a
   clustering guessed so.

   An item is drawn per arm width — a slim skin's sleeve is three pixels wide,
   not a classic sleeve with a column sliced off — which is why items are
   painters rather than pictures.

   Everything a skin can show is on the sheet, so nothing here can stick out
   past the outer layer: a cap has a brim drawn on, not a brim. That is the
   format, not a shortcut — it is what makes the result a skin the game reads.
   ========================================================================= */

import { box, faceRect, SKIN } from './layout.js';
import { layerFromSlots, layerFromGroups } from './tint.js';
import { ITEM_OVERRIDES, itemSheet } from './items-overrides.js';

export const CATEGORIES = [
  { id: 'hats', label: 'Hats' },
  { id: 'tops', label: 'Tops' },
  { id: 'bottoms', label: 'Bottoms' },
  { id: 'shoes', label: 'Shoes' },
  { id: 'extras', label: 'Extras' },
];

/* ---- The painter -----------------------------------------------------------
   A callback returns what goes in a pixel: nothing, a slot number, or
   [slot, shade, alpha]. Shade is lightness steps from the slot's colour. */
function painter(model) {
  const n = SKIN * SKIN;
  const slot = new Int8Array(n).fill(-1);
  const shade = new Float32Array(n);
  const alpha = new Uint8Array(n);

  const put = (x, y, v) => {
    if (v == null || v === false || x < 0 || y < 0 || x >= SKIN || y >= SKIN) return;
    const [s, sh = 0, a = 255] = Array.isArray(v) ? v : [v];
    const i = y * SKIN + x;
    slot[i] = s; shade[i] = sh; alpha[i] = a;
  };

  /** Paint whole faces, in face-local coordinates. */
  const each = (parts, layer, faces, fn) => {
    for (const part of [].concat(parts)) {
      const b = box(part, layer, model);
      for (const face of [].concat(faces)) {
        const r = faceRect(b, face);
        for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) put(r.x + x, r.y + y, fn(x, y, { w: r.w, h: r.h, face, part }));
      }
    }
  };

  /**
   * Paint the four sides as one continuous band — right, front, left, back —
   * which is exactly how the sheet stores them, so a stripe drawn on row y
   * runs all the way round the part.
   */
  const band = (parts, layer, fn) => {
    for (const part of [].concat(parts)) {
      const b = box(part, layer, model);
      const W = 2 * (b.w + b.d);
      for (let y = 0; y < b.h; y++) for (let x = 0; x < W; x++) {
        let face, fx, fw;
        if (x < b.d) { face = 'right'; fx = x; fw = b.d; }
        else if (x < b.d + b.w) { face = 'front'; fx = x - b.d; fw = b.w; }
        else if (x < 2 * b.d + b.w) { face = 'left'; fx = x - b.d - b.w; fw = b.d; }
        else { face = 'back'; fx = x - 2 * b.d - b.w; fw = b.w; }
        put(b.u + x, b.v + b.d + y, fn(x, y, { face, fx, fw, h: b.h, part }));
      }
    }
  };

  /** Stable per-pixel noise, for knit and denim and cloth. */
  const noise = (x, y, seed = 1) => {
    let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 7, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (((h ^ (h >>> 16)) >>> 0) / 4294967295) - 0.5;
  };

  return {
    model, slim: model === 'slim', put, each, band, noise,
    finish: slots => layerFromSlots({ w: SKIN, h: SKIN, slot, shade, alpha, slots }),
  };
}

const ARMS = ['armR', 'armL'];
const LEGS = ['legR', 'legL'];
const between = (v, a, b) => v >= a && v <= b;

/* ========================================================================= */
/* THE CATALOGUE                                                             */
/* ========================================================================= */

export const DRAWN_PRESETS = [
  /* ---- Hats ------------------------------------------------------------- */
  {
    id: 'beanie', name: 'Beanie', cat: 'hats',
    slots: [{ name: 'Knit', color: '#C7372F' }, { name: 'Fold', color: '#E9E4DA' }, { name: 'Pom', color: '#E9E4DA' }],
    paint(p) {
      p.each('head', 'outer', 'top', (x, y) =>
        between(x, 3, 4) && between(y, 3, 4) ? [2, x === 3 && y === 3 ? 1.2 : 0.4] : [0, (x + y) % 2 ? -0.4 : 0.25]);
      p.band('head', 'outer', (x, y) =>
        y <= 2 ? [0, (x % 2 ? -0.45 : 0.25) + (y === 2 ? -0.5 : 0)]
        : y === 3 ? [1, x % 2 ? -0.4 : 0.3] : null);
    },
  },
  {
    id: 'cap', name: 'Baseball cap', cat: 'hats',
    slots: [{ name: 'Crown', color: '#2F5FB3' }, { name: 'Brim', color: '#1F3F7A' }, { name: 'Badge', color: '#F2C94C' }],
    paint(p) {
      p.each('head', 'outer', 'top', (x, y) =>
        between(x, 3, 4) && between(y, 3, 4) ? [0, -0.9] : [0, x === 3 || x === 4 ? -0.35 : 0.2]);
      p.band('head', 'outer', (x, y, { face, fx }) => {
        if (face === 'front' && y <= 1 && between(fx, 3, 4)) return [2, y === 0 ? 0.5 : -0.2];
        if (y <= 1) return [0, y === 0 ? 0.3 : 0];
        if (y === 2) {
          if (face === 'front') return [1, 0.6];
          if ((face === 'right' && fx >= 5) || (face === 'left' && fx <= 2)) return [1, 0.2];
          if (face === 'back' && between(fx, 3, 4)) return null;   // the strap gap
          return [0, -0.5];
        }
        if (y === 3 && face === 'front') return [1, -0.6];
        return null;
      });
    },
  },
  {
    id: 'crown', name: 'Crown', cat: 'hats',
    slots: [{ name: 'Gold', color: '#E7B53A' }, { name: 'Rubies', color: '#C0283A' }, { name: 'Sapphires', color: '#3F7FD8' }],
    paint(p) {
      p.band('head', 'outer', (x, y, { face, fx }) => {
        if (y === 0) return fx % 2 === 0 ? [0, 0.8] : null;
        if (y > 2) return null;
        if (between(fx, 3, 4)) {
          if (face === 'front' || face === 'back') return [1, y === 1 ? 0.7 : -0.2];
          return [2, y === 1 ? 0.7 : -0.2];
        }
        return [0, y === 1 ? 0.5 : -0.4];
      });
    },
  },
  {
    id: 'headband', name: 'Sweatband', cat: 'hats',
    slots: [{ name: 'Band', color: '#EDE8DE' }, { name: 'Stripe', color: '#D2453A' }],
    paint(p) {
      p.band('head', 'outer', (x, y) =>
        y === 1 || y === 3 ? [0, x % 2 ? -0.25 : 0.2] : y === 2 ? [1, 0] : null);
    },
  },
  {
    id: 'headphones', name: 'Headphones', cat: 'hats',
    slots: [{ name: 'Band', color: '#2B2D33' }, { name: 'Cups', color: '#D84A3A' }, { name: 'Grille', color: '#8A8F98' }],
    paint(p) {
      p.each('head', 'outer', 'top', x => (between(x, 3, 4) ? [0, x === 3 ? 0.4 : -0.1] : null));
      p.band('head', 'outer', (x, y, { face, fx }) => {
        if (face !== 'right' && face !== 'left') return null;
        if (y <= 2) return between(fx, 3, 4) ? [0, 0] : null;
        if (!between(y, 3, 6) || !between(fx, 2, 5)) return null;
        const corner = (fx === 2 || fx === 5) && (y === 3 || y === 6);
        if (corner) return null;
        if (between(fx, 3, 4) && between(y, 4, 5)) return [2, y === 4 ? 0.3 : -0.3];
        return [1, y === 3 ? 0.6 : y === 6 ? -0.6 : 0];
      });
    },
  },
  {
    id: 'bandana', name: 'Bandana', cat: 'hats',
    slots: [{ name: 'Cloth', color: '#B8332B' }, { name: 'Dots', color: '#F3EDE2' }],
    paint(p) {
      const dot = (x, y) => (x * 3 + y * 5) % 7 === 0;
      p.each('head', 'outer', 'top', (x, y) => (dot(x, y) ? [1, 0] : [0, 0.15]));
      p.band('head', 'outer', (x, y, { face, fx }) => {
        if (y <= 2) return dot(x, y) ? [1, y === 2 ? -0.3 : 0] : [0, y === 2 ? -0.4 : 0];
        if (face === 'back' && between(y, 3, 4) && between(fx, 3, 4)) return [0, -0.5];
        if (face === 'back' && y === 5 && (fx === 2 || fx === 5)) return [0, -0.7];
        return null;
      });
    },
  },

  /* ---- Tops ------------------------------------------------------------- */
  {
    id: 'tee', name: 'T-shirt', cat: 'tops',
    slots: [{ name: 'Shirt', color: '#3E7CC4' }, { name: 'Collar', color: '#2A5A94' }],
    paint(p) {
      p.band('body', 'inner', (x, y, { face, fx }) => {
        if (face === 'front' && y === 0 && between(fx, 2, 5)) return [1, 0];
        if (face === 'front' && y === 1 && between(fx, 3, 4)) return [1, -0.3];
        return [0, y === 11 ? -0.5 : 0];
      });
      p.each('body', 'inner', 'top', () => [0, 0.2]);
      p.each('body', 'inner', 'bottom', () => [0, -0.4]);
      p.band(ARMS, 'inner', (x, y) => (y <= 3 ? [0, y === 3 ? -0.5 : 0] : null));
      p.each(ARMS, 'inner', 'top', () => [0, 0.2]);
    },
  },
  {
    id: 'stripes', name: 'Striped tee', cat: 'tops',
    slots: [{ name: 'Stripe', color: '#EDE6D8' }, { name: 'Second stripe', color: '#D2453A' }],
    paint(p) {
      const s = y => Math.floor(y / 2) % 2;
      p.band('body', 'inner', (x, y) => [s(y), 0]);
      p.each('body', 'inner', 'top', () => [0, 0.2]);
      p.each('body', 'inner', 'bottom', () => [1, -0.4]);
      p.band(ARMS, 'inner', (x, y) => (y <= 3 ? [s(y), y === 3 ? -0.4 : 0] : null));
      p.each(ARMS, 'inner', 'top', () => [0, 0.2]);
    },
  },
  {
    id: 'hoodie', name: 'Hoodie', cat: 'tops',
    slots: [{ name: 'Fleece', color: '#6E7F8E' }, { name: 'Pocket', color: '#5B6B79' }, { name: 'Strings', color: '#EDE6D8' }],
    paint(p) {
      p.band('body', 'outer', (x, y, { face, fx }) => {
        if (face === 'front') {
          if (y === 0 && between(fx, 2, 5)) return [0, -0.9];
          if (between(y, 1, 4) && (fx === 2 || fx === 5)) return [2, y === 4 ? -0.5 : 0.2];
          if (between(y, 7, 10) && between(fx, 1, 6)) return [1, y === 7 ? 0.3 : 0];
        }
        if (y === 11) return [0, x % 2 ? -0.7 : -0.4];
        return [0, p.noise(x, y, 3) * 0.4];
      });
      p.each('body', 'outer', 'top', (x, y) => [0, 0.2 + p.noise(x, y, 4) * 0.3]);
      p.band(ARMS, 'outer', (x, y) => (y >= 10 ? [0, x % 2 ? -0.6 : -0.3] : [0, p.noise(x, y, 5) * 0.4]));
      p.each(ARMS, 'outer', 'top', () => [0, 0.2]);
      // The hood, down, bunched at the back of the neck.
      p.band('head', 'outer', (x, y, { face, fx }) => {
        if (y < 5) return null;
        if (face === 'back') return [0, y === 5 ? 0.3 : -0.2];
        if ((face === 'right' && fx <= 3) || (face === 'left' && fx >= 4)) return [0, y === 5 ? 0.2 : -0.3];
        return null;
      });
    },
    view: 'back',
  },
  {
    id: 'denim', name: 'Denim jacket', cat: 'tops',
    slots: [{ name: 'Denim', color: '#4A6FA5' }, { name: 'Stitching', color: '#D9893B' }, { name: 'Buttons', color: '#C9CED6' }],
    paint(p) {
      p.band('body', 'outer', (x, y, { face, fx }) => {
        if (face === 'front') {
          if (between(fx, 3, 4)) return null;                     // worn open
          if (y === 0 && (fx === 2 || fx === 5)) return [0, 0.7];  // collar
          if ((fx === 2 || fx === 5) && (y === 3 || y === 6)) return [2, 0.4];
          if (y === 4 && (fx <= 1 || fx >= 6)) return [1, 0];      // pocket flaps
        }
        if (y === 8) return [1, 0];
        if (y === 11) return [0, -0.5];
        return [0, p.noise(x, y, 6) * 0.35];
      });
      p.each('body', 'outer', 'top', () => [0, 0.25]);
      p.band(ARMS, 'outer', (x, y) => (y === 10 ? [1, 0] : y === 11 ? [0, -0.5] : [0, p.noise(x, y, 7) * 0.35]));
      p.each(ARMS, 'outer', 'top', () => [0, 0.25]);
    },
  },
  {
    id: 'suit', name: 'Suit jacket', cat: 'tops',
    slots: [{ name: 'Jacket', color: '#2B2F3A' }, { name: 'Shirt', color: '#F2F0EA' }, { name: 'Tie', color: '#B23A3A' }],
    paint(p) {
      p.band('body', 'inner', (x, y, { face, fx }) => {
        if (face === 'front') {
          if (between(fx, 3, 4) && between(y, 1, 7)) return [2, y === 1 ? 0.5 : y === 7 ? -0.6 : 0];
          if ((y <= 1 && between(fx, 2, 5)) || (between(y, 2, 5) && between(fx, 3, 4))) return [1, 0];
          if ((fx === 2 || fx === 5) && between(y, 2, 5)) return [0, 0.6];   // lapels
        }
        return [0, y === 11 ? -0.4 : 0];
      });
      p.each('body', 'inner', 'top', () => [0, 0.2]);
      p.each('body', 'inner', 'bottom', () => [0, -0.4]);
      p.band(ARMS, 'inner', (x, y) => (y <= 9 ? [0, 0] : y === 10 ? [1, 0] : null));
      p.each(ARMS, 'inner', 'top', () => [0, 0.2]);
    },
  },
  {
    id: 'sweater', name: 'Holiday sweater', cat: 'tops',
    slots: [{ name: 'Wool', color: '#2E7D4F' }, { name: 'Pattern', color: '#EDE8DE' }, { name: 'Accent', color: '#C23A33' }],
    paint(p) {
      p.band('body', 'inner', (x, y, { face, fx }) => {
        if (y === 3 || y === 5) return [x % 2 === 0 ? 1 : 0, 0];
        if (y === 4) return [x % 4 < 2 ? 2 : 1, 0];
        if (face === 'front' && y === 0 && between(fx, 2, 5)) return [0, -0.6];
        if (y === 11) return [0, x % 2 ? -0.6 : -0.3];
        return [0, 0];
      });
      p.each('body', 'inner', 'top', () => [0, 0.2]);
      p.each('body', 'inner', 'bottom', () => [0, -0.4]);
      p.band(ARMS, 'inner', (x, y) => {
        if (y === 4) return [x % 2 === 0 ? 1 : 0, 0];
        if (y === 5) return [x % 2 ? 2 : 0, 0];
        if (y === 10) return [0, x % 2 ? -0.6 : -0.3];
        return y < 10 ? [0, 0] : null;
      });
      p.each(ARMS, 'inner', 'top', () => [0, 0.2]);
    },
  },
  {
    id: 'tank', name: 'Tank top', cat: 'tops',
    slots: [{ name: 'Tank', color: '#E8E3D6' }, { name: 'Trim', color: '#C94B3A' }],
    paint(p) {
      p.band('body', 'inner', (x, y, { face, fx }) => {
        if ((face === 'front' || face === 'back') && y === 0 && between(fx, 2, 5)) return [1, 0];
        if (y === 11) return [1, -0.2];
        return [0, 0];
      });
      p.each('body', 'inner', 'top', () => [0, 0.2]);
      p.each('body', 'inner', 'bottom', () => [0, -0.4]);
    },
  },

  /* ---- Bottoms ---------------------------------------------------------- */
  {
    id: 'jeans', name: 'Jeans', cat: 'bottoms',
    slots: [{ name: 'Denim', color: '#3D5A8A' }, { name: 'Belt', color: '#5A3A22' }, { name: 'Buckle', color: '#D9B24A' }],
    paint(p) {
      p.band(LEGS, 'inner', (x, y, { face }) =>
        y === 11 ? [0, 0.5] : [0, p.noise(x, y, 8) * 0.3 + (face === 'front' && between(y, 5, 6) ? 0.3 : 0)]);
      p.band('body', 'inner', (x, y, { face, fx }) =>
        y !== 11 ? null : face === 'front' && between(fx, 3, 4) ? [2, fx === 3 ? 0.5 : 0] : [1, 0]);
    },
  },
  {
    id: 'shorts', name: 'Shorts', cat: 'bottoms',
    slots: [{ name: 'Shorts', color: '#C9A46A' }, { name: 'Belt', color: '#3F3A36' }],
    paint(p) {
      p.band(LEGS, 'inner', (x, y) => (y <= 5 ? [0, y === 5 ? -0.5 : p.noise(x, y, 9) * 0.25] : null));
      p.band('body', 'inner', (x, y) => (y === 11 ? [1, 0] : null));
    },
  },
  {
    id: 'skirt', name: 'Pleated skirt', cat: 'bottoms',
    slots: [{ name: 'Skirt', color: '#8C3B8F' }, { name: 'Hem', color: '#E2C35A' }],
    paint(p) {
      p.band(LEGS, 'outer', (x, y) => (y <= 6 ? (y === 6 ? [1, 0] : [0, x % 2 ? -0.4 : 0.2]) : null));
      p.band('body', 'outer', (x, y) => (y === 11 ? [0, 0.3] : null));
    },
  },
  {
    id: 'trackpants', name: 'Track pants', cat: 'bottoms',
    slots: [{ name: 'Pants', color: '#1E2227' }, { name: 'Stripe', color: '#EDEDED' }],
    paint(p) {
      p.band(LEGS, 'inner', (x, y, { face, fx, part }) => {
        const outer = (part === 'legR' && face === 'right') || (part === 'legL' && face === 'left');
        if (outer && between(fx, 1, 2)) return [1, 0];
        return [0, y === 11 ? -0.5 : 0];
      });
    },
  },

  /* ---- Shoes ------------------------------------------------------------ */
  {
    id: 'sneakers', name: 'Sneakers', cat: 'shoes',
    slots: [{ name: 'Upper', color: '#EFEFEF' }, { name: 'Sole', color: '#9A9A9A' }, { name: 'Flash', color: '#3E7CC4' }],
    paint(p) {
      p.band(LEGS, 'inner', (x, y, { face, fx, part }) => {
        if (y === 11) return [1, 0];
        if (y !== 10) return null;
        const outer = (part === 'legR' && face === 'right') || (part === 'legL' && face === 'left');
        if (outer && between(fx, 1, 2)) return [2, 0];
        if (face === 'front' && between(fx, 1, 2)) return [0, -0.5];
        return [0, 0];
      });
      p.each(LEGS, 'inner', 'bottom', () => [1, -0.3]);
    },
  },
  {
    id: 'boots', name: 'Boots', cat: 'shoes',
    slots: [{ name: 'Leather', color: '#6B4428' }, { name: 'Sole', color: '#2B2420' }, { name: 'Laces', color: '#C9A46A' }],
    paint(p) {
      p.band(LEGS, 'inner', (x, y, { face, fx }) => {
        if (y < 8) return null;
        if (y === 11) return [1, 0];
        if (face === 'front' && between(fx, 1, 2)) return [2, y % 2 ? 0 : -0.3];
        return [0, y === 8 ? 0.3 : 0];
      });
      p.each(LEGS, 'inner', 'bottom', () => [1, -0.3]);
    },
  },

  /* ---- Extras ----------------------------------------------------------- */
  {
    id: 'glasses', name: 'Glasses', cat: 'extras',
    slots: [{ name: 'Frame', color: '#1D1D21' }, { name: 'Lenses', color: '#9BD3E8' }],
    paint(p) {
      p.band('head', 'outer', (x, y, { face, fx }) => {
        if (face === 'front') {
          if (between(y, 4, 5) && (between(fx, 1, 2) || between(fx, 5, 6))) return [1, y === 4 ? 0.5 : 0, 150];
          if (y === 4 && (fx === 0 || fx === 7 || between(fx, 3, 4))) return [0, 0];
          if (y === 3 && (between(fx, 1, 2) || between(fx, 5, 6))) return [0, 0.3];
        }
        if (y === 4 && ((face === 'right' && fx >= 4) || (face === 'left' && fx <= 3))) return [0, 0];
        return null;
      });
    },
  },
  {
    id: 'scarf', name: 'Scarf', cat: 'extras',
    slots: [{ name: 'Wool', color: '#C23A33' }, { name: 'Stripe', color: '#E9E4DA' }],
    paint(p) {
      p.band('body', 'outer', (x, y, { face, fx }) => {
        if (y <= 1) return x % 4 === 0 ? [1, 0] : [0, y === 1 ? -0.2 : 0.2];
        if (face === 'front' && between(fx, 1, 2) && y <= 6) return y === 4 || y === 6 ? [1, y === 6 ? -0.2 : 0] : [0, 0];
        return null;
      });
      p.band('head', 'outer', (x, y) => (y === 7 ? [0, 0.3] : null));
    },
  },
  {
    id: 'backpack', name: 'Backpack', cat: 'extras',
    slots: [{ name: 'Canvas', color: '#7A5230' }, { name: 'Straps', color: '#3F2A18' }, { name: 'Buckles', color: '#D9B24A' }],
    paint(p) {
      p.band('body', 'outer', (x, y, { face, fx }) => {
        if (face === 'back' && between(fx, 1, 6) && between(y, 2, 9)) {
          if (y === 5 && between(fx, 3, 4)) return [2, 0.3];
          if (between(y, 6, 8) && between(fx, 2, 5)) return [0, -0.5];
          return [0, y === 2 ? 0.4 : 0];
        }
        if (face === 'front' && (fx === 1 || fx === 6) && y <= 8) return y === 5 ? [2, 0] : [1, 0];
        return null;
      });
      p.each('body', 'outer', 'top', x => (x === 1 || x === 6 ? [1, 0.2] : null));
    },
    view: 'back',
  },
  {
    id: 'mask', name: 'Face mask', cat: 'extras',
    slots: [{ name: 'Mask', color: '#7FC4D8' }, { name: 'Loops', color: '#EDEDED' }],
    paint(p) {
      p.band('head', 'outer', (x, y, { face }) => {
        if (face === 'front' && between(y, 5, 7)) return [0, y === 5 ? 0.3 : y === 7 ? -0.3 : 0];
        if ((face === 'right' || face === 'left') && y === 5) return [1, 0];
        return null;
      });
    },
  },
  {
    id: 'gloves', name: 'Gloves', cat: 'extras',
    slots: [{ name: 'Glove', color: '#6B4428' }, { name: 'Cuff', color: '#B58A55' }],
    paint(p) {
      p.band(ARMS, 'inner', (x, y) => (y >= 9 ? [y === 9 ? 1 : 0, y === 9 ? 0.2 : 0] : null));
      p.each(ARMS, 'inner', 'bottom', () => [0, -0.3]);
    },
  },
];

/* ---- Hand-drawn items ------------------------------------------------------
   tools/icon-studio.html writes items-overrides.js: an entry there redraws a
   preset, renames it, re-shelves it or leaves it out, or adds an item with no
   drawing in code at all. Its drawing wins over the code's. */
export const ALL_PRESETS = DRAWN_PRESETS.map(d => ({ ...d }));
for (const [id, o] of Object.entries(ITEM_OVERRIDES)) {
  let def = ALL_PRESETS.find(d => d.id === id);
  if (!def) { def = { id, name: id, cat: 'extras' }; ALL_PRESETS.push(def); }
  if (o.name) def.name = o.name;
  if (o.cat) def.cat = o.cat;
  if (o.view) def.view = o.view;
  def.hidden = !!o.hidden;
  def.hand = true;
}

/** The catalogue: every item the wardrobe shows. Left-out ones still resolve, so outfits wearing them keep them. */
export const PRESETS = ALL_PRESETS.filter(d => !d.hidden);

const byId = new Map(ALL_PRESETS.map(p => [p.id, p]));
const drawnById = new Map(DRAWN_PRESETS.map(p => [p.id, p]));
export const presetById = id => byId.get(id) || null;

/** An item as the code draws it, whatever the overrides say — or null if the code has no drawing of it. */
export function drawnLayer(id, model = 'classic') {
  const def = drawnById.get(id);
  if (!def) return null;
  const p = painter(model);
  def.paint(p);
  return p.finish(def.slots);
}

/* A layer per item per arm width, drawn once. */
const layers = new Map();
export function presetLayer(id, model = 'classic') {
  const key = `${id}|${model}`;
  if (!layers.has(key)) {
    const sheet = itemSheet(ITEM_OVERRIDES[id], model);
    layers.set(key, sheet
      ? layerFromGroups({ width: SKIN, height: SKIN, data: sheet.data }, { map: sheet.map, groups: sheet.groups })
      : drawnLayer(id, model));
  }
  return layers.get(key);
}

export { painter };
