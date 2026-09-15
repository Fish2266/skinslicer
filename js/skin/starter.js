/* ============================================================================
   The mannequin — a plain starter skin, drawn here.

   The game's own Steve and Alex are Mojang's art, and this app ships none of
   it. So a first-time base that is not somebody's real skin is drawn in code:
   a face, hair, a grey tee and dark trousers. Plain on purpose — it is a base
   for clothes, not a character.
   ========================================================================= */

import { painter } from './items.js';
import { recolor } from './tint.js';
import { SKIN } from './layout.js';
import { applyNoAlpha } from './image.js';

const SLOTS = [
  { name: 'Skin', color: '#C99577' },
  { name: 'Hair', color: '#4A3222' },
  { name: 'Eye white', color: '#EEF2F4' },
  { name: 'Eyes', color: '#3B5BA5' },
  { name: 'Mouth', color: '#9A5A50' },
  { name: 'Tee', color: '#8E9AA6' },
  { name: 'Trousers', color: '#3C4452' },
  { name: 'Shoes', color: '#2A2A2E' },
];

export function starterSkin(model = 'classic') {
  const p = painter(model);
  const inRange = (v, a, b) => v >= a && v <= b;

  // Head: skin all round, hair on top and down the back.
  p.each('head', 'inner', 'top', () => [1, 0.2]);
  p.each('head', 'inner', 'bottom', () => [0, -0.6]);
  p.band('head', 'inner', (x, y, { face, fx }) => {
    if (y <= 1) return [1, y === 0 ? 0.2 : 0];
    if (face === 'back') return y <= 5 ? [1, -0.2] : [0, -0.3];
    if (face === 'right') return y <= 5 && fx <= 3 ? [1, -0.2] : [0, -0.2];
    if (face === 'left') return y <= 5 && fx >= 4 ? [1, -0.2] : [0, -0.2];
    // The face.
    if (y === 2 && (fx === 0 || fx === 7)) return [1, -0.3];
    if (y === 4 && (fx === 1 || fx === 6)) return [2, 0];
    if (y === 4 && (fx === 2 || fx === 5)) return [3, 0];
    if (y === 6 && inRange(fx, 3, 4)) return [4, 0];
    if (y === 5 && inRange(fx, 3, 4)) return [0, -0.25];
    return [0, 0];
  });

  // Tee with short sleeves; bare forearms.
  p.band('body', 'inner', (x, y) => [5, y === 11 ? -0.4 : 0]);
  p.each('body', 'inner', 'top', () => [5, 0.2]);
  p.each('body', 'inner', 'bottom', () => [5, -0.4]);
  p.band(['armR', 'armL'], 'inner', (x, y) => (y <= 3 ? [5, y === 3 ? -0.4 : 0] : [0, y === 11 ? -0.2 : 0]));
  p.each(['armR', 'armL'], 'inner', 'top', () => [5, 0.2]);
  p.each(['armR', 'armL'], 'inner', 'bottom', () => [0, -0.3]);

  // Trousers and shoes.
  p.band(['legR', 'legL'], 'inner', (x, y) => (y >= 10 ? [7, y === 11 ? -0.3 : 0] : [6, 0]));
  p.each(['legR', 'legL'], 'inner', 'top', () => [6, 0]);
  p.each(['legR', 'legL'], 'inner', 'bottom', () => [7, -0.3]);

  const layer = p.finish(SLOTS);
  return applyNoAlpha(new ImageData(recolor(layer), SKIN, SKIN));
}
