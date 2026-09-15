/* ============================================================================
   Paint — the base skin and the things worn over it, painted on the model.

   The stage's picking pass turns a click into the exact texel under it, so
   the brush lands on the pixel you pointed at whichever way the model is
   turned. The flat sheet beside it is the same document seen the other way:
   paint on either and both change.

   "Painting on" picks what the brush changes: the base, or any one of the
   things the outfit is wearing — so you can paint over the clothes, or paint
   the clothes themselves. A preset becomes your own copy the moment you pick
   it (presets are drawn by the app); a new item starts as an empty sheet.
   Everything else stays visible while you paint, unless you hide it here.

   The base layer of a base is opaque in the game, so there is nothing to
   erase there. Items can be erased anywhere: they only cover what they paint.

   Bases and your items are shared: every outfit on the base, or wearing the
   item, changes too.
   ========================================================================= */

import { h, raw, on } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { clamp, hexToRgba, rgbaToHex, hasMod, rafBatch } from '../../core/util.js';
import {
  state, bus, baseOf, resolveItem, saveBaseSoon, saveItemSoon, itemLayer, flushItemSaves, savePaintPrefs, setRoute,
  outfitChanged, updateOwn, addBlankItem, toggleWear, adoptPreset,
} from '../../core/store.js';
import { atlas, composeSkin } from '../../skin/compose.js';
import { regionAt, mirrorTexel, layout, SKIN, PART_LABEL, OUTER_LABEL, VIEW_PART } from '../../skin/layout.js';
import { rgbToOklab, oklchToRgb, rgbToOklch, DYES } from '../../skin/color.js';
import { CATEGORIES } from '../../skin/items.js';
import { OUTER_PARTS } from '../../model/models.js';
import { segmented, iconButton, toast, openColorPopover, note, section, field, textInput, selectInput, modal, confirmDialog } from '../kit.js';
import { createStage } from '../stage.js';
import { itemThumbURL, faceCanvas } from '../thumbs.js';

const TOOLS = [
  { id: 'pencil', icon: 'pencil', label: 'Brush', key: 'B', sized: true },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E', sized: true },
  { id: 'line', icon: 'line', label: 'Line — drag, within one face', key: 'L' },
  { id: 'rect', icon: 'rect', label: 'Rectangle — drag, within one face; Shift fills', key: 'U' },
  { id: 'fill', icon: 'bucket', label: 'Fill a face', key: 'G' },
  { id: 'replace', icon: 'wand', label: 'Replace a colour — every pixel of it, everywhere', key: 'R' },
  { id: 'picker', icon: 'pipette', label: 'Pick a colour off the model', key: 'I' },
  { id: 'shade', icon: 'shade', label: 'Shade — Shift lightens', key: 'S', sized: true },
  { id: 'dither', icon: 'dither', label: 'Dither — every other pixel', key: 'D', sized: true },
  { id: 'noise', icon: 'sparkle', label: 'Noise — a little texture, lighter and darker', key: 'N', sized: true },
];
const SIZED = new Set(TOOLS.filter(t => t.sized).map(t => t.id));
const SHOW_PARTS = [['head', 'Head'], ['body', 'Body'], ['armR', 'Right arm'], ['armL', 'Left arm'], ['legR', 'Right leg'], ['legL', 'Left leg']];

const FLAT = 4;          // flat sheet scale
const HISTORY = 80;
const shelfLabel = id => CATEGORIES.find(c => c.id === id)?.label || 'Extras';

export function buildPaintView() {
  const P = state.paint;
  const histories = new Map();      // target id -> { undo: [], redo: [] }
  const hist = t => { if (!histories.has(t.id)) histories.set(t.id, { undo: [], redo: [] }); return histories.get(t.id); };
  const hiddenHere = new Set();     // worn keys hidden while painting — the outfit is not changed
  let lastSkin = null;              // what the stage is showing, for the colour picker
  const hiddenParts = new Set();    // body parts hidden to reach what is behind them

  /* ======================================================================= */
  /* LAYOUT                                                                  */
  /* ======================================================================= */
  const toolBtns = new Map();
  const mirrorBtn = h('button.tool-btn', { 'aria-pressed': String(!!P.mirror), 'data-tip': 'Mirror left and right  M', 'data-tip-pos': 'right', onclick: () => setMirror(!P.mirror) }, raw(icon('symmetry', 18)));
  const dock = h('.tooldock',
    ...TOOLS.map(t => {
      const b = h('button.tool-btn', { 'aria-pressed': String(P.tool === t.id), 'data-tip': `${t.label}  ${t.key}`, 'data-tip-pos': 'right', onclick: () => setTool(t.id) }, raw(icon(t.icon, 18)));
      toolBtns.set(t.id, b);
      return b;
    }),
    h('.rail-sep'),
    mirrorBtn,
  );

  const layerSeg = segmented({
    options: [{ value: 'inner', label: 'Base layer' }, { value: 'outer', label: 'Outer layer' }],
    value: P.layer, onChange: v => setLayer(v),
  });
  const undoBtn = iconButton('undo', { tip: 'Undo  ⌘Z', pos: 'bottom', onClick: () => undo() });
  const redoBtn = iconButton('redo', { tip: 'Redo  ⇧⌘Z', pos: 'bottom', onClick: () => redo() });
  const itemsBtn = h('button.btn.btn-sm.btn-ghost', {
    'aria-pressed': String(P.showItems !== false), 'data-tip': 'Show the clothes you are not painting',
    onclick: () => { P.showItems = P.showItems === false; itemsBtn.setAttribute('aria-pressed', String(P.showItems)); repaint(); renderLayers(); },
  }, raw(icon('eye', 14)), h('span', { text: 'Clothes' }));
  const targetLabel = h('span.caption.truncate', { style: 'max-width:300px' });
  const sizeSeg = segmented({
    options: [1, 2, 3].map(n => ({ value: n, label: String(n), tip: `${n}×${n} pixels  [ ]` })),
    value: P.size || 1, onChange: v => setSize(v),
  });
  const fillSeg = segmented({
    options: [{ value: 'outline', label: 'Outline' }, { value: 'filled', label: 'Filled' }],
    value: P.rectFill ? 'filled' : 'outline', onChange: v => { P.rectFill = v === 'filled'; savePaintPrefs(); },
  });
  const sizeOpts = h('.sb-group.tool-opts', h('span.caption', { text: 'Size' }), sizeSeg);
  const rectOpts = h('.sb-group.tool-opts', fillSeg);
  const stageBar = h('.stage-bar',
    h('.sb-group', layerSeg),
    h('.sb-sep'),
    sizeOpts, rectOpts,
    h('.sb-sep'),
    h('.sb-group', undoBtn, redoBtn),
    h('.spacer'),
    targetLabel,
    h('.sb-sep'),
    h('.sb-group', itemsBtn, h('button.btn.btn-sm', { onclick: () => setRoute('dress') }, raw(icon('check', 13)), h('span', { text: 'Done' }))),
  );
  const readout = h('span.coord', { text: '—' });
  const stage = createStage({ paint: true, onStroke, onHover: t => showHover(t) });
  stage.hud.append(h('.hud-sep'), readout);
  const stageWrap = h('.stage-wrap', stageBar, stage.el);

  /* ---- Side panel ---------------------------------------------------------- */
  const layersBody = h('.col.g-2');
  const partsBody = h('.part-chips');
  const targetBody = h('.col.g-3');
  const targetSection = section('This item', [targetBody], { key: 'paint-target' });

  const nowSwatch = h('button.color-now', { 'aria-label': 'Brush colour', 'data-tip': 'Any colour', 'data-tip-pos': 'left', onclick: () => openColorPopover(nowSwatch, P.color, v => setColor(v, { live: true })) });
  const hexInput = h('input.input.input-sm.input-mono', {
    'aria-label': 'Hex colour', maxlength: 9,
    onchange: e => { const v = e.target.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) setColor(v.startsWith('#') ? v : `#${v}`); else e.target.value = P.color.toUpperCase(); },
  });
  const recentGrid = h('.swatch-grid');
  const skinGrid = h('.swatch-grid');
  const dyeGrid = h('.swatch-grid', ...DYES.map(([n, c]) => swatchBtn(c, n)));

  const flatCv = h('canvas.flat-cv', { width: SKIN, height: SKIN });
  const flatOver = h('canvas.flat-over', { width: SKIN * FLAT, height: SKIN * FLAT });
  const flat = h('.flat-view.checker.checker-sm', flatCv, flatOver);
  const scratchA = h('canvas', { width: SKIN, height: SKIN });
  const scratchB = h('canvas', { width: SKIN, height: SKIN });
  const side = h('aside.paint-side',
    h('.insp-scroll',
      section('Painting on', [layersBody], { key: 'paint-layers' }),
      section('Body parts', [
        partsBody,
        h('.caption.muted', { text: 'Hide a part to reach what is behind it — the inside of an arm, the side of the body. Hidden parts cannot be painted, here or on the sheet.' }),
      ], { key: 'paint-parts' }),
      targetSection,
      section('Colour', [
        h('.row.g-3', nowSwatch, h('.col.g-1.grow', h('.caption', { text: 'Brush' }), hexInput)),
        h('.col.g-1', h('.eyebrow', { text: 'Recent' }), recentGrid),
        h('.col.g-1', h('.eyebrow', { text: 'On the model' }), skinGrid),
        h('.col.g-1', h('.eyebrow', { text: 'Dyes' }), dyeGrid),
      ], { key: 'paint-colour' }),
      section('The sheet', [
        flat,
        h('.caption.muted', { text: 'The same 64×64 sheet the game reads, for whatever you are painting. Paint here too — it is the same pixels.' }),
      ], { key: 'paint-flat' }),
      section('About painting', [
        h('.caption.muted', { text: 'Left button paints; right-drag, Alt-drag or Space-drag turns the model; the wheel zooms. Pick what to paint under “Painting on”: the base, or anything worn over it. Things over what you are painting hide it — hide them with the eye, or turn Clothes off — and body parts can be hidden to reach what is behind them. Lines and rectangles stay on the face they start on, like the fill. A base’s base layer is always opaque in the game, so it has no eraser; items can be erased anywhere.' }),
      ], { key: 'paint-about', open: false }),
    ),
  );

  const root = h('.view', { dataset: { view: 'paint' } }, h('.paint-layout', dock, stageWrap, side));

  function swatchBtn(c, name) {
    return h('button.swatch', {
      style: { background: c }, 'aria-label': name || c, 'data-tip': name || c.toUpperCase(), 'data-tip-pos': 'top',
      onclick: () => setColor(c),
    });
  }

  /* ======================================================================= */
  /* WHAT IS BEING PAINTED                                                   */
  /* ======================================================================= */
  const model = () => baseOf(state.project)?.model || 'classic';

  /** The base, or one of your own items worn in this outfit. */
  function target() {
    const o = state.project;
    if (!o) return null;
    if (P.target && P.target !== 'base') {
      const w = o.items.find(x => x.key === P.target);
      const r = w && resolveItem(w.ref, model());
      if (r?.kind === 'item') return { kind: 'item', key: w.key, w, r, rec: r.rec, pixels: r.rec.pixels, img: r.rec.img, id: `item:${r.rec.id}`, name: r.rec.name };
      P.target = 'base';
    }
    const base = baseOf(o);
    return base ? { kind: 'base', rec: base, pixels: base.pixels, img: base.img, id: `base:${base.id}`, name: base.name } : null;
  }

  function setTarget(key) {
    stroke = null;
    P.target = key;
    renderAll();
  }

  async function chooseItem(w) {
    const r = resolveItem(w.ref, model());
    if (!r) return;
    if (r.kind === 'preset') {
      const ok = await confirmDialog({
        title: `Paint ${r.name}?`,
        message: 'Presets are drawn by the app and stay as they are. This outfit switches to your own copy of it — the same look, in the same colours — and that you can paint however you like.',
        confirmLabel: 'Make it mine and paint',
      });
      if (!ok) return;
      await adoptPreset(w.key);
    }
    setTarget(w.key);
  }

  function newItem() {
    if (!state.project) return;
    let name = 'New item', cat = 'tops';
    const nameInput = textInput({ value: name, maxlength: 60, 'data-autofocus': '', onInput: v => { name = v; } });
    modal({
      title: 'New item', icon: 'plus',
      subtitle: 'An empty, see-through sheet worn over this outfit. Paint it on the model — whatever you leave empty stays see-through.',
      body: h('.form-grid',
        field('Name', nameInput),
        field('Shelf', selectInput({ options: CATEGORIES.map(c => ({ value: c.id, label: c.label })), value: cat, onChange: v => { cat = v; } })),
      ),
      actions: [
        { label: 'Cancel' },
        { label: 'Make it', primary: true, run: async () => {
            const rec = await addBlankItem({ name: name.trim() || 'New item', cat });
            toggleWear(`item:${rec.id}`);
            setTarget(state.selWear);
            toast({ title: `${rec.name} is on`, message: `Paint it on the model. It is on the ${shelfLabel(cat)} shelf, and under Yours.`, kind: 'ok' });
          } },
      ],
    });
    queueMicrotask(() => nameInput.select());
  }

  /* ======================================================================= */
  /* STATE                                                                   */
  /* ======================================================================= */
  function setTool(id) {
    P.tool = id;
    for (const [k, b] of toolBtns) b.setAttribute('aria-pressed', String(k === id));
    stage.stage.dataset.tool = id;
    sizeOpts.hidden = !SIZED.has(id);
    rectOpts.hidden = id !== 'rect';
  }
  function setSize(n) {
    P.size = clamp(n, 1, 3);
    sizeSeg.set(P.size);
    savePaintPrefs();
    drawFlat();
  }

  /* ---- Body parts ------------------------------------------------------- */
  const partHidden = (x, y) => { const r = regionAt(x, y, model()); return !r || hiddenParts.has(r.part); };
  function renderParts() {
    const chip = (label, on, flip) => h('button.btn.btn-sm.part-chip', {
      'aria-pressed': String(on), 'data-tip': on ? `Hide the ${label.toLowerCase()}` : `Show the ${label.toLowerCase()}`,
      onclick: () => { flip(); renderParts(); repaint(); drawFlat(); },
    }, raw(icon(on ? 'eye' : 'eyeOff', 12)), h('span', { text: label }));
    partsBody.replaceChildren(
      ...SHOW_PARTS.map(([p, label]) => chip(label, !hiddenParts.has(p), () => { if (hiddenParts.has(p)) hiddenParts.delete(p); else hiddenParts.add(p); })),
      h('button.btn.btn-sm.btn-ghost', { disabled: !hiddenParts.size, onclick: () => { hiddenParts.clear(); renderParts(); repaint(); drawFlat(); } }, 'Show all'),
    );
  }
  function setLayer(v) {
    P.layer = v;
    layerSeg.set(v);
    repaint();
    drawFlat();
  }
  function setMirror(v) {
    P.mirror = v;
    mirrorBtn.setAttribute('aria-pressed', String(v));
    savePaintPrefs();
  }
  function setColor(hex, { live = false } = {}) {
    P.color = hex.toLowerCase().slice(0, 7);
    nowSwatch.style.setProperty('--c', P.color);
    hexInput.value = P.color.toUpperCase();
    if (!live) remember(P.color);
    savePaintPrefs();
  }
  function remember(hex) {
    P.recent = [hex, ...P.recent.filter(c => c !== hex)].slice(0, 12);
    recentGrid.replaceChildren(...P.recent.map(c => swatchBtn(c)));
  }

  /* ======================================================================= */
  /* PIXELS                                                                  */
  /* ======================================================================= */
  const px = (t, x, y) => { const i = (y * SKIN + x) * 4; return t.pixels.subarray(i, i + 4); };
  const put = (t, x, y, rgba) => { const i = (y * SKIN + x) * 4; t.pixels[i] = rgba[0]; t.pixels[i + 1] = rgba[1]; t.pixels[i + 2] = rgba[2]; t.pixels[i + 3] = rgba[3]; };

  /** Every texel a stroke at (x, y) touches — itself, and its mirror. */
  function targets(x, y) {
    const out = partHidden(x, y) ? [] : [{ x, y }];
    if (P.mirror) { const m = mirrorTexel(x, y, model()); if (m && (m.x !== x || m.y !== y) && !partHidden(m.x, m.y)) out.push(m); }
    return out;
  }

  /** The square a brush of the current size covers at (x, y), kept to that face, with mirrors. */
  function footprint(x, y) {
    const s = SIZED.has(P.tool) ? (P.size || 1) : 1;
    const r = regionAt(x, y, model());
    if (!r) return [];
    const lo = -Math.floor((s - 1) / 2);
    const out = [];
    for (let dy = lo; dy < lo + s; dy++) for (let dx = lo; dx < lo + s; dx++) {
      const qx = x + dx, qy = y + dy;
      if (qx < r.x || qy < r.y || qx >= r.x + r.w || qy >= r.y + r.h) continue;
      out.push(...targets(qx, qy));
    }
    return out;
  }

  /** Texels of a rectangle between two corners, all of it or its edge. */
  function rectTexels(a, b, filled) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const out = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (filled || y === y0 || y === y1 || x === x0 || x === x1) out.push({ x, y });
    }
    return out;
  }

  /** Every pixel of exactly one colour, in whatever is being painted, becomes another. */
  function replaceColour(t, from, to) {
    const { at } = layout(model());
    let n = 0;
    for (let i = 0; i < SKIN * SKIN; i++) {
      if (at[i] < 0) continue;
      const x = i % SKIN, y = (i - x) / SKIN;
      if (hiddenParts.size && partHidden(x, y)) continue;
      const c = px(t, x, y);
      if (c[0] === from[0] && c[1] === from[1] && c[2] === from[2] && c[3] === from[3]) { put(t, x, y, to); n++; }
    }
    return n > 0;
  }

  function noiseAt(t, x, y) {
    const c = px(t, x, y);
    if (!c[3]) return false;
    const [L, C, H] = rgbToOklch(c[0], c[1], c[2]);
    const [r, g, b] = oklchToRgb(clamp(L + (Math.random() * 2 - 1) * 0.04, 0, 1), C, H);
    put(t, x, y, [r, g, b, c[3]]);
    return true;
  }

  function flood(t, sx, sy, rgba) {
    const r = regionAt(sx, sy, model());
    if (!r) return false;
    const from = [...px(t, sx, sy)];
    if (from.every((v, i) => v === rgba[i])) return false;
    const seen = new Set();
    const stack = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) continue;
      const k = y * SKIN + x;
      if (seen.has(k)) continue;
      seen.add(k);
      const c = px(t, x, y);
      if (c[0] !== from[0] || c[1] !== from[1] || c[2] !== from[2] || c[3] !== from[3]) continue;
      put(t, x, y, rgba);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return true;
  }

  function shadeAt(t, x, y, lighter) {
    const c = px(t, x, y);
    if (!c[3]) return false;
    const [L, C, H] = rgbToOklch(c[0], c[1], c[2]);
    const [r, g, b] = oklchToRgb(clamp(L + (lighter ? 0.045 : -0.045), 0, 1), C, H);
    put(t, x, y, [r, g, b, c[3]]);
    return true;
  }

  /* ---- Strokes ------------------------------------------------------------ */
  let stroke = null;
  let warned = false;

  function onStroke(phase, tx, e) {
    if (phase === 'start') {
      const t = target();
      if (!t) return;
      // The item's colour groups as they were before this stroke, so its tints
      // can be carried onto the new groups afterwards.
      if (t.kind === 'item') itemLayer(t.rec);
      stroke = { t, snapshot: new Uint8ClampedArray(t.pixels), changed: false, last: null, shaded: new Set() };
      applyAt(stroke.t, tx, e);
    } else if (phase === 'move' && stroke) {
      applyAt(stroke.t, tx, e);
    } else if (phase === 'end' && stroke) {
      if (stroke.changed) commit(stroke.t, stroke.snapshot);
      stroke = null;
    }
  }

  /** Fill the gap between two texels on the same face, so a fast drag draws a line. */
  function between(a, b) {
    if (!a || !b) return [b];
    const ra = regionAt(a.x, a.y, model()), rb = regionAt(b.x, b.y, model());
    if (!ra || ra !== rb) return [b];
    const out = [];
    let x0 = a.x, y0 = a.y;
    const dx = Math.abs(b.x - x0), dy = -Math.abs(b.y - y0), sx = x0 < b.x ? 1 : -1, sy = y0 < b.y ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 128; n++) {
      out.push({ x: x0, y: y0 });
      if (x0 === b.x && y0 === b.y) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return out;
  }

  function applyAt(t, tx, e) {
    if (!stroke || !tx || tx.y >= SKIN) return;
    const r = regionAt(tx.x, tx.y, model());
    if (!r) return;
    if (P.tool === 'picker') {
      // What you see, not what is in the sheet under it.
      const img = lastSkin || t.img;
      const i = (tx.y * SKIN + tx.x) * 4;
      if (img.data[i + 3]) setColor(rgbaToHex(img.data[i], img.data[i + 1], img.data[i + 2]));
      return;
    }
    if (hiddenParts.has(r.part)) return;
    if (P.tool === 'eraser' && t.kind === 'base' && r.layer === 'inner') {
      if (!warned) { warned = true; toast({ title: 'A base’s base layer cannot be see-through', message: 'The game draws it solid. Switch to the outer layer to erase, paint over it, or pick an item to paint on.', kind: 'info' }); }
      return;
    }
    const [cr, cg, cb] = hexToRgba(P.color);
    const ink = [cr, cg, cb, 255];
    const differs = c => c[0] !== cr || c[1] !== cg || c[2] !== cb || c[3] !== 255;
    let changed = false;
    if (P.tool === 'fill') {
      for (const p of targets(tx.x, tx.y)) changed = flood(t, p.x, p.y, ink) || changed;
      stroke.last = null;
    } else if (P.tool === 'replace') {
      if (stroke.done) return;
      stroke.done = true;
      const from = [...px(t, tx.x, tx.y)];
      if (from[3] && differs(from)) changed = replaceColour(t, from, ink);
    } else if (P.tool === 'line' || P.tool === 'rect') {
      /* A shape is drawn afresh from the stroke's start on every move, so it
         follows the pointer; it stays on the face it began on. */
      if (!stroke.anchor) stroke.anchor = { ...tx, region: r };
      if (r !== stroke.anchor.region) return;
      t.pixels.set(stroke.snapshot);
      const pts = P.tool === 'line' ? between(stroke.anchor, tx) : rectTexels(stroke.anchor, tx, P.rectFill || e?.shiftKey);
      for (const q of pts) for (const p of targets(q.x, q.y)) put(t, p.x, p.y, ink);
      changed = true;
    } else {
      for (const q of between(stroke.last, tx)) for (const p of footprint(q.x, q.y)) {
        const k = p.y * SKIN + p.x;
        if (P.tool === 'pencil' || (P.tool === 'dither' && ((p.x + p.y) & 1) === 0)) {
          if (differs(px(t, p.x, p.y))) { put(t, p.x, p.y, ink); changed = true; }
        } else if (P.tool === 'eraser') {
          // A base keeps its base layer solid even under a mirrored stroke.
          if (t.kind === 'base' && regionAt(p.x, p.y, model())?.layer === 'inner') continue;
          if (px(t, p.x, p.y)[3]) { put(t, p.x, p.y, [0, 0, 0, 0]); changed = true; }
        } else if (P.tool === 'shade' || P.tool === 'noise') {
          // Once per pixel per stroke, or dragging back and forth runs away.
          if (stroke.shaded.has(k)) continue;
          stroke.shaded.add(k);
          changed = (P.tool === 'shade' ? shadeAt(t, p.x, p.y, e?.shiftKey) : noiseAt(t, p.x, p.y)) || changed;
        }
      }
      stroke.last = tx;
    }
    if (changed) {
      stroke.changed = true;
      if (['pencil', 'fill', 'line', 'rect', 'dither', 'replace'].includes(P.tool)) remember(P.color);
      repaint();
      drawFlat();
    }
  }

  function commit(t, snapshot) {
    const H = hist(t);
    H.undo.push(snapshot);
    if (H.undo.length > HISTORY) H.undo.shift();
    H.redo = [];
    saved(t);
  }
  function saved(t) {
    if (t.kind === 'base') { saveBaseSoon(t.rec); bus.emit('base:painted', t.rec.id); }
    else saveItemSoon(t.rec);
    syncHistory();
    paintSkinColours();
  }
  function undo() {
    const t = target();
    if (!t) return;
    const H = hist(t);
    const prev = H.undo.pop();
    if (!prev) return;
    if (t.kind === 'item') itemLayer(t.rec);
    H.redo.push(new Uint8ClampedArray(t.pixels));
    t.pixels.set(prev);
    saved(t); repaint(); drawFlat();
  }
  function redo() {
    const t = target();
    if (!t) return;
    const H = hist(t);
    const next = H.redo.pop();
    if (!next) return;
    if (t.kind === 'item') itemLayer(t.rec);
    H.undo.push(new Uint8ClampedArray(t.pixels));
    t.pixels.set(next);
    saved(t); repaint(); drawFlat();
  }
  function syncHistory() {
    const t = target();
    const H = t ? hist(t) : { undo: [], redo: [] };
    undoBtn.disabled = !H.undo.length;
    redoBtn.disabled = !H.redo.length;
  }

  /* ======================================================================= */
  /* DRAWING                                                                 */
  /* ======================================================================= */
  /** The base with everything worn over it — the item being painted as drawn, the rest as tinted. */
  function composed() {
    const o = state.project, base = baseOf(o), m = model(), t = target();
    const worn = [];
    for (const w of o.items) {
      const painting = t?.kind === 'item' && w.key === t.key;
      if (painting) { worn.push({ pixels: t.pixels, hideUnder: w.hideUnder }); continue; }
      if (w.hidden || hiddenHere.has(w.key) || P.showItems === false) continue;
      const r = resolveItem(w.ref, m);
      if (r) worn.push({ layer: r.layer, tints: w.tints, hideUnder: w.hideUnder });
    }
    return composeSkin(base.img, m, worn);
  }

  const repaint = rafBatch(() => {
    const o = state.project, base = baseOf(o);
    if (!o || !base) return;
    stage.setModel(base.model === 'slim');
    lastSkin = composed();
    stage.setTexture(atlas(lastSkin, null));
    const gone = [...hiddenParts].flatMap(p => [VIEW_PART.inner[p], VIEW_PART.outer[p]]);
    stage.setHidden([...(P.layer === 'inner' ? OUTER_PARTS : []), ...gone, 'cape']);
  });

  function drawFlat(hover = null) {
    const t = target();
    if (!t) return;
    const g0 = flatCv.getContext('2d');
    g0.clearRect(0, 0, SKIN, SKIN);
    if (t.kind === 'item') {
      // The base faintly underneath, so an item's pixels have somewhere to be.
      scratchA.getContext('2d').putImageData(baseOf(state.project).img, 0, 0);
      scratchB.getContext('2d').putImageData(t.img, 0, 0);
      g0.globalAlpha = 0.28; g0.drawImage(scratchA, 0, 0);
      g0.globalAlpha = 1; g0.drawImage(scratchB, 0, 0);
    } else {
      g0.putImageData(t.img, 0, 0);
    }
    const g = flatOver.getContext('2d');
    g.clearRect(0, 0, flatOver.width, flatOver.height);
    // Dim everything the current layer does not own, so it is obvious where
    // a stroke on the sheet will land.
    const { at, regions } = layout(model());
    g.fillStyle = 'rgba(10,12,14,.55)';
    for (let i = 0; i < SKIN * SKIN; i++) {
      const r = at[i] >= 0 ? regions[at[i]] : null;
      if (!r || r.layer !== P.layer || hiddenParts.has(r.part)) g.fillRect((i % SKIN) * FLAT, Math.floor(i / SKIN) * FLAT, FLAT, FLAT);
    }
    if (hover && hover.y < SKIN) {
      g.strokeStyle = '#fff';
      g.lineWidth = 1;
      for (const p of footprint(hover.x, hover.y)) g.strokeRect(p.x * FLAT + 0.5, p.y * FLAT + 0.5, FLAT - 1, FLAT - 1);
    }
  }

  function showHover(tx) {
    const r = tx && tx.y < SKIN ? regionAt(tx.x, tx.y, model()) : null;
    readout.textContent = r ? `${(r.layer === 'outer' ? OUTER_LABEL : PART_LABEL)[r.part]} · ${r.face} · ${tx.x}, ${tx.y}` : '—';
    drawFlat(tx);
  }

  function paintSkinColours() {
    const img = lastSkin || target()?.img;
    if (!img) return;
    const { at } = layout(model());
    const counts = new Map();
    for (let i = 0; i < SKIN * SKIN; i++) {
      if (at[i] < 0 || !img.data[i * 4 + 3]) continue;
      const hex = rgbaToHex(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
      counts.set(hex, (counts.get(hex) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([c]) => c);
    // Darkest to lightest reads as a palette rather than a jumble.
    top.sort((a, b) => rgbToOklab(...hexToRgba(a).slice(0, 3))[0] - rgbToOklab(...hexToRgba(b).slice(0, 3))[0]);
    skinGrid.replaceChildren(...top.map(c => swatchBtn(c)));
  }

  /* ---- "Painting on" ------------------------------------------------------ */
  function renderLayers() {
    const o = state.project;
    if (!o) { layersBody.replaceChildren(); return; }
    const t = target(), m = model();
    const rows = [...o.items].reverse().map(w => {
      const r = resolveItem(w.ref, m);
      if (!r) return null;
      const url = itemThumbURL(w.ref + (r.rec ? `@${r.rec.updatedAt}` : ''), r.layer, { slim: m === 'slim', view: r.view || 'front', px: 64 });
      const painting = t?.key === w.key;
      const hidden = !painting && (w.hidden || hiddenHere.has(w.key) || P.showItems === false);
      const eye = painting ? h('span.pl-brush', { 'data-tip': 'Painting this', 'data-tip-pos': 'left' }, raw(icon('pencil', 13)))
        : iconButton(hidden ? 'eyeOff' : 'eye', {
          tip: w.hidden ? 'Hidden in the outfit — show it' : hidden ? 'Show it while painting' : 'Hide it while painting',
          onClick: () => {
            if (w.hidden) { w.hidden = false; outfitChanged('hide'); }
            else if (hiddenHere.has(w.key)) hiddenHere.delete(w.key);
            else hiddenHere.add(w.key);
            renderLayers(); repaint();
          },
        });
      return h('.pl-row', {
        'aria-selected': String(painting), dataset: { hidden: String(hidden) },
        role: 'button', tabindex: 0,
        onclick: e => { if (!e.target.closest('button') && !painting) chooseItem(w); },
        onkeydown: e => { if ((e.key === 'Enter' || e.key === ' ') && !painting) { e.preventDefault(); chooseItem(w); } },
      },
        h('.pl-pic', url ? h('img', { src: url, alt: '' }) : null),
        h('.pl-main', h('.pl-name.truncate', { text: r.name }), h('.pl-sub.truncate', { text: r.kind === 'preset' ? 'Preset · painting makes it yours' : shelfLabel(r.cat) })),
        eye,
      );
    }).filter(Boolean);
    const base = baseOf(o);
    const baseRow = base ? h('.pl-row', {
      'aria-selected': String(t?.kind === 'base'), role: 'button', tabindex: 0,
      onclick: () => { if (t?.kind !== 'base') setTarget('base'); },
      onkeydown: e => { if (e.key === 'Enter' && t?.kind !== 'base') setTarget('base'); },
    },
      h('.pl-pic.pl-face', faceCanvas(base.img, 5)),
      h('.pl-main', h('.pl-name.truncate', { text: base.name }), h('.pl-sub', { text: 'Base skin · under everything' })),
      t?.kind === 'base' ? h('span.pl-brush', raw(icon('pencil', 13))) : h('span'),
    ) : null;
    layersBody.replaceChildren(
      h('.pl-list', ...rows, ...(baseRow ? [baseRow] : [])),
      h('button.btn.btn-sm.pl-new', { onclick: () => newItem() }, raw(icon('plus', 13)), h('span', { text: 'New item' })),
      h('.caption.muted', { text: 'Top of the list is worn outermost. Click one to paint it.' }),
    );
  }

  function renderTarget() {
    const t = target();
    const head = targetSection.querySelector('.section-head span:not(.chev)');
    if (!t) { targetBody.replaceChildren(); return; }
    if (t.kind === 'base') {
      if (head) head.textContent = 'This base';
      targetBody.replaceChildren(h('.caption.muted', { text: `${t.name} is shared: every outfit built on it changes with what you paint. To paint over the clothes rather than under them, pick one of them above — or make a new item.` }));
      return;
    }
    if (head) head.textContent = 'This item';
    const tinted = Object.keys(t.w.tints || {}).length > 0;
    const kids = [
      h('.form-grid',
        field('Name', textInput({ value: t.rec.name, maxlength: 60, onChange: v => { if (v.trim()) updateOwn('item', t.rec.id, { name: v.trim() }); } })),
        field('Shelf', selectInput({ options: CATEGORIES.map(c => ({ value: c.id, label: c.label })), value: t.rec.cat, onChange: v => updateOwn('item', t.rec.id, { cat: v }) })),
      ),
      tinted ? note('Shown as drawn while you paint it. Its tints come back when you leave, and follow what you paint.', 'info') : null,
      h('.caption.muted', { text: 'Your own item: every outfit wearing it changes too. The eraser works anywhere — an item only covers what you paint.' }),
    ];
    targetBody.replaceChildren(...kids.filter(Boolean));
  }

  /* ---- The flat sheet takes strokes too ---------------------------------- */
  const flatTexel = e => {
    const r = flatOver.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * SKIN), y = Math.floor((e.clientY - r.top) / r.height * SKIN);
    return x >= 0 && y >= 0 && x < SKIN && y < SKIN ? { x, y } : null;
  };
  const ownsTexel = tx => { const r = tx && regionAt(tx.x, tx.y, model()); return r && r.layer === P.layer && !hiddenParts.has(r.part) ? tx : null; };
  let flatDown = false;
  flatOver.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    flatDown = true;
    try { flatOver.setPointerCapture(e.pointerId); } catch { /* a pointer already gone */ }
    onStroke('start', ownsTexel(flatTexel(e)), e);
  });
  flatOver.addEventListener('pointermove', e => {
    const tx = flatTexel(e);
    if (flatDown) onStroke('move', ownsTexel(tx), e);
    showHover(tx);
    stage.hoverTexel(tx);
  });
  const flatUp = e => { if (!flatDown) return; flatDown = false; onStroke('end', null, e); };
  flatOver.addEventListener('pointerup', flatUp);
  flatOver.addEventListener('pointercancel', flatUp);
  flatOver.addEventListener('pointerleave', () => { if (!flatDown) { showHover(null); stage.hoverTexel(null); } });

  /* ======================================================================= */
  /* WIRING                                                                  */
  /* ======================================================================= */
  function renderAll() {
    if (P.target === 'new') { P.target = 'base'; queueMicrotask(newItem); }
    const t = target();
    targetLabel.textContent = !t ? '' : t.kind === 'base'
      ? `Painting the base, ${t.name} — every outfit on it changes`
      : `Painting ${t.name} — everywhere it is worn changes`;
    setTool(TOOLS.some(t => t.id === P.tool) ? P.tool : 'pencil');
    sizeSeg.set(P.size || 1);
    fillSeg.set(P.rectFill ? 'filled' : 'outline');
    renderParts();
    setLayer(P.layer);
    setMirror(!!P.mirror);
    setColor(P.color, { live: true });
    recentGrid.replaceChildren(...P.recent.map(c => swatchBtn(c)));
    itemsBtn.setAttribute('aria-pressed', String(P.showItems !== false));
    renderLayers();
    renderTarget();
    syncHistory();
    repaint();
    requestAnimationFrame(() => { paintSkinColours(); drawFlat(); });
  }

  const shown = () => state.route === 'paint';
  bus.on('project:open', () => { hiddenHere.clear(); if (shown()) renderAll(); });
  bus.on('outfit:changed', reason => {
    if (!shown() || stroke) return;
    if (reason === 'base' || reason === 'model') renderAll();
    else if (reason !== 'tint' && reason !== 'name') { renderLayers(); repaint(); }
  });
  bus.on('bases', () => { if (shown()) renderAll(); });
  bus.on('items', () => { if (shown() && !stroke) { renderLayers(); renderTarget(); } });
  bus.on('route', r => { if (r !== 'paint') flushItemSaves(); });

  on(window, 'keydown', e => {
    if (state.route !== 'paint' || !state.project) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('.overlay, .cmdk-host, .menu')) return;
    const k = e.key.toLowerCase();
    if (hasMod(e) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (hasMod(e) && k === 'y') { e.preventDefault(); redo(); return; }
    if (hasMod(e) || e.altKey) return;
    const tool = TOOLS.find(t => t.key.toLowerCase() === k);
    if (tool) { e.preventDefault(); setTool(tool.id); }
    else if (k === 'm') { e.preventDefault(); setMirror(!P.mirror); }
    else if (e.key === '[' || e.key === ']') { e.preventDefault(); setSize((P.size || 1) + (e.key === ']' ? 1 : -1)); }
    else if (k === 'o') { e.preventDefault(); setLayer(P.layer === 'inner' ? 'outer' : 'inner'); }
  });

  root.refresh = renderAll;
  return root;
}
