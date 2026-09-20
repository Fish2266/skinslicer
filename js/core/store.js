/* ============================================================================
   Store — app state, the wardrobe's contents, subscriptions and autosave.
   The same shape as Frame & Groove's, with an outfit where a pack would be.

   Four kinds of thing live beside the outfits and are shared between them:
   bases (the skins everything is worn over), your own items, your capes, and
   looks (a few items saved together, to put on in one go). All small — a
   64×64 or 64×32 sheet each, or a list of refs — so they are loaded whole at
   boot and kept in memory. The official capes are Mojang's textures, fetched
   once by hash and kept in the cache store.
   ========================================================================= */

import { Outfits, Bases, Items, Capes, Looks, Prefs, Cache, requestPersistence } from './db.js';
import { syncThemeColor } from './themecolor.js';
import { debounce, uid } from './util.js';
import { createOutfit, outfitToJSON, outfitFromJSON, outfitStats, migrate, findWorn, wornEntry, cleanTints } from '../skin/outfit.js';
import { presetLayer, presetById } from '../skin/items.js';
import { presetCapeLayer, presetCapeById, OFFICIAL_CAPES, officialCapeById, capeTextureURL } from '../skin/capes.js';
import { layerFromPixels, layerFromGroups, remapTints, recolor, skinPalette } from '../skin/tint.js';
import { composeSkin, composeCape } from '../skin/compose.js';
import { decodeImage, normalizeCape } from '../skin/image.js';
import { layout, box, faceRect, SKIN } from '../skin/layout.js';
import { starterSkin } from '../skin/starter.js';

/* ---- Tiny emitter ------------------------------------------------------- */
class Emitter {
  #m = new Map();
  on(evt, fn) {
    if (!this.#m.has(evt)) this.#m.set(evt, new Set());
    this.#m.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  once(evt, fn) { const off = this.on(evt, (...a) => { off(); fn(...a); }); return off; }
  off(evt, fn) { this.#m.get(evt)?.delete(fn); }
  emit(evt, ...a) {
    const s = this.#m.get(evt);
    if (s) for (const fn of [...s]) { try { fn(...a); } catch (e) { console.error(`[bus:${evt}]`, e); } }
  }
}
export const bus = new Emitter();

export function bindLive(el, evt, handler) {
  const off = bus.on(evt, (...args) => {
    if (!el.isConnected) { off(); return; }
    handler(...args);
  });
  return off;
}

/* ========================================================================= */
/* APP STATE                                                                 */
/* ========================================================================= */

export const state = {
  ready: false,
  route: 'outfits',            // outfits | dress | paint | export
  project: null,               // the open outfit
  projectDirty: false,
  saving: false,
  lastSavedAt: 0,
  library: [],                 // outfit index records
  bases: new Map(),            // id -> { id, name, model, pixels, img, source, … }
  items: new Map(),            // your own items
  capes: new Map(),            // your own capes
  looks: new Map(),            // id -> { id, name, items: [{ ref, tints }] }
  official: new Map(),         // official cape id -> { id, img }, once fetched
  officialFailed: new Set(),   // ids that did not arrive (offline, most likely)
  capeSplits: {},              // official cape id -> how readily its colours split
  ownedCapes: new Set(),       // official cape ids you have said your account has
  selWear: null,               // key of the worn item open in the inspector
  catalog: { cat: 'hats', q: '' },
  // target: 'base', or the key of a worn item — what the brush paints.
  paint: { tool: 'pencil', color: '#E0784A', layer: 'inner', mirror: false, recent: [], showItems: true, target: 'base', size: 1, rectFill: false },
  prefs: {
    theme: 'deepslate',
    grain: true,
    textures: true,
    sound: true,
    soundVolume: 55,
    reduceMotion: false,
    turntable: false,           // spin the model slowly on the Dress stage
    firstRun: true,
  },
};

export function setRoute(route, opts = {}) {
  if (state.route === route && !opts.force) return;
  state.route = route;
  bus.emit('route', route, opts);
}

export function markDirty(reason = 'edit') {
  if (!state.project) return;
  state.projectDirty = true;
  bus.emit('project:dirty', reason);
  scheduleSave();
}

/* ---- Preferences -------------------------------------------------------- */
export async function loadPrefs() {
  const stored = await Prefs.get('prefs', null);
  if (stored) Object.assign(state.prefs, stored);
  const paint = await Prefs.get('paint', null);
  if (paint) Object.assign(state.paint, paint, { tool: state.paint.tool });
  state.capeSplits = (await Prefs.get('capeSplits', null)) || {};
  state.ownedCapes = new Set((await Prefs.get('ownedCapes', null)) || []);
  applyPrefs();
}
export const savePrefs = debounce(() => Prefs.set('prefs', { ...state.prefs }), 350);
export const savePaintPrefs = debounce(() => Prefs.set('paint', {
  color: state.paint.color, recent: state.paint.recent, mirror: state.paint.mirror, size: state.paint.size, rectFill: state.paint.rectFill,
}), 500);

export function setPref(key, value) {
  state.prefs[key] = value;
  applyPrefs();
  savePrefs();
  bus.emit('prefs', key, value);
}

export function applyPrefs() {
  const root = document.documentElement;
  root.dataset.theme = state.prefs.theme || 'deepslate';
  syncThemeColor('skinslicer:theme');   // the iOS status bar follows the page background
  document.body.dataset.grain = state.prefs.grain ? 'on' : 'off';
  root.dataset.textures = state.prefs.textures === false ? 'off' : 'on';
  if (state.prefs.reduceMotion) root.style.setProperty('--d-base', '0ms');
  else root.style.removeProperty('--d-base');
}

/* ========================================================================= */
/* OUTFITS                                                                   */
/* ========================================================================= */

export async function refreshLibrary() {
  state.library = await Outfits.list();
  bus.emit('library', state.library);
  return state.library;
}

function indexRecord(outfit) {
  const s = outfitStats(outfit);
  return {
    id: outfit.id,
    name: outfit.name,
    baseId: outfit.baseId,
    createdAt: outfit.createdAt,
    updatedAt: Date.now(),
    items: s.items,
    cape: s.cape,
    doc: outfitToJSON(outfit),
  };
}

export async function saveProject({ silent = false } = {}) {
  if (!state.project) return;
  state.saving = true;
  if (!silent) bus.emit('save:state', 'saving');
  try {
    state.project.updatedAt = Date.now();
    const rec = indexRecord(state.project);
    await Outfits.save(rec);
    const i = state.library.findIndex(r => r.id === rec.id);
    if (i >= 0) state.library[i] = rec; else state.library.unshift(rec);
    state.projectDirty = false;
    state.lastSavedAt = Date.now();
    bus.emit('save:state', 'saved');
    bus.emit('project:saved', state.project);
  } catch (e) {
    console.error('save failed', e);
    bus.emit('save:state', 'error', e);
    throw e;
  } finally {
    state.saving = false;
  }
}

export const scheduleSave = debounce(() => { saveProject({ silent: true }).catch(() => {}); }, 700);

function adopt(outfit) {
  state.project = outfit;
  state.projectDirty = false;
  state.selWear = null;
  state.paint.target = 'base';
  if (!state.bases.has(outfit.baseId)) outfit.baseId = firstBaseId();
}

export async function openProject(id) {
  if (state.project && state.projectDirty) { try { await saveProject({ silent: true }); } catch {} }
  const rec = await Outfits.get(id);
  if (!rec) throw new Error('That outfit is no longer in your wardrobe.');
  const o = outfitFromJSON(rec.doc);
  o.id = rec.id;
  adopt(o);
  bus.emit('project:open', o);
  await Prefs.set('lastProject', id);
  return o;
}

export async function newProject(opts = {}) {
  const o = createOutfit({ ...opts, baseId: opts.baseId || firstBaseId() });
  return adoptProject(o);
}

export async function adoptProject(outfit) {
  if (state.project && state.projectDirty) { try { await saveProject({ silent: true }); } catch {} }
  adopt(outfit);
  await saveProject({ silent: true });
  await refreshLibrary();
  /* The first outfit is when there is something worth keeping: ask the
     browser not to clear this site's storage when it runs short of space.
     Chrome decides quietly; Firefox asks the person. */
  if (state.library.length === 1) requestPersistence().catch(() => {});
  bus.emit('project:open', outfit);
  await Prefs.set('lastProject', outfit.id);
  return outfit;
}

export async function closeProject() {
  if (state.projectDirty) { try { await saveProject({ silent: true }); } catch {} }
  state.project = null;
  bus.emit('project:close');
  await Prefs.remove('lastProject');
}

export async function deleteProject(id) {
  await Outfits.remove(id);
  if (state.project?.id === id) { state.project = null; bus.emit('project:close'); await Prefs.remove('lastProject'); }
  await refreshLibrary();
}

export async function duplicateProject(id, name) {
  const rec = await Outfits.get(id);
  if (!rec) return null;
  const o = outfitFromJSON(rec.doc);
  o.id = uid('fit');
  o.name = name || `${o.name} copy`;
  o.createdAt = Date.now();
  for (const w of o.items) w.key = uid('w');
  await Outfits.save({ ...indexRecord(o), createdAt: o.createdAt });
  await refreshLibrary();
  return o.id;
}

/** Rewrite every stored outfit — for removing or replacing something they all refer to. */
async function rewriteOutfits(fn) {
  for (const rec of state.library) {
    const o = rec.id === state.project?.id ? state.project : outfitFromJSON(rec.doc);
    if (!fn(o)) continue;
    if (o === state.project) { markDirty('rewrite'); continue; }
    await Outfits.save({ ...rec, ...indexRecord(o), updatedAt: rec.updatedAt });
  }
  await refreshLibrary();
}

/* ========================================================================= */
/* BASES                                                                     */
/* ========================================================================= */

function hydrate(rec, w, h) {
  // The ImageData shares the stored buffer, so painting it edits the record.
  const pixels = rec.pixels instanceof Uint8ClampedArray ? rec.pixels : new Uint8ClampedArray(rec.pixels);
  return { ...rec, pixels, img: new ImageData(pixels, w, h) };
}
/* What is stored: everything but the ImageData and whatever is worked out
   from the pixels (a layer, a palette — anything starting with _). */
const dehydrate = ({ img, layer, layerKey, ...rec }) => Object.fromEntries(Object.entries(rec).filter(([k]) => !k.startsWith('_')));

export async function loadWardrobe() {
  const [bases, items, capes, looks] = await Promise.all([Bases.all(), Items.all(), Capes.all(), Looks.all()]);
  state.bases = new Map(bases.map(b => [b.id, hydrate(b, 64, 64)]));
  state.items = new Map(items.map(i => [i.id, hydrate(i, 64, 64)]));
  state.capes = new Map(capes.map(c => [c.id, hydrate(c, 64, 32)]));
  state.looks = new Map(looks.map(l => [l.id, l]));
  await loadCachedCapes();
}

export const basesSorted = () => [...state.bases.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
export const firstBaseId = () => basesSorted()[0]?.id || null;
export const baseOf = outfit => state.bases.get(outfit?.baseId) || null;

export async function addBase({ name, model = 'classic', img, source = { kind: 'file' } }) {
  const now = Date.now();
  const rec = hydrate({
    id: uid('base'), name: name || 'Skin', model, source,
    pixels: new Uint8ClampedArray(img.data), createdAt: now, updatedAt: now,
  }, 64, 64);
  await Bases.save(dehydrate(rec));
  state.bases.set(rec.id, rec);
  bus.emit('bases');
  return rec;
}

/** The plain starter skin, made on demand. */
export async function addStarterBase(model = 'classic') {
  return addBase({ name: 'Mannequin', model, img: starterSkin(model), source: { kind: 'starter' } });
}

export async function saveBase(rec) {
  rec.updatedAt = Date.now();
  await Bases.save(dehydrate(rec));
  bus.emit('base:saved', rec.id);
}

const baseTimers = new Map();
/** Painting saves a moment after the last stroke rather than on every pixel. */
export function saveBaseSoon(rec) {
  clearTimeout(baseTimers.get(rec.id));
  baseTimers.set(rec.id, setTimeout(() => { baseTimers.delete(rec.id); saveBase(rec).catch(e => bus.emit('save:state', 'error', e)); }, 600));
  bus.emit('base:dirty', rec.id);
}
export function flushBaseSaves() {
  for (const [id, t] of baseTimers) {
    clearTimeout(t);
    const rec = state.bases.get(id);
    if (rec) saveBase(rec).catch(() => {});
  }
  baseTimers.clear();
  flushItemSaves();
}

export function outfitsUsingBase(id) {
  return state.library.filter(r => (r.id === state.project?.id ? state.project.baseId : r.baseId) === id);
}

export async function renameBase(id, name) {
  const rec = state.bases.get(id);
  if (!rec) return;
  rec.name = name;
  await saveBase(rec);
  bus.emit('bases');
}

export async function deleteBase(id) {
  if (outfitsUsingBase(id).length) throw new Error('An outfit is still built on that skin.');
  await Bases.remove(id);
  state.bases.delete(id);
  bus.emit('bases');
}

export function setOutfitBase(baseId) {
  if (!state.project || !state.bases.has(baseId)) return;
  state.project.baseId = baseId;
  outfitChanged('base');
}

/**
 * A base's own colours, biggest first — `all` for the swatch popover, and
 * `match` without the skin tone, for dressing an outfit in the skin's colours.
 */
export function basePalette(base) {
  if (!base) return { all: [], match: [] };
  const key = `${base.id}|${base.updatedAt}|${base.model}`;
  if (base._palKey !== key) {
    const { at } = layout(base.model);
    const used = new Uint8Array(SKIN * SKIN);
    for (let i = 0; i < used.length; i++) used[i] = at[i] >= 0 ? 1 : 0;
    base._pal = skinPalette(base.img, used, { faceRect: faceRect(box('head', 'inner', base.model), 'front') });
    base._palKey = key;
  }
  return base._pal;
}

/* ========================================================================= */
/* WEARING                                                                   */
/* ========================================================================= */

/** Anything that changes how the open outfit looks. */
export function outfitChanged(reason = 'edit') {
  markDirty(reason);
  bus.emit('outfit:changed', reason);
}

/** Put something on, or take it off. Returns true when it is now worn. */
export function toggleWear(ref) {
  const o = state.project;
  if (!o) return false;
  const w = findWorn(o, ref);
  if (w) {
    o.items = o.items.filter(x => x !== w);
    if (state.selWear === w.key) state.selWear = null;
  } else {
    const nw = wornEntry(ref);
    o.items.push(nw);
    state.selWear = nw.key;
  }
  outfitChanged('wear');
  return !w;
}

/** The worn entry for a ref, putting it on first if it is not. */
export function ensureWorn(ref) {
  const o = state.project;
  if (!o) return null;
  if (!findWorn(o, ref)) toggleWear(ref);
  return findWorn(o, ref);
}

export function setCape(ref) {
  const o = state.project;
  if (!o) return;
  o.cape = ref ? { ref, tints: {}, hidden: false } : null;
  outfitChanged('cape');
}

/* ========================================================================= */
/* YOUR ITEMS AND CAPES                                                      */
/* ========================================================================= */

/**
 * @param {object} o
 *   groups  optional { map, defs } — colour groups to start from (a preset's
 *           own, or the item a piece was cut from), so tints carry over exactly
 */
export async function addItem({ name, cat = 'extras', img, split = 0.5, source = { kind: 'file' }, groups = null }) {
  const now = Date.now();
  const rec = hydrate({
    id: uid('item'), name: name || 'My item', cat, split, source, rev: 0, pixels: new Uint8ClampedArray(img.data), createdAt: now, updatedAt: now,
    ...(groups ? { groupMap: new Int8Array(groups.map), groupDefs: groups.defs.map(g => ({ name: g.name, hex: g.hex })), groupSplit: split } : {}),
  }, 64, 64);
  await Items.save(dehydrate(rec));
  state.items.set(rec.id, rec);
  bus.emit('items');
  return rec;
}

/** A see-through sheet to draw a new item on from scratch. */
export const addBlankItem = ({ name, cat }) => addItem({ name, cat, img: new ImageData(SKIN, SKIN), source: { kind: 'drawn' } });

export async function addCape({ name, img, split = 0.5, source = { kind: 'file' } }) {
  const now = Date.now();
  const rec = hydrate({ id: uid('cape'), name: name || 'My cape', split, source, pixels: new Uint8ClampedArray(img.data), createdAt: now, updatedAt: now }, 64, 32);
  await Capes.save(dehydrate(rec));
  state.capes.set(rec.id, rec);
  bus.emit('capes');
  return rec;
}

/** Rename, re-shelve or re-split one of your own items or capes. */
export async function updateOwn(kind, id, patch) {
  const map = kind === 'cape' ? state.capes : state.items;
  const rec = map.get(id);
  if (!rec) return;
  Object.assign(rec, patch, { updatedAt: Date.now() });
  await (kind === 'cape' ? Capes : Items).save(dehydrate(rec));
  bus.emit(kind === 'cape' ? 'capes' : 'items');
  if (state.project) bus.emit('outfit:changed', 'own');
}

/** Delete one of your own, and take it off every outfit and look wearing it. */
export async function deleteOwn(kind, id) {
  const ref = `${kind}:${id}`;
  if (kind === 'cape') { await Capes.remove(id); state.capes.delete(id); }
  else { await Items.remove(id); state.items.delete(id); }
  await rewriteOutfits(o => {
    if (kind === 'cape') { if (o.cape?.ref !== ref) return false; o.cape = null; return true; }
    const n = o.items.length;
    o.items = o.items.filter(w => w.ref !== ref);
    return o.items.length !== n;
  });
  if (kind === 'item') {
    for (const look of [...state.looks.values()]) {
      if (!look.items.some(e => e.ref === ref)) continue;
      look.items = look.items.filter(e => e.ref !== ref);
      if (look.items.length) await Looks.save(look);
      else { await Looks.remove(look.id); state.looks.delete(look.id); }
    }
    bus.emit('looks');
  }
  bus.emit(kind === 'cape' ? 'capes' : 'items');
  if (state.project) bus.emit('outfit:changed', 'own');
}

/* ---- Painting your own items --------------------------------------------
   The brush edits an item's pixels in place. A moment after the last stroke
   the colour groups are brought up to date: every pixel that is still the
   colour it was keeps its group, and only what was painted is grouped again
   — joining a group it is close to, or starting a new one. Group numbers
   never change under a tint, so every outfit's tints stay where they were,
   and a fresh colour painted over a tinted one shows as drawn. */

/** The item's current colour groups — call before a stroke, so the next save knows what changed. */
export const itemLayer = rec => ownLayer(rec);

const itemTimers = new Map();
export function saveItemSoon(rec) {
  clearTimeout(itemTimers.get(rec.id));
  itemTimers.set(rec.id, setTimeout(() => { itemTimers.delete(rec.id); commitItemPixels(rec).catch(e => bus.emit('save:state', 'error', e)); }, 600));
}
export function flushItemSaves() {
  for (const [id, t] of itemTimers) {
    clearTimeout(t);
    const rec = state.items.get(id);
    if (rec) commitItemPixels(rec).catch(() => {});
  }
  itemTimers.clear();
}

export async function commitItemPixels(rec) {
  if (!state.items.has(rec.id)) return;
  const old = rec.layer, map = rec.groupMap, p = rec.pixels;
  // A pixel that is gone, or not the colour it was, loses its group.
  if (old && map) for (let i = 0; i < map.length; i++) {
    if (p[i * 4 + 3] < 8 || !old.alpha[i] || old.rgb[i * 3] !== p[i * 4] || old.rgb[i * 3 + 1] !== p[i * 4 + 1] || old.rgb[i * 3 + 2] !== p[i * 4 + 2]) map[i] = -1;
  }
  rec.rev = (rec.rev || 0) + 1;
  rec.updatedAt = Date.now();
  ownLayer(rec);
  await Items.save(dehydrate(rec));
  bus.emit('items');
  if (state.project) bus.emit('outfit:changed', 'own');
}

/**
 * Presets are drawn in code and cannot be painted, so painting one makes it
 * yours: a copy of it as drawn, worn in its place, its tints carried over.
 * @returns the new item record
 */
export async function adoptPreset(key) {
  const o = state.project;
  const w = o?.items.find(x => x.key === key);
  if (!w) return null;
  const r = resolveItem(w.ref, modelOf(o));
  if (!r) return null;
  if (r.kind === 'item') return r.rec;
  // The copy keeps the preset's own groups — its knit, its fold, its pom — so
  // the tints need no translating and it looks exactly as it did.
  const rec = await addItem({
    name: r.name, cat: r.cat, img: new ImageData(recolor(r.layer, {}), SKIN, SKIN), source: { kind: 'preset', id: r.id },
    groups: { map: r.layer.group, defs: r.layer.groups },
  });
  w.ref = `item:${rec.id}`;
  outfitChanged('wear');
  return rec;
}

/**
 * An item split into pieces: every outfit wearing it wears the pieces
 * instead, where it was in the order, tinted as it was.
 * @param {string} ref       the item being replaced
 * @param {object} oldLayer  its colour groups, for carrying tints
 * @param {object[]} recs    the pieces' item records
 */
export async function replaceWithPieces(ref, oldLayer, recs) {
  await rewriteOutfits(o => {
    const i = o.items.findIndex(w => w.ref === ref);
    if (i < 0) return false;
    const w = o.items[i];
    const add = recs.filter(r => !findWorn(o, `item:${r.id}`)).map(r => ({
      ...wornEntry(`item:${r.id}`), tints: remapTints(oldLayer, ownLayer(r), w.tints), hidden: w.hidden, hideUnder: w.hideUnder,
    }));
    o.items.splice(i, 1, ...add);
    return true;
  });
  if (state.project) bus.emit('outfit:changed', 'wear');
}

/* ========================================================================= */
/* LOOKS                                                                     */
/* ========================================================================= */

const lookEntry = e => ({ ref: e.ref, tints: cleanTints(e.tints) });

export async function addLook({ name, items }) {
  const now = Date.now();
  const look = { id: uid('look'), name: name || 'A look', items: items.map(lookEntry), createdAt: now, updatedAt: now };
  await Looks.save(look);
  state.looks.set(look.id, look);
  bus.emit('looks');
  return look;
}

export async function updateLook(id, patch) {
  const look = state.looks.get(id);
  if (!look) return;
  Object.assign(look, patch, { updatedAt: Date.now() });
  if (patch.items) look.items = patch.items.map(lookEntry);
  await Looks.save(look);
  bus.emit('looks');
}

export async function deleteLook(id) {
  await Looks.remove(id);
  state.looks.delete(id);
  bus.emit('looks');
}

/** The pieces of a look that still exist. */
export const lookPieces = (look, model = 'classic') => look.items.map(e => ({ ...e, r: resolveItem(e.ref, model) })).filter(e => e.r);

export const lookWorn = (look, outfit) => {
  const pieces = look.items.filter(e => resolveItem(e.ref));
  return pieces.length > 0 && pieces.every(e => findWorn(outfit, e.ref));
};

/** Put the whole look on, in its colours — or, if it is all on, take it off. Returns true when it is now on. */
export function wearLook(look) {
  const o = state.project;
  if (!o) return false;
  if (lookWorn(look, o)) {
    const refs = new Set(look.items.map(e => e.ref));
    o.items = o.items.filter(w => !refs.has(w.ref));
    if (!o.items.some(w => w.key === state.selWear)) state.selWear = null;
    outfitChanged('wear');
    return false;
  }
  for (const e of look.items) {
    if (!resolveItem(e.ref)) continue;
    let w = findWorn(o, e.ref);
    if (!w) { w = wornEntry(e.ref); o.items.push(w); }
    w.tints = { ...e.tints };
    w.hidden = false;
  }
  outfitChanged('wear');
  return true;
}

/* ========================================================================= */
/* OFFICIAL CAPES                                                            */
/* ========================================================================= */

const setOfficial = (def, pixels) => state.official.set(def.id, {
  id: def.id, img: new ImageData(pixels instanceof Uint8ClampedArray ? pixels : new Uint8ClampedArray(pixels), 64, 32),
});

async function loadCachedCapes() {
  const got = await Promise.all(OFFICIAL_CAPES.map(c => Cache.get(`cape:${c.hash}`).catch(() => null)));
  got.forEach((px, i) => { if (px?.length === 64 * 32 * 4) setOfficial(OFFICIAL_CAPES[i], px); });
}

let fetching = null;
/** Fetch whichever official capes are not cached yet. Safe to call again — it retries the ones that failed. */
export function fetchOfficialCapes() {
  if (fetching) return fetching;
  const missing = OFFICIAL_CAPES.filter(c => !state.official.has(c.id));
  if (!missing.length) return Promise.resolve();
  state.officialFailed.clear();
  const tell = debounce(() => bus.emit('capes'), 150);
  fetching = Promise.all(missing.map(async c => {
    try {
      const { img } = normalizeCape(await decodeImage(capeTextureURL(c.hash)));
      setOfficial(c, img.data);
      Cache.set(`cape:${c.hash}`, new Uint8ClampedArray(img.data)).catch(() => {});
    } catch {
      state.officialFailed.add(c.id);
    }
    tell();
  })).finally(() => {
    fetching = null;
    bus.emit('capes');
    if (state.project?.cape?.ref?.startsWith('mojang:')) bus.emit('outfit:changed', 'cape-loaded');
  });
  return fetching;
}

/**
 * Which official capes your account has. Mojang will not say without a
 * sign-in, so you say — and they go to the front of the Capes shelf.
 */
export function setCapeOwned(id, owned) {
  if (owned) state.ownedCapes.add(id); else state.ownedCapes.delete(id);
  Prefs.set('ownedCapes', [...state.ownedCapes]).catch(() => {});
  bus.emit('capes');
}

export function setCapeSplit(id, split) {
  state.capeSplits[id] = split;
  Prefs.set('capeSplits', { ...state.capeSplits }).catch(() => {});
  bus.emit('capes');
  if (state.project) bus.emit('outfit:changed', 'own');
}

/* ========================================================================= */
/* RESOLVING AND COMPOSING                                                   */
/* ========================================================================= */

/* Colour groups are worked out from the pixels the first time, then kept
   (groupMap, groupDefs) and only brought up to date when the pixels change
   (rev). Changing the split starts them again from scratch — that is what
   the slider is for. A rename touches neither. */
function ownLayer(rec, split = rec.split ?? 0.5) {
  const key = `${split}|${rec.rev || 0}`;
  if (!rec.layer || rec.layerKey !== key) {
    const n = rec.img.width * rec.img.height;
    const known = rec.groupMap?.length === n && rec.groupDefs?.length && rec.groupSplit === split
      ? { map: rec.groupMap, groups: rec.groupDefs } : null;
    rec.layer = known ? layerFromGroups(rec.img, known, split) : layerFromPixels(rec.img, split);
    rec.groupMap = new Int8Array(rec.layer.group);
    rec.groupDefs = rec.layer.groups.map(g => ({ name: g.name, hex: g.hex }));
    rec.groupSplit = split;
    rec.layerKey = key;
  }
  return rec.layer;
}

/** A worn ref to what it is and the layer it draws, or null if it is gone. */
export function resolveItem(ref, model = 'classic') {
  const [kind, id] = String(ref).split(':');
  if (kind === 'preset') {
    const def = presetById(id);
    return def ? { ref, kind, id, name: def.name, cat: def.cat, view: def.view, layer: presetLayer(id, model) } : null;
  }
  if (kind === 'item') {
    const rec = state.items.get(id);
    return rec ? { ref, kind, id, name: rec.name, cat: rec.cat, rec, layer: ownLayer(rec) } : null;
  }
  return null;
}

/**
 * A cape ref to what it is. An official cape that has not arrived yet
 * resolves with `layer: null` — it is real, just not here yet.
 */
export function resolveCape(ref) {
  const [kind, id] = String(ref || '').split(':');
  if (kind === 'preset') {
    const def = presetCapeById(id);
    return def ? { ref, kind, id, name: def.name, layer: presetCapeLayer(id) } : null;
  }
  if (kind === 'mojang') {
    const def = officialCapeById(id);
    if (!def) return null;
    const rec = state.official.get(id);
    const split = state.capeSplits[id] ?? 0.5;
    return { ref, kind, id, name: def.name, def, split, failed: state.officialFailed.has(id), layer: rec ? ownLayer(rec, split) : null };
  }
  if (kind === 'cape') {
    const rec = state.capes.get(id);
    return rec ? { ref, kind, id, name: rec.name, rec, layer: ownLayer(rec) } : null;
  }
  return null;
}

export const modelOf = outfit => baseOf(outfit)?.model || 'classic';

/**
 * The outfit as the game would see it.
 * @returns {{ skin: ImageData, cape: ImageData|null, model, base }}
 */
export function composeOutfit(outfit, { items = true, cape = true } = {}) {
  const base = baseOf(outfit);
  const model = base?.model || 'classic';
  const baseImg = base?.img || starterSkin(model);
  const worn = !items ? [] : (outfit?.items || []).filter(w => !w.hidden).map(w => {
    const r = resolveItem(w.ref, model);
    return r && { layer: r.layer, tints: w.tints, hideUnder: w.hideUnder };
  }).filter(Boolean);
  let capeImg = null;
  if (cape && outfit?.cape && !outfit.cape.hidden) {
    const r = resolveCape(outfit.cape.ref);
    if (r?.layer) capeImg = composeCape(r.layer, outfit.cape.tints);
  }
  return { skin: composeSkin(baseImg, model, worn), cape: capeImg, model, base };
}

/** An outfit document from the library, open or not. */
export const outfitDoc = rec => (rec.id === state.project?.id ? state.project : migrate(JSON.parse(JSON.stringify(rec.doc))));
