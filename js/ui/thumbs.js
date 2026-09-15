/* ============================================================================
   Thumbnails — the little renders on cards and tiles.

   One WebGL context for all of them, kept for the life of the tab and pointed
   at whatever needs drawing, exactly as Frame & Groove does for its mob
   cards: contexts are scarce, and a browser starts dropping the oldest after
   a dozen or so, so a tile must never make its own.

   Items are shown on a plain grey mannequin, so their colours are the only
   colours in the picture. Anything that lives only on the head is drawn with
   the head alone, filling the tile, rather than as a speck on a whole body.
   ========================================================================= */

import { createViewer } from '../model/render3d.js';
import { playerModel, ATLAS } from '../model/models.js';
import { atlas, composeSkin, composeCape } from '../skin/compose.js';
import { layout, SKIN } from '../skin/layout.js';

let gl = null, glCanvas = null, glFailed = false;

const models = new Map();
function modelFor(slim, focus) {
  const key = `${slim}|${focus}`;
  if (!models.has(key)) {
    const m = playerModel(slim);
    if (focus === 'head') m.parts = { head: m.parts.head, hat: m.parts.hat };
    models.set(key, m);
  }
  return models.get(key);
}

const VIEW = {
  front: { yaw: Math.PI - 0.42, pitch: -0.2, zoom: 0.93 },
  back:  { yaw: 0.42, pitch: -0.2, zoom: 0.93 },
  card:  { yaw: Math.PI - 0.42, pitch: -0.16, zoom: 1.08 },
  head:  { yaw: Math.PI - 0.55, pitch: -0.3, zoom: 0.9 },
  headBack: { yaw: 0.6, pitch: -0.3, zoom: 0.9 },
};

/**
 * Draw a skin (and cape) and hand back a canvas of its own.
 * @returns {HTMLCanvasElement|null} null where WebGL is unavailable
 */
export function renderScene({ skin, cape = null, slim = false, focus = 'body', view = 'front', px = 160 }) {
  if (glFailed) return null;
  try {
    if (!gl) {
      glCanvas = document.createElement('canvas');
      gl = createViewer(glCanvas, { model: playerModel(false), keepBuffer: true });
      if (!gl) { glFailed = true; return null; }
    }
    gl.setModel(modelFor(slim, focus));
    gl.setTexture(atlas(skin, cape));
    gl.setHidden(cape ? [] : ['cape']);
    const v = focus === 'head' ? (view === 'back' ? VIEW.headBack : VIEW.head) : VIEW[view] || VIEW.front;
    gl.setView(v);
    const src = gl.renderAt(px, px);
    const out = document.createElement('canvas');
    out.width = px; out.height = px;
    out.getContext('2d').drawImage(src, 0, 0);
    return out;
  } catch (e) {
    console.warn('thumbnail failed', e);
    gl = null;
    return null;
  }
}

/* ---- The mannequin ------------------------------------------------------- */
const ghosts = new Map();
export function ghostSkin(model = 'classic') {
  if (!ghosts.has(model)) {
    const img = new ImageData(SKIN, SKIN);
    const { regions } = layout(model);
    for (const r of regions) {
      if (r.layer !== 'inner') continue;
      const c = r.part === 'head' ? [132, 141, 150] : [112, 121, 130];
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * SKIN + x) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      }
    }
    ghosts.set(model, img);
  }
  return ghosts.get(model);
}

/** True when everything in a layer is on the head. */
export function headOnly(layer) {
  for (let i = 16 * SKIN; i < layer.alpha.length; i++) if (layer.alpha[i]) return false;
  return true;
}

/* Tiles are rebuilt often; their pictures are not. */
const urlCache = new Map();
function cachedURL(key, make) {
  if (urlCache.has(key)) return urlCache.get(key);
  // Every edit makes new keys; now and then the old pictures are let go.
  if (urlCache.size > 400) urlCache.clear();
  const c = make();
  const url = c ? c.toDataURL('image/png') : null;
  urlCache.set(key, url);
  return url;
}
export const forgetThumbs = prefix => { for (const k of urlCache.keys()) if (!prefix || k.startsWith(prefix)) urlCache.delete(k); };

/** An item on the mannequin, as a data URL. */
export function itemThumbURL(key, layer, { slim = false, view = 'front', tints = {}, px = 128 } = {}) {
  const model = slim ? 'slim' : 'classic';
  return cachedURL(`item:${key}|${model}|${JSON.stringify(tints)}|${px}`, () => renderScene({
    skin: composeSkin(ghostSkin(model), model, [{ layer, tints, hideUnder: false }]),
    slim, focus: headOnly(layer) ? 'head' : 'body', view, px,
  }));
}

/** A few items worn together on the mannequin — a look. */
export function lookThumbURL(key, pieces, { slim = false, px = 128 } = {}) {
  const model = slim ? 'slim' : 'classic';
  return cachedURL(`look:${key}|${model}|${px}`, () => renderScene({
    skin: composeSkin(ghostSkin(model), model, pieces.map(p => ({ layer: p.layer, tints: p.tints || {}, hideUnder: false }))),
    slim, view: 'card', px,
  }));
}

/** A cape on the mannequin, from behind. */
export function capeThumbURL(key, layer, { tints = {}, px = 128 } = {}) {
  return cachedURL(`cape:${key}|${JSON.stringify(tints)}|${px}`, () => renderScene({
    skin: ghostSkin('classic'), cape: composeCape(layer, tints), view: 'back', px,
  }));
}

/* ---- Flat pictures, no WebGL needed ------------------------------------- */
export function flatCanvas(img, scale = 4) {
  const c = document.createElement('canvas');
  c.width = img.width * scale; c.height = img.height * scale;
  const s = document.createElement('canvas');
  s.width = img.width; s.height = img.height;
  s.getContext('2d').putImageData(img, 0, 0);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(s, 0, 0, c.width, c.height);
  return c;
}

/** The face, hat layer and all — for base avatars where 3D is overkill. */
export function faceCanvas(img, scale = 4) {
  const c = document.createElement('canvas');
  c.width = 8 * scale; c.height = 8 * scale;
  const s = document.createElement('canvas');
  s.width = SKIN; s.height = SKIN;
  s.getContext('2d').putImageData(img, 0, 0);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(s, 8, 8, 8, 8, 0, 0, c.width, c.height);
  g.drawImage(s, 40, 8, 8, 8, 0, 0, c.width, c.height);
  return c;
}

export { ATLAS };
