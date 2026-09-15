/* ============================================================================
   Getting things in — a player's name, a PNG, a cape — and the dialogs that
   decide what they become: a base, an item (or several), a cape, a new outfit.
   ========================================================================= */

import { h, raw } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { plural, AppError, rafBatch, hasMod } from '../core/util.js';
import {
  state, bus, addBase, addStarterBase, addCape, addItem, newProject, setRoute, setOutfitBase,
  setCape, outfitChanged, outfitsUsingBase, renameBase, deleteBase, saveBase, basesSorted,
  firstBaseId, toggleWear, ensureWorn, adoptPreset, itemLayer, replaceWithPieces, deleteOwn, addLook,
  resolveItem, modelOf,
} from '../core/store.js';
import { lookupPlayer, validName } from '../skin/mojang.js';
import { decodeImage, normalizeSkin, normalizeCape, guessSlim } from '../skin/image.js';
import { PARTS, PART_LABEL, VIEW_PART, layout, mirrorTexel, SKIN } from '../skin/layout.js';
import { CATEGORIES } from '../skin/items.js';
import { remapTints, layerFromPixels } from '../skin/tint.js';
import { composeSkin, atlas } from '../skin/compose.js';
import { PIECES, splitPieces, guessShoeRows, colourMask, skinMask, wandSelect, partMask, partHasPixels, tolerance } from '../skin/split.js';
import { OUTER_PARTS } from '../model/models.js';
import {
  modal, toast, field, textInput, selectInput, segmented, dropzone, checkbox, note, confirmDialog, promptDialog,
  contextMenu, slider, stepper, iconButton,
} from './kit.js';
import { renderScene, ghostSkin, faceCanvas, flatCanvas } from './thumbs.js';
import { createStage } from './stage.js';

const samePixels = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const playerSource = p => ({ kind: 'player', name: p.name, uuid: p.uuid, at: Date.now() });
const pics = (skin, { slim = false, cape = null, px = 150 } = {}) =>
  h('.pic-pair', ...['front', 'back'].map(view => renderScene({ skin, cape, slim, view, px }) || faceCanvas(skin, 12)));
const shelfOptions = () => CATEGORIES.map(c => ({ value: c.id, label: c.label }));

/* ========================================================================= */
/* PLAYERS                                                                   */
/* ========================================================================= */

export async function fetchPlayer(name) {
  const p = await lookupPlayer(name);
  if (!p.skin) throw new AppError(`${p.name} has no skin of their own — they are wearing one of the game’s defaults, which are Mojang’s.`);
  const { img } = normalizeSkin(await decodeImage(p.skin));
  let capeImg = null;
  if (p.cape) { try { capeImg = normalizeCape(await decodeImage(p.cape)).img; } catch { /* an odd cape is not worth failing the skin over */ } }
  return { name: p.name, uuid: p.uuid, model: p.slim ? 'slim' : 'classic', skinImg: img, capeImg };
}

const existingBase = p => [...state.bases.values()].find(b => b.source?.uuid === p.uuid && samePixels(b.pixels, p.skinImg.data));
const existingCape = p => p.capeImg && [...state.capes.values()].find(c => c.source?.uuid === p.uuid && samePixels(c.pixels, p.capeImg.data));

const PLAYER_COPY = {
  outfit: { title: 'Wear a player’s skin', sub: 'Their skin becomes a base, their cape joins your capes, and a new outfit starts from both.', go: 'Start an outfit' },
  base:   { title: 'Add a player’s skin', sub: 'It joins your base skins. The outfit you have open switches to it.', go: 'Add skin' },
  cape:   { title: 'Borrow a player’s cape', sub: 'Their cape joins your capes, tintable like everything else.', go: 'Add cape' },
  item:   { title: 'Make items from a player’s skin', sub: 'Keep their clothes, lose their skin, and wear what is left over any base — whole, or split into pieces.', go: 'Choose what to keep' },
};

/**
 * @param {object} o
 *   mode     'outfit' | 'base' | 'cape' | 'item'
 *   initial  a name to look up straight away
 */
export function openPlayerDialog({ mode = 'outfit', initial = '' } = {}) {
  const copy = PLAYER_COPY[mode];
  let found = null, busy = false;
  const opts = { keepCape: true };
  const out = h('.player-out', h('.caption.muted', { text: 'Type a name and press Enter.' }));
  const input = textInput({
    value: initial, placeholder: 'Their Minecraft name', maxlength: 36, 'data-autofocus': '',
    autocomplete: 'off', spellcheck: 'false',
    onInput: () => { found = null; },
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); look(); } },
  });
  const btn = h('button.btn', { onclick: () => look() }, raw(icon('search', 14)), h('span', { text: 'Look up' }));

  async function look() {
    const name = input.value.trim();
    if (!validName(name)) { out.replaceChildren(note('Minecraft names are 1–16 letters, numbers and underscores.', 'warn')); return null; }
    if (busy) return null;
    if (found && found.name.toLowerCase() === name.toLowerCase()) return found;
    busy = true; btn.classList.add('btn-loading');
    out.replaceChildren(h('.row.g-2', h('.spinner'), h('span.caption', { text: `Looking up ${name}…` })));
    try {
      found = await fetchPlayer(name);
      out.replaceChildren(preview(found));
      return found;
    } catch (e) {
      found = null;
      out.replaceChildren(note(e.message, 'danger'));
      return null;
    } finally { busy = false; btn.classList.remove('btn-loading'); }
  }

  function preview(p) {
    return h('.player-found',
      pics(p.skinImg, { slim: p.model === 'slim', cape: p.capeImg }),
      h('.col.g-2',
        h('.title-sm', { text: p.name }),
        h('.row.g-1.wrap',
          h('span.badge', { text: p.model === 'slim' ? 'Slim arms' : 'Classic arms' }),
          h('span.badge', { class: p.capeImg ? 'badge-accent' : '', text: p.capeImg ? 'Cape' : 'No cape' }),
        ),
        p.capeImg && (mode === 'outfit' || mode === 'base')
          ? checkbox({ label: 'Add their cape too', checked: true, onChange: v => { opts.keepCape = v; } }) : null,
        mode === 'cape' && !p.capeImg ? note(`${p.name} is not wearing a cape right now.`, 'warn') : null,
      ),
    );
  }

  modal({
    title: copy.title, subtitle: copy.sub, icon: 'search',
    body: h('.col.g-4',
      h('.row.g-2', h('.grow', input), btn),
      out,
      h('.caption.muted', { text: 'Mojang’s own lookup does not answer web pages, so the name goes to playerdb.co (or api.ashcon.app if that is down), and the textures come from Mojang. Nothing else leaves your browser.' }),
    ),
    actions: [
      { label: 'Cancel' },
      { label: copy.go, primary: true, async: true, run: async () => {
          const p = found || await look();
          if (!p) return false;
          return usePlayer(p, mode, opts);
        } },
    ],
  });
  if (initial) queueMicrotask(look);
}

async function usePlayer(p, mode, { keepCape }) {
  if (mode === 'item') {
    openItemMaker(p.skinImg, { name: `${p.name}’s look`, model: p.model, source: playerSource(p) });
    return;
  }
  if (mode === 'cape') {
    if (!p.capeImg) return false;
    const cape = existingCape(p) || await addCape({ name: `${p.name}’s cape`, img: p.capeImg, source: playerSource(p) });
    if (state.project) setCape(`cape:${cape.id}`);
    toast({ title: 'Cape added', message: state.project ? `${state.project.name} is wearing it.` : `${cape.name} is with your capes.`, kind: 'ok' });
    return;
  }
  const base = existingBase(p) || await addBase({ name: p.name, model: p.model, img: p.skinImg, source: playerSource(p) });
  const cape = keepCape && p.capeImg ? (existingCape(p) || await addCape({ name: `${p.name}’s cape`, img: p.capeImg, source: playerSource(p) })) : null;

  if (mode === 'base') {
    if (state.project) {
      setOutfitBase(base.id);
      if (cape && !state.project.cape) setCape(`cape:${cape.id}`);
    }
    toast({ title: `${p.name}’s skin added`, message: state.project ? `${state.project.name} is now built on it.` : 'It is with your base skins.', kind: 'ok' });
    return;
  }
  await newProject({ name: p.name, baseId: base.id });
  if (cape) setCape(`cape:${cape.id}`);
  setRoute('dress', { force: true });
  toast({ title: `Dressed as ${p.name}`, message: cape ? 'Their cape is on too. Now pick something to wear over it.' : 'Now pick something to wear over it.', kind: 'ok' });
}

/* ========================================================================= */
/* SKIN FILES                                                                */
/* ========================================================================= */

export async function importSkinFile(file, { mode = 'base' } = {}) {
  let res;
  try { res = normalizeSkin(await decodeImage(file)); }
  catch (e) { toast({ title: 'That is not a skin', message: e.message, kind: 'error' }); return; }
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Skin';
  const model = guessSlim(res.img) ? 'slim' : 'classic';
  if (mode === 'item') { openItemMaker(res.img, { name, model, source: { kind: 'file', name: file.name } }); return; }
  confirmSkin(res, { name, model, fileName: file.name });
}

function confirmSkin({ img, legacy, scaled }, { name, model, fileName }) {
  let nm = name, arms = model;
  const pic = h('div');
  const paint = () => pic.replaceChildren(pics(img, { slim: arms === 'slim' }));
  paint();
  const add = () => addBase({ name: nm.trim() || 'Skin', model: arms, img, source: { kind: 'file', name: fileName } });
  modal({
    title: 'Add a skin', subtitle: fileName, icon: 'upload',
    body: h('.col.g-4',
      pic,
      field('Name', textInput({ value: nm, onInput: v => { nm = v; } })),
      field('Arms', segmented({
        options: [{ value: 'classic', label: 'Classic · 4 px' }, { value: 'slim', label: 'Slim · 3 px' }],
        value: arms, block: true, onChange: v => { arms = v; paint(); },
      }), 'Guessed from the file. It decides how every item is drawn on the arms.'),
      legacy ? note('An old 64×32 skin. Its left arm and leg were made from the right ones, as the game does.', 'info') : null,
      scaled ? note('Scaled down to 64×64 — the game only reads skins at that size.', 'warn') : null,
    ),
    actions: [
      { label: 'Cancel' },
      state.project ? { label: 'Add and wear', run: async () => {
          const b = await add();
          setOutfitBase(b.id);
          toast({ title: 'Skin added', message: `${state.project.name} is now built on it.`, kind: 'ok' });
        } } : null,
      { label: 'Add skin', primary: !state.project, run: async () => {
          const b = await add();
          toast({ title: 'Skin added', message: `${b.name} is with your base skins.`, kind: 'ok' });
        } },
    ].filter(Boolean),
  });
}

export function openSkinFileDialog({ mode = 'base' } = {}) {
  modal({
    title: mode === 'item' ? 'Make items from a skin' : 'Import a skin',
    subtitle: mode === 'item' ? 'Any skin PNG. You choose which parts of it to keep, and erase the rest.' : 'A 64×64 skin PNG, or an old 64×32 one.',
    icon: 'upload',
    body: ({ close }) => dropzone({
      label: 'Drop a skin PNG', hint: 'or click to choose one', accept: 'image/png,image/*',
      onFiles: fs => { close(); importSkinFile(fs[0], { mode }); },
    }),
    actions: [{ label: 'Cancel' }],
  });
}

/* ========================================================================= */
/* ITEMS FROM SKINS                                                          */
/* ========================================================================= */

const KEEP_PRESETS = {
  body:  { label: 'All but the head', inner: ['body', 'armR', 'armL', 'legR', 'legL'], outer: ['body', 'armR', 'armL', 'legR', 'legL'] },
  top:   { label: 'Top half', inner: ['body', 'armR', 'armL'], outer: ['body', 'armR', 'armL'] },
  legs:  { label: 'Legs', inner: ['legR', 'legL'], outer: ['legR', 'legL'] },
  head:  { label: 'Head', inner: ['head'], outer: ['head'] },
  outer: { label: 'Outer layer', inner: [], outer: PARTS },
  all:   { label: 'Everything', inner: PARTS, outer: PARTS },
};

const ERASE_TOOLS = [
  { value: 'wand', label: 'Wand' }, { value: 'skin', label: 'Skin' }, { value: 'colour', label: 'Colour' },
  { value: 'erase', label: 'Eraser' }, { value: 'restore', label: 'Restore' },
];
const CLICK_TOOLS = new Set(['wand', 'skin', 'colour']);
const TOOL_KEYS = { w: 'wand', s: 'skin', c: 'colour', e: 'erase', r: 'restore' };
const ERASE_HINT = {
  wand: 'Click a colour on the model: everything touching it in that colour goes, all the way round the part. Hover first — what it will take lights up pink.',
  skin: 'Click their skin — a hand, their neck — and every shade of that skin goes, lit or shadowed, wherever it is on what you are keeping. Hover first to see what it will take.',
  colour: 'Click a colour: that colour goes everywhere it appears on what you are keeping and can see.',
  erase: 'Drag over pixels to remove them.',
  restore: 'Drag over the model to bring back what was erased. What would come back shows green.',
};
const SHOW_PARTS = [['head', 'Head'], ['body', 'Body'], ['armR', 'Right arm'], ['armL', 'Left arm'], ['legR', 'Right leg'], ['legL', 'Left leg']];
const GOES = [255, 59, 120];        // what a click would erase, painted over the model
const COMES_BACK = [70, 214, 140];  // what the restore brush would bring back

/**
 * Keep some parts of a skin, erase what is not clothes, and file what is
 * left as an item — or as several, split where the body is split.
 *
 * Every tool shows what it will do before you click: hover the model and
 * the pixels a click would take light up. Parts can be hidden, so the inside
 * of an arm or the side of the body is in reach — and the colour tools leave
 * hidden parts alone, which is a way to aim them.
 */
export function openItemMaker(src, { name = 'My item', model = 'classic', source = { kind: 'file' } } = {}) {
  const original = new ImageData(new Uint8ClampedArray(src.data), SKIN, SKIN);
  const work = new ImageData(new Uint8ClampedArray(src.data), SKIN, SKIN);
  const content = Object.fromEntries(PARTS.map(p => [p, partHasPixels(src, p, 'outer', model)]));
  // Everything but the head, both layers: that is where a player's clothes are.
  const keep = {
    inner: Object.fromEntries(PARTS.map(p => [p, p !== 'head'])),
    outer: Object.fromEntries(PARTS.map(p => [p, p !== 'head'])),
  };
  let nm = name, catTouched = false;
  /* The one-item shelf follows what is kept — a head alone is a hat, legs
     alone are bottoms — until you pick a shelf yourself. */
  const guessCat = () => {
    const on = part => keep.inner[part] || keep.outer[part];
    const top = on('body') || on('armR') || on('armL'), legs = on('legR') || on('legL');
    return on('head') && !top && !legs ? 'hats' : legs && !top && !on('head') ? 'bottoms' : 'tops';
  };
  let cat = guessCat();
  const shelfSel = selectInput({ options: shelfOptions(), value: cat, onChange: v => { cat = v; catTouched = true; } });
  const syncCat = () => { if (!catTouched) { cat = guessCat(); shelfSel.value = cat; } };

  let tool = 'wand', tol = 26, mirror = false, showOuter = true;
  const hidden = new Set();          // body parts hidden from view, and from reach
  const undos = [], redos = [];

  const { at, regions, toOuter } = layout(model);
  const toInner = new Int16Array(SKIN * SKIN).fill(-1);
  for (let i = 0; i < SKIN * SKIN; i++) if (toOuter[i] >= 0) toInner[toOuter[i]] = i;

  const kept = () => {
    const m = partMask(model, keep);
    const out = new ImageData(SKIN, SKIN);
    for (let i = 0; i < SKIN * SKIN; i++) if (m[i]) out.data.set(work.data.subarray(i * 4, i * 4 + 4), i * 4);
    return out;
  };
  const isEmpty = img => !img.data.some((v, i) => i % 4 === 3 && v);
  let shown = kept();                // what the model is showing: kept, minus erased

  /** Kept texels on parts that are showing. */
  function reachable() {
    const m = partMask(model, keep);
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      const r = regions[at[i]];
      if (hidden.has(r.part) || (r.layer === 'outer' && !showOuter)) m[i] = 0;
    }
    return m;
  }

  /* The texel the pointer means is the one you can see. The outer layer's
     shell is there even where it has no pixel, and the pointer meets it first
     — so a see-through outer texel passes the pointer on to the base-layer
     texel under it. (For the restore brush, see-through means nothing to
     bring back there.) */
  function resolve(t) {
    if (!t || t.y >= SKIN) return -1;
    const i = t.y * SKIN + t.x;
    const r = at[i] >= 0 ? regions[at[i]] : null;
    if (!r) return -1;
    if (r.layer === 'outer' && toInner[i] >= 0) {
      const there = tool === 'restore' ? original.data[i * 4 + 3] && keep.outer[r.part] : shown.data[i * 4 + 3];
      if (!there) return toInner[i];
    }
    return i;
  }
  const xy = i => ({ x: i % SKIN, y: Math.floor(i / SKIN) });
  const mirrorOf = i => { const { x, y } = xy(i); const m = mirrorTexel(x, y, model); return m ? m.y * SKIN + m.x : -1; };

  /** What the current tool would change with the pointer at t, as a mask — or null. */
  function maskFor(t) {
    const i = resolve(t);
    if (i < 0) return null;
    const reach = reachable(), d = work.data, o = original.data;
    if (tool === 'erase' || tool === 'restore') {
      const m = new Uint8Array(SKIN * SKIN);
      for (const k of mirror ? [i, mirrorOf(i)] : [i]) {
        if (k < 0 || !reach[k]) continue;
        const differs = d[k * 4] !== o[k * 4] || d[k * 4 + 1] !== o[k * 4 + 1] || d[k * 4 + 2] !== o[k * 4 + 2] || d[k * 4 + 3] !== o[k * 4 + 3];
        if (tool === 'erase' ? d[k * 4 + 3] : differs) m[k] = 1;
      }
      return m;
    }
    if (!shown.data[i * 4 + 3] || !reach[i]) return null;          // nothing there to match
    const rgb = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
    if (tool === 'colour') return colourMask(work, rgb, tolerance(tol), reach);
    if (tool === 'skin') return skinMask(work, [rgb], tolerance(Math.max(tol, 18)), reach);
    const m = new Uint8Array(SKIN * SKIN);
    for (const k of mirror ? [i, mirrorOf(i)] : [i]) {
      if (k < 0 || !reach[k]) continue;
      const { x, y } = xy(k);
      const w = wandSelect(work, x, y, tolerance(tol), model);
      if (w) for (let j = 0; j < w.length; j++) if (w[j] && reach[j]) m[j] = 1;
    }
    return m;
  }

  /* ---- The model: what is kept, on the grey mannequin -------------------- */
  const stage = createStage({ paint: true, onStroke, onHover });
  stage.setModel(model === 'slim');
  const count = h('.mk-count');
  let preview = null, hoverT = null, hoverKey = -2;
  const hiddenViewParts = () => {
    const out = ['cape'];
    for (const p of PARTS) {
      if (hidden.has(p)) out.push(VIEW_PART.inner[p], VIEW_PART.outer[p]);
      else if (!showOuter) out.push(VIEW_PART.outer[p]);
    }
    return out;
  };
  const repaint = rafBatch(() => {
    const disp = new Uint8ClampedArray(shown.data);
    let n = 0, going = 0;
    for (let i = 0; i < SKIN * SKIN; i++) if (shown.data[i * 4 + 3]) n++;
    if (preview) {
      const c = tool === 'restore' ? COMES_BACK : GOES;
      for (let i = 0; i < preview.length; i++) {
        if (!preview[i]) continue;
        disp[i * 4] = c[0]; disp[i * 4 + 1] = c[1]; disp[i * 4 + 2] = c[2]; disp[i * 4 + 3] = 255;
        going++;
      }
    }
    count.replaceChildren(
      h('span', { text: n ? `${n.toLocaleString()} pixels kept` : 'Nothing kept yet — tick a part on the right.' }),
      ...(going ? [h(tool === 'restore' ? 'b.back' : 'b', { text: ` · a click ${tool === 'restore' ? 'brings back' : 'takes'} ${going.toLocaleString()}` })] : []),
    );
    stage.setTexture(atlas(composeSkin(ghostSkin(model), model, [{ pixels: disp, hideUnder: false }]), null));
    stage.setHidden(hiddenViewParts());
  });
  /** The pixels changed: what shows, what the preview would take, the counts. */
  const changed = () => { shown = kept(); preview = hoverT ? maskFor(hoverT) : null; repaint(); };
  function onHover(t) {
    const key = t ? t.y * SKIN + t.x : -1;
    if (key === hoverKey || stroke) return;
    hoverKey = key; hoverT = t;
    preview = t ? maskFor(t) : null;
    repaint();
  }
  const refreshPreview = () => { hoverKey = -2; preview = hoverT ? maskFor(hoverT) : null; repaint(); };

  /* ---- Erasing ------------------------------------------------------------ */
  let stroke = null;
  function pushUndo(snap) { undos.push(snap); if (undos.length > 60) undos.shift(); redos.length = 0; syncHist(); }
  function onStroke(phase, t) {
    if (phase === 'start') { stroke = { snap: new Uint8ClampedArray(work.data), changed: false }; apply(t); }
    else if (phase === 'move' && stroke) { if (!CLICK_TOOLS.has(tool)) apply(t); hoverT = t; }
    else if (phase === 'end' && stroke) { if (stroke.changed) pushUndo(stroke.snap); stroke = null; changed(); }
  }
  function apply(t) {
    const m = maskFor(t);
    if (!m) return;
    const d = work.data, o = original.data;
    let n = 0;
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      if (tool === 'restore') d.set(o.subarray(i * 4, i * 4 + 4), i * 4);
      else d[i * 4 + 3] = 0;
      n++;
    }
    if (n && stroke) { stroke.changed = true; shown = kept(); preview = null; repaint(); }
  }
  const same = () => work.data.every((v, i) => v === original.data[i]);
  function undo() { const p = undos.pop(); if (!p) return; redos.push(new Uint8ClampedArray(work.data)); work.data.set(p); syncHist(); changed(); }
  function redo() { const p = redos.pop(); if (!p) return; undos.push(new Uint8ClampedArray(work.data)); work.data.set(p); syncHist(); changed(); }
  function startOver() {
    if (same()) { toast({ title: 'Nothing erased yet', message: 'Start over brings back everything you erased. There is nothing to bring back.', kind: 'info', duration: 2200 }); return; }
    pushUndo(new Uint8ClampedArray(work.data));
    work.data.set(original.data);
    changed();
    toast({ title: 'Back to the whole skin', message: 'Everything erased is back. Undo if you did not mean it.', kind: 'info', duration: 2400 });
  }
  const labelled = (iconName, text, onclick, tip) => h('button.btn.btn-sm', { onclick, 'data-tip': tip }, raw(icon(iconName, 13)), h('span', { text }));
  const undoBtn = labelled('undo', 'Undo', undo, '⌘Z');
  const redoBtn = labelled('redo', 'Redo', redo, '⇧⌘Z');
  const resetBtn = h('button.btn.btn-sm.mk-reset', { onclick: startOver, 'data-tip': 'Bring back everything you erased' }, raw(icon('refresh', 13)), h('span', { text: 'Start over' }));
  function syncHist() { undoBtn.disabled = !undos.length; redoBtn.disabled = !redos.length; }

  const toolHint = h('.mk-hint', { text: ERASE_HINT[tool] });
  const tolField = h('.field',
    h('label', { text: 'How close a colour counts' }),
    slider({ min: 0, max: 100, value: tol, format: v => (v < 12 ? 'exact' : v < 40 ? 'close' : v < 70 ? 'loose' : 'very loose'),
      onInput: v => { tol = v; refreshPreview(); }, onChange: v => { tol = v; refreshPreview(); } }),
  );
  const toolSeg = segmented({ options: ERASE_TOOLS, value: tool, block: true, onChange: v => setTool(v) });
  function setTool(v) {
    tool = v;
    toolSeg.set?.(v);
    toolHint.textContent = ERASE_HINT[v];
    tolField.hidden = !CLICK_TOOLS.has(v);
    refreshPreview();
  }
  const mirrorBtn = h('button.btn.btn-sm', {
    'aria-pressed': 'false', 'data-tip': 'Erase both sides at once  M',
    onclick: () => { mirror = !mirror; mirrorBtn.setAttribute('aria-pressed', String(mirror)); refreshPreview(); },
  }, raw(icon('symmetry', 13)), h('span', { text: 'Mirror' }));

  /* ---- Showing and hiding parts ------------------------------------------ */
  const partSyncs = [];
  const partBtn = (label, isOn, flip) => {
    const b = h('button.btn.btn-sm.part-chip');
    const sync = () => {
      const on = isOn();
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('data-tip', on ? `Hide the ${label.toLowerCase()} — to reach what is behind it` : `Show the ${label.toLowerCase()}`);
      b.replaceChildren(raw(icon(on ? 'eye' : 'eyeOff', 12)), h('span', { text: label }));
    };
    b.onclick = () => { flip(); sync(); changed(); };
    sync();
    partSyncs.push(sync);
    return b;
  };
  const partsRow = h('.part-chips',
    h('span.eyebrow', { text: 'Show' }),
    ...SHOW_PARTS.map(([p, label]) => partBtn(label, () => !hidden.has(p), () => { if (hidden.has(p)) hidden.delete(p); else hidden.add(p); })),
    partBtn('Outer layer', () => showOuter, () => { showOuter = !showOuter; }),
    h('button.btn.btn-sm.btn-ghost', { onclick: () => { hidden.clear(); showOuter = true; partSyncs.forEach(f => f()); changed(); } }, 'Show all'),
  );

  /* ---- What to keep -------------------------------------------------------- */
  const keptChanged = () => { syncCat(); changed(); };
  const boxes = { inner: {}, outer: {} };
  const grid = h('.maker-grid',
    h('span'), h('span.eyebrow', { text: 'Base layer' }), h('span.eyebrow', { text: 'Outer layer' }),
    ...PARTS.flatMap(part => [
      h('span.body-sm', { text: PART_LABEL[part] }),
      boxes.inner[part] = checkbox({ label: '', checked: keep.inner[part], onChange: v => { keep.inner[part] = v; keptChanged(); } }),
      boxes.outer[part] = checkbox({ label: content[part] ? '' : 'empty', checked: keep.outer[part], onChange: v => { keep.outer[part] = v; keptChanged(); } }),
    ]),
  );
  const applyPreset = pr => {
    for (const layer of ['inner', 'outer']) for (const part of PARTS) {
      keep[layer][part] = pr[layer].includes(part);
      boxes[layer][part].querySelector('input').checked = keep[layer][part];
    }
    keptChanged();
  };

  const m = modal({
    title: 'Make an item',
    subtitle: 'Keep the parts that are clothes and erase the rest — their skin, their hands. Then keep it as one item, or split it into pieces.',
    icon: 'sparkle', width: 'xwide',
    body: h('.mk',
      h('.mk-left',
        h('.mk-stage', stage.el),
        partsRow,
        toolSeg,
        toolHint,
        tolField,
        h('.mk-bar', undoBtn, redoBtn, mirrorBtn, h('.spacer'), resetBtn),
        count,
      ),
      h('.col.g-4.mk-right',
        h('.form-grid',
          field('Name', textInput({ value: nm, maxlength: 60, onInput: v => { nm = v; } })),
          field('Shelf', shelfSel, 'For one item. Pieces pick their own.'),
        ),
        field('Keep', grid, 'Everything but the head, both layers, to start with. Untick what is not clothes, then erase what is left of their skin.'),
        h('.row.g-1.wrap', ...Object.values(KEEP_PRESETS).map(pr => h('button.btn.btn-sm', { onclick: () => applyPreset(pr) }, pr.label))),
        h('.mk-tip',
          h('.strong', { text: 'Losing their skin' }),
          h('p', { text: 'Pick Skin and hover a hand: every shade of that skin lights up pink, wherever it is. Click, and it all goes. Too much? Undo, and slide “How close” to the left.' }),
          h('p', { text: 'To reach the inside of an arm or the side of the body, hide what is in the way under Show. Hidden parts are left alone by every tool.' }),
        ),
      ),
    ),
    actions: [
      { label: 'Cancel' },
      { label: 'Split into pieces…', run: () => {
          const img = kept();
          if (isEmpty(img)) { toast({ title: 'Keep at least one part', kind: 'warn' }); return false; }
          queueMicrotask(() => openSplitDialog({ img, model, name: nm.trim() || name, source, wear: !!state.project }));
        } },
      { label: state.project ? 'Make it and wear it' : 'Make one item', primary: true, run: async () => {
          const img = kept();
          if (isEmpty(img)) { toast({ title: 'Keep at least one part', kind: 'warn' }); return false; }
          const rec = await addItem({ name: nm.trim() || 'My item', cat, img, split: 0.5, source });
          if (state.project) toggleWear(`item:${rec.id}`);
          toast({ title: 'Item made', message: `${rec.name} is on the ${CATEGORIES.find(c => c.id === cat)?.label || ''} shelf, and under Yours.`, kind: 'ok' });
        } },
    ],
    onClose: () => stage.dispose(),
  });
  m.el.classList.add('modal-maker');
  m.el.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (hasMod(e) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (hasMod(e) || e.altKey) return;
    if (TOOL_KEYS[k]) { e.preventDefault(); setTool(TOOL_KEYS[k]); }
    else if (k === 'm') { e.preventDefault(); mirrorBtn.click(); }
  });
  syncHist();
  changed();
}

/**
 * Cut an item image into a hat, a top, bottoms and shoes — each its own
 * item on its own shelf — and, if there is more than one, save them together
 * as a look. Given an existing item, the pieces replace it everywhere it is
 * worn, tints and all.
 */
export function openSplitDialog({ item = null, img = item?.img, model = 'classic', name = item?.name || 'My look', source = item?.source || { kind: 'file' }, wear = false } = {}) {
  if (!img) return;
  let shoeRows = guessShoeRows(img, model);
  const prefix = /[’']s look$/i.test(name) ? name.replace(/ look$/i, '') : name;
  const choice = Object.fromEntries(PIECES.map(p => [p.id, { on: true, name: `${prefix} ${p.label.toLowerCase()}`, cat: p.cat }]));
  let makeLook = true, keepOriginal = false;
  let lookName = /look$/i.test(name) ? name : `${name} look`;
  let pieces = [];

  const grid = h('.split-grid');
  const summary = h('.caption.muted');
  const lookRow = h('.col.g-2');

  function card(p) {
    const c = choice[p.id];
    const skin = composeSkin(ghostSkin(model), model, [{ pixels: p.img.data, hideUnder: false }]);
    const pic = renderScene({ skin, slim: model === 'slim', focus: p.id === 'hat' ? 'head' : 'body', view: 'card', px: 150 }) || flatCanvas(p.img, 2);
    const el = h('.split-card', { dataset: { off: String(!c.on) } },
      h('.sc-pic', pic),
      checkbox({ label: `${p.label} · ${plural(p.count, 'pixel')}`, checked: c.on, onChange: v => { c.on = v; el.dataset.off = String(!v); sync(); } }),
      textInput({ value: c.name, maxlength: 60, 'aria-label': `${p.label} name`, onInput: v => { c.name = v; } }),
      selectInput({ options: shelfOptions(), value: c.cat, 'aria-label': `${p.label} shelf`, onChange: v => { c.cat = v; } }),
    );
    return el;
  }
  function sync() {
    const n = pieces.filter(p => choice[p.id].on).length;
    summary.textContent = pieces.length < 2
      ? 'All of it falls on one part of the body, so there is only one piece.'
      : `${plural(n, 'item')} will be made${n > 1 && makeLook ? ', and saved together as a look' : ''}.`;
    lookRow.hidden = n < 2;
  }
  function paint() {
    pieces = splitPieces(img, model, shoeRows);
    grid.replaceChildren(...pieces.map(card));
    sync();
  }

  const lookInput = textInput({ value: lookName, maxlength: 60, 'aria-label': 'Look name', onInput: v => { lookName = v; } });
  lookRow.append(
    checkbox({ label: 'Also save them together as a look', checked: makeLook, onChange: v => { makeLook = v; lookInput.disabled = !v; sync(); } }),
    lookInput,
    h('.caption.muted', { text: 'Looks are on their own shelf: one click puts every piece on at once. The pieces are still separate items, each tintable on its own.' }),
  );

  modal({
    title: 'Split into pieces', icon: 'scissors', width: 'xwide',
    subtitle: 'Cut where the body is cut: the head is the hat, the body and arms the top, the legs the bottoms — and the last rows of the legs the shoes.',
    body: h('.col.g-4',
      grid,
      field('Shoes', h('.row.g-2', stepper({ value: shoeRows, min: 0, max: 6, width: 40, onChange: v => { shoeRows = v; paint(); } }), h('span.caption', { text: 'rows at the bottom of each leg' })),
        'Guessed from where the trouser colour stops. 0 leaves the shoes on the bottoms.'),
      lookRow,
      item ? checkbox({ label: `Keep “${item.name}” in one piece too`, checked: false, onChange: v => { keepOriginal = v; } }) : null,
      summary,
    ),
    actions: [
      { label: 'Cancel' },
      { label: 'Make the pieces', primary: true, async: true, run: async () => {
          const chosen = pieces.filter(p => choice[p.id].on);
          if (!chosen.length) { toast({ title: 'Pick at least one piece', kind: 'warn' }); return false; }
          const split = item?.split ?? 0.5;
          const oldLayer = item ? itemLayer(item) : null;
          // Every piece keeps the whole's colour groups, numbers and all, so a
          // tint on the whole means the same thing on each piece.
          const whole = oldLayer || layerFromPixels(img, split);
          const groups = { map: whole.group, defs: whole.groups };
          const worn = item && state.project?.items.find(w => w.ref === `item:${item.id}`);
          const made = [];
          for (const p of chosen) made.push(await addItem({ name: choice[p.id].name.trim() || p.label, cat: choice[p.id].cat, img: p.img, split, source, groups }));
          let look = null;
          if (makeLook && made.length > 1) {
            look = await addLook({
              name: lookName.trim() || 'A look',
              items: made.map(r => ({ ref: `item:${r.id}`, tints: worn ? remapTints(oldLayer, itemLayer(r), worn.tints) : {} })),
            });
          }
          if (item && !keepOriginal) {
            await replaceWithPieces(`item:${item.id}`, oldLayer, made);
            await deleteOwn('item', item.id);
          } else if (wear && state.project) {
            for (const r of made) ensureWorn(`item:${r.id}`);
          }
          toast({
            title: `${plural(made.length, 'item')} made`,
            message: look ? `Each is on its own shelf, and all of them are under Looks as “${look.name}”.`
              : made.length > 1 ? 'Each is on its own shelf, and under Yours.' : `${made[0].name} is on its shelf, and under Yours.`,
            kind: 'ok',
          });
        } },
    ],
  });
  paint();
}

/**
 * Paint any item: your own directly; a preset by making your own copy of it
 * first. It is put on if it is not worn, and Paint opens on it.
 */
export async function openItemInPaint(ref) {
  const o = state.project;
  if (!o) return;
  const r = resolveItem(ref, modelOf(o));
  if (!r) return;
  if (r.kind === 'preset') {
    const ok = await confirmDialog({
      title: `Paint ${r.name}?`,
      message: 'Presets are drawn by the app and stay as they are. This makes your own copy — the same look, in the colours it has on this outfit — worn in its place, and that you can paint however you like.',
      confirmLabel: 'Make it mine and paint',
    });
    if (!ok) return;
  }
  const w = ensureWorn(ref);
  if (!w) return;
  if (r.kind === 'preset') await adoptPreset(w.key);
  state.paint.target = w.key;
  setRoute('paint', { force: true });
}

/* ========================================================================= */
/* CAPES                                                                     */
/* ========================================================================= */

export async function importCapeFile(file) {
  try {
    const { img, scaled } = normalizeCape(await decodeImage(file));
    const rec = await addCape({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'My cape', img, source: { kind: 'file', name: file.name } });
    if (state.project) setCape(`cape:${rec.id}`);
    toast({ title: 'Cape added', message: `${scaled ? 'Scaled to 64×32. ' : ''}${state.project ? 'It is on.' : 'It is with your capes.'}`, kind: 'ok' });
  } catch (e) {
    toast({ title: 'That is not a cape', message: e.message, kind: 'error' });
  }
}

export function openCapeFileDialog() {
  modal({
    title: 'Import a cape', subtitle: 'A 64×32 cape PNG — or an HD one, which is scaled down.', icon: 'upload',
    body: ({ close }) => dropzone({
      label: 'Drop a cape PNG', hint: 'or click to choose one', accept: 'image/png,image/*',
      onFiles: fs => { close(); importCapeFile(fs[0]); },
    }),
    actions: [{ label: 'Cancel' }],
  });
}

/** A PNG dropped anywhere: work out what it could be, and ask if it could be more than one thing. */
export async function openDroppedImage(file) {
  let img;
  try { img = await decodeImage(file); } catch { toast({ title: 'Could not read that image', message: file.name, kind: 'error' }); return; }
  const { width: w, height: ht } = img;
  const skinLike = (w === ht || w === ht * 2) && w >= 64 && w % 64 === 0;
  const capeLike = (w === ht * 2 && w % 64 === 0) || (w <= 64 && ht <= 32 && w >= 22 && ht >= 17);
  const choices = [];
  if (skinLike) {
    choices.push({ icon: 'image', label: 'A base skin', desc: 'Something to build outfits on.', run: () => importSkinFile(file, { mode: 'base' }) });
    choices.push({ icon: 'sparkle', label: 'Items', desc: 'Keep its clothes, erase the rest, and wear them over any skin.', run: () => importSkinFile(file, { mode: 'item' }) });
  }
  if (capeLike) choices.push({ icon: 'layers', label: 'A cape', desc: w === 64 && ht === 32 ? 'Old skins are 64×32 too — pick this if it is a cape.' : 'Wear it on any outfit.', run: () => importCapeFile(file) });
  if (!choices.length) { toast({ title: 'Not a skin or a cape', message: `${w}×${ht} — skins are 64×64, capes 64×32.`, kind: 'warn' }); return; }
  const m = modal({
    title: 'What is this?', subtitle: `${file.name} · ${w}×${ht}`, icon: 'image',
    body: h('.choice-list', ...choices.map(c => h('button.choice', { onclick: () => { m.close(); c.run(); } },
      h('span.ch-icon', raw(icon(c.icon, 18))),
      h('.col', h('.strong', { text: c.label }), h('.caption', { text: c.desc })),
    ))),
    actions: [{ label: 'Cancel' }],
  });
}

/* ========================================================================= */
/* BASES                                                                     */
/* ========================================================================= */

function baseTile(b, { selected = false, onPick, menu } = {}) {
  const pic = renderScene({ skin: b.img, slim: b.model === 'slim', view: 'front', px: 112 }) || faceCanvas(b.img, 8);
  const used = outfitsUsingBase(b.id).length;
  const src = b.source?.kind === 'player' ? `${b.source.name}’s skin` : b.source?.kind === 'starter' ? 'Starter' : 'From a file';
  return h('button.base-tile', {
    'aria-pressed': String(selected),
    onclick: onPick,
    oncontextmenu: menu ? e => { e.preventDefault(); menu({ x: e.clientX, y: e.clientY }); } : null,
  },
    h('.bt-pic', pic),
    h('.bt-name.truncate', { text: b.name }),
    h('.bt-meta.truncate', { text: `${b.model === 'slim' ? 'Slim' : 'Classic'} · ${used ? plural(used, 'outfit') : src}` }),
    menu ? h('span.btn.btn-sm.btn-icon.btn-ghost.bt-menu', {
      role: 'button', 'aria-label': 'More', onclick: e => { e.stopPropagation(); menu(e.currentTarget); },
    }, raw(icon('more', 14))) : null,
  );
}

const sourceTile = (iconName, label, run) => h('button.base-tile.base-tile-new', { onclick: run },
  h('.bt-pic', raw(icon(iconName, 22))), h('.bt-name', { text: label }));

export function openNewOutfitDialog() {
  let name = 'New outfit';
  let baseId = state.project?.baseId || firstBaseId();
  const grid = h('.base-grid');
  let m;
  const paint = () => grid.replaceChildren(
    ...basesSorted().map(b => baseTile(b, { selected: b.id === baseId, onPick: () => { baseId = b.id; paint(); } })),
    sourceTile('search', 'A player’s skin', () => { m.close(); openPlayerDialog({ mode: 'outfit' }); }),
    sourceTile('upload', 'A skin PNG', () => { m.close(); openSkinFileDialog({ mode: 'base' }); }),
    sourceTile('sparkle', 'The mannequin', async () => { const b = await addStarterBase(); baseId = b.id; paint(); }),
  );
  paint();
  const nameInput = textInput({ value: name, 'data-autofocus': '', onInput: v => { name = v; } });
  m = modal({
    title: 'New outfit', icon: 'plus', width: 'wide',
    subtitle: 'An outfit is a base skin and whatever you wear over it. Pick the base — the clothes come next.',
    body: h('.col.g-4', field('Name', nameInput), field('Base skin', grid)),
    actions: [
      { label: 'Cancel' },
      { label: 'Create outfit', primary: true, run: async () => {
          if (!baseId) { toast({ title: 'Pick a base skin first', kind: 'warn' }); return false; }
          await newProject({ name: name.trim() || 'New outfit', baseId });
          setRoute('dress', { force: true });
        } },
    ],
  });
  queueMicrotask(() => nameInput.select());
}

async function refreshBase(b) {
  try {
    const p = await fetchPlayer(b.source.uuid || b.source.name);
    if (samePixels(b.pixels, p.skinImg.data) && b.model === p.model) { toast({ title: 'Already up to date', message: `${p.name}’s skin has not changed.`, kind: 'info' }); return; }
    const ok = await confirmDialog({
      title: `Replace with ${p.name}’s current skin?`,
      message: 'Anything you painted on this base is replaced too. Every outfit built on it changes.',
      confirmLabel: 'Replace',
    });
    if (!ok) return;
    b.pixels.set(p.skinImg.data);
    b.model = p.model;
    b.source = playerSource(p);
    await saveBase(b);
    bus.emit('bases');
    bus.emit('base:painted', b.id);
    if (state.project?.baseId === b.id) outfitChanged('base');
    toast({ title: 'Updated', message: `${b.name} is ${p.name}’s skin as it is today.`, kind: 'ok' });
  } catch (e) {
    toast({ title: 'Could not refresh it', message: e.message, kind: 'error' });
  }
}

function baseMenu(b, at) {
  const used = outfitsUsingBase(b.id).length;
  contextMenu([
    { label: 'Rename…', icon: 'edit', run: async () => {
        const v = await promptDialog({ title: 'Rename base skin', value: b.name, confirmLabel: 'Rename' });
        if (v?.trim()) renameBase(b.id, v.trim());
      } },
    { label: 'Duplicate', icon: 'duplicate', run: () => addBase({ name: `${b.name} copy`, model: b.model, img: b.img, source: b.source }) },
    b.source?.kind === 'player' ? { label: `Refresh from ${b.source.name}’s account`, icon: 'refresh', run: () => refreshBase(b) } : null,
    { label: 'Make items from it…', icon: 'sparkle', run: () => openItemMaker(b.img, { name: `${b.name}’s look`, model: b.model, source: b.source }) },
    '-',
    { label: used ? `Used by ${plural(used, 'outfit')}` : 'Delete…', icon: 'trash', destructive: !used, disabled: !!used, run: async () => {
        const ok = await confirmDialog({ title: `Delete “${b.name}”?`, message: 'The skin is removed from this browser.', confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        try { await deleteBase(b.id); } catch (e) { toast({ title: 'Could not delete it', message: e.message, kind: 'warn' }); }
      } },
  ], at);
}

/** Every base skin: pick the open outfit's, and manage the rest. */
export function openBasePicker() {
  const grid = h('.base-grid');
  let m;
  const paint = () => grid.replaceChildren(
    ...basesSorted().map(b => baseTile(b, {
      selected: b.id === state.project?.baseId,
      onPick: () => {
        if (!state.project) return;
        setOutfitBase(b.id);
        m.close();
      },
      menu: at => baseMenu(b, at),
    })),
    sourceTile('search', 'A player’s skin', () => openPlayerDialog({ mode: 'base' })),
    sourceTile('upload', 'A skin PNG', () => openSkinFileDialog({ mode: 'base' })),
    sourceTile('sparkle', 'The mannequin', () => addStarterBase(state.project ? (state.bases.get(state.project.baseId)?.model || 'classic') : 'classic')),
  );
  paint();
  const off = bus.on('bases', () => { if (grid.isConnected) paint(); else off(); });
  m = modal({
    title: 'Base skins', icon: 'layers', width: 'wide',
    subtitle: state.project
      ? `Pick what ${state.project.name} is worn over. Paint a base and every outfit on it changes with it.`
      : 'Every outfit is worn over one of these. Paint a base and every outfit on it changes with it.',
    body: grid,
    actions: [{ label: 'Done', primary: true }],
    onClose: () => off(),
  });
}
