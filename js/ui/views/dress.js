/* ============================================================================
   The dressing room.

   The wardrobe down the left — shelves of hats, tops, bottoms, shoes, extras,
   looks, capes and your own things; the outfit in 3D in the middle; and on
   the right what it is built on and what it is wearing, each piece with its
   colours laid out one group at a time.

   Clicking a thing in the wardrobe puts it on or takes it off. Things go on
   in the order you add them, later ones over earlier ones; drag them in the
   list to change that. Right-click anything for more — paint it, split it,
   file it on another shelf.
   ========================================================================= */

import { h, raw, on, add } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { plural, rafBatch, fuzzyScore, hasMod, rgbaToHex } from '../../core/util.js';
import {
  state, bus, markDirty, outfitChanged, toggleWear, setCape, resolveItem, resolveCape, composeOutfit,
  baseOf, modelOf, openProject, saveProject, duplicateProject, saveBase, setRoute, updateOwn, deleteOwn,
  setPref, basePalette, fetchOfficialCapes, setCapeSplit, setCapeOwned, addLook, updateLook, deleteLook, lookWorn, wearLook, lookPieces,
} from '../../core/store.js';
import { findWorn } from '../../skin/outfit.js';
import { CATEGORIES, PRESETS } from '../../skin/items.js';
import { PRESET_CAPES, OFFICIAL_CAPES, CAPE_GROUPS } from '../../skin/capes.js';
import { visibleGroups, groupHex } from '../../skin/tint.js';
import { atlas } from '../../skin/compose.js';
import { layout, SKIN } from '../../skin/layout.js';
import { OUTER_PARTS } from '../../model/models.js';
import {
  section, iconButton, note, badge, toast, segmented, switchRow, slider, emptyState, contextMenu,
  promptDialog, confirmDialog, makeSortable, field, textInput, selectInput,
} from '../kit.js';
import { createStage } from '../stage.js';
import { itemThumbURL, capeThumbURL, lookThumbURL, faceCanvas } from '../thumbs.js';
import { tintEditor, swatchDots, closeTintPopover, nothingThere } from '../tintui.js';
import { wardIcon } from '../wardicons.js';
import { openBasePicker, openPlayerDialog, openSkinFileDialog, openCapeFileDialog, openSplitDialog, openItemInPaint } from '../sources.js';

const SHELVES = [
  ...CATEGORIES.map(c => ({ ...c, kind: 'items' })),
  { id: 'looks', label: 'Looks', kind: 'looks' },
  { id: 'capes', label: 'Capes', kind: 'capes' },
  { id: 'yours', label: 'Yours', kind: 'yours' },
];
const SHELF_ACCENT = {
  hats: '#E0784A', tops: '#5B7CE8', bottoms: '#2BBAC2', shoes: '#B99A62',
  extras: '#B084F5', looks: '#4FD8DE', capes: '#F05C48', yours: '#F2B33D',
};
const shelfLabel = id => SHELVES.find(s => s.id === id)?.label || id;
const CAPE_KIND = { preset: 'Fish’s own', mojang: 'Official', cape: 'Yours' };

/** Does an item paint the base layer anywhere the base's own outer layer could show over it? */
function coversInner(layer, model) {
  const { toOuter } = layout(model);
  for (let i = 0; i < SKIN * SKIN; i++) if (layer.alpha[i] && toOuter[i] >= 0) return true;
  return false;
}

export function buildDressView() {
  /* ======================================================================= */
  /* LAYOUT                                                                  */
  /* ======================================================================= */
  const search = h('input.input', {
    type: 'search', placeholder: 'Search the wardrobe…', 'aria-label': 'Search the wardrobe',
    oninput: () => { state.catalog.q = search.value; renderShelf(); },
    onkeydown: e => { if (e.key === 'Escape') { e.stopPropagation(); search.value = ''; state.catalog.q = ''; renderShelf(); search.blur(); } },
  });
  const chips = h('.cat-chips', { role: 'tablist', 'aria-label': 'Shelves' });
  const shelf = h('.item-grid');
  const shelfNote = h('.shelf-note');
  const catalog = h('aside.wd-catalog',
    h('.cat-head', h('.input-group', h('span.input-icon', raw(icon('search', 14))), search), chips),
    h('.cat-scroll', shelf, shelfNote),
  );

  const outfitSel = h('select.select.select-sm.fit-select', { 'aria-label': 'Outfit', onchange: e => switchTo(e.target.value) });
  const view = { outer: true, cape: true };
  const outerBtn = h('button.btn.btn-sm.btn-ghost', { 'aria-pressed': 'true', 'data-tip': 'Outer layer  O', onclick: () => toggleOuter() }, raw(icon('layers', 14)), h('span', { text: 'Outer layer' }));
  const capeBtn = h('button.btn.btn-sm.btn-ghost', { 'aria-pressed': 'true', 'data-tip': 'Show the cape  C', onclick: () => toggleCapeView() }, raw(icon('flipV', 14)), h('span', { text: 'Cape' }));
  const spinBtn = h('button.btn.btn-sm.btn-ghost', { 'aria-pressed': 'false', 'data-tip': 'Turntable  T', onclick: () => toggleSpin() }, raw(icon('rotate', 14)), h('span', { text: 'Turntable' }));
  const stageBar = h('.stage-bar',
    h('.sb-group',
      iconButton('chevLeft', { tip: 'Previous outfit  [', pos: 'bottom', onClick: () => step(-1) }),
      outfitSel,
      iconButton('chevRight', { tip: 'Next outfit  ]', pos: 'bottom', onClick: () => step(1) }),
    ),
    h('.spacer'),
    h('.sb-group', outerBtn, capeBtn, spinBtn),
    h('.sb-sep'),
    h('.sb-group', h('button.btn.btn-sm', { onclick: () => saveAsNew() }, raw(icon('duplicate', 13)), h('span', { text: 'Save as new outfit' }))),
  );
  const stage = createStage();
  const stageWrap = h('.stage-wrap', stageBar, stage.el);

  const inspScroll = h('.insp-scroll');
  const insp = h('aside.wd-insp', inspScroll);
  const root = h('.view', { dataset: { view: 'dress' } }, h('.wd-layout', catalog, stageWrap, insp));

  /* ======================================================================= */
  /* STAGE                                                                   */
  /* ======================================================================= */
  const repaint = rafBatch(() => {
    const o = state.project;
    if (!o) return;
    const c = composeOutfit(o);
    stage.setModel(c.model === 'slim');
    stage.setTexture(atlas(c.skin, c.cape));
    stage.setHidden([...(view.outer ? [] : OUTER_PARTS), ...(view.cape && c.cape ? [] : ['cape'])]);
  });
  const toggleOuter = () => { view.outer = !view.outer; outerBtn.setAttribute('aria-pressed', String(view.outer)); repaint(); };
  const toggleCapeView = () => { view.cape = !view.cape; capeBtn.setAttribute('aria-pressed', String(view.cape)); repaint(); };
  const syncSpin = () => { spinBtn.setAttribute('aria-pressed', String(!!state.prefs.turntable)); stage.setTurntable(!!state.prefs.turntable && state.route === 'dress'); };
  const toggleSpin = () => setPref('turntable', !state.prefs.turntable);

  /* ---- The pipette --------------------------------------------------------
     The next click on the model takes the colour of the pixel under it, as
     the outfit shows it — cape included. */
  let pickBanner = null;
  function pickFromModel(done) {
    closeTintPopover();
    const c = composeOutfit(state.project);
    const colourAt = t => {
      if (!t) return null;
      const img = t.y >= SKIN ? c.cape : c.skin;
      if (!img) return null;
      const i = ((t.y % SKIN) * img.width + t.x) * 4;
      return img.data[i + 3] ? rgbaToHex(img.data[i], img.data[i + 1], img.data[i + 2]) : null;
    };
    const chip = h('i');
    const text = h('span', { text: 'Click the model to take a colour' });
    pickBanner?.remove();
    pickBanner = h('.pick-banner', raw(icon('pipette', 14)), text, chip,
      h('button.btn.btn-sm.btn-ghost', { onclick: () => stage.cancelPick() }, 'Cancel'));
    stage.el.appendChild(pickBanner);
    stage.pickOnce(t => {
      pickBanner?.remove(); pickBanner = null;
      if (!t) return;
      const hex = colourAt(t);
      if (hex) done(hex); else nothingThere();
    }, t => {
      const hex = colourAt(t);
      chip.style.background = hex || 'transparent';
      text.textContent = hex ? `${hex.toUpperCase()} — click to take it` : 'Click the model to take a colour';
    });
  }

  function renderOutfitSel() {
    outfitSel.replaceChildren(...state.library.map(r => h('option', { value: r.id, selected: r.id === state.project?.id }, r.name)));
    if (state.project && !state.library.some(r => r.id === state.project.id)) outfitSel.appendChild(h('option', { value: state.project.id, selected: true }, state.project.name));
  }
  async function switchTo(id) {
    if (!id || id === state.project?.id) return;
    try { await openProject(id); } catch (e) { toast({ title: 'Could not open that outfit', message: e.message, kind: 'error' }); }
  }
  function step(dir) {
    const lib = state.library;
    if (lib.length < 2) return;
    const i = lib.findIndex(r => r.id === state.project?.id);
    switchTo(lib[(i + dir + lib.length) % lib.length].id);
  }
  async function saveAsNew() {
    const o = state.project;
    if (!o) return;
    const name = await promptDialog({ title: 'Save as a new outfit', message: 'A copy of this outfit you can change freely — this one stays as it is.', value: `${o.name} 2`, confirmLabel: 'Save' });
    if (!name?.trim()) return;
    await saveProject({ silent: true });
    const id = await duplicateProject(o.id, name.trim());
    if (id) { await openProject(id); toast({ title: 'Saved as a new outfit', message: `You are now dressing “${name.trim()}”.`, kind: 'ok' }); }
  }

  /* ======================================================================= */
  /* THE WARDROBE                                                            */
  /* ======================================================================= */
  function itemEntries() {
    return [
      ...PRESETS.map(d => ({ ref: `preset:${d.id}`, name: d.name, cat: d.cat, view: d.view, kind: 'preset' })),
      ...[...state.items.values()].map(r => ({ ref: `item:${r.id}`, name: r.name, cat: r.cat, kind: 'item', rec: r })),
    ];
  }
  function capeEntries() {
    return [
      ...PRESET_CAPES.map(c => ({ ref: `preset:${c.id}`, name: c.name, kind: 'preset', group: 'fish' })),
      ...[...state.capes.values()].map(r => ({ ref: `cape:${r.id}`, name: r.name, kind: 'cape', rec: r, group: 'yours' })),
      ...OFFICIAL_CAPES.map(c => ({ ref: `mojang:${c.id}`, id: c.id, name: c.name, kind: 'mojang', group: c.group })),
    ];
  }
  let pickingOwned = false;         // the Capes shelf's pick-what-you-own mode
  const looksSorted = () => [...state.looks.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  function renderChips() {
    const items = itemEntries();
    const n = id => id === 'capes' ? capeEntries().length : id === 'yours' ? state.items.size : id === 'looks' ? state.looks.size : items.filter(e => e.cat === id).length;
    chips.replaceChildren(...SHELVES.map(s => h('button.cat-chip', {
      role: 'tab', 'aria-selected': String(state.catalog.cat === s.id && !state.catalog.q),
      dataset: { sfx: 'select' },
      onclick: () => { state.catalog.cat = s.id; pickingOwned = false; search.value = ''; state.catalog.q = ''; renderChips(); renderShelf(); },
    }, h('span.cc-icon', wardIcon(s.id, 1, { accent: SHELF_ACCENT[s.id] })), h('span', { text: s.label }), h('span.cc-count', { text: String(n(s.id)) }))));
  }

  const shelfHead = (label, sub) => h('.shelf-head', h('span', { text: label }), sub ? h('span.sh-sub', { text: sub }) : null);

  function renderShelf() {
    const o = state.project;
    if (!o) { shelf.replaceChildren(); return; }
    const q = state.catalog.q.trim();
    const cat = state.catalog.cat;
    let tiles = [];
    shelfNote.replaceChildren();
    if (q) {
      const score = e => Math.max(fuzzyScore(q, e.name), fuzzyScore(q, shelfLabel(e.cat || 'capes')) - 200);
      const items = itemEntries().map(e => ({ e, s: score(e) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => itemTile(x.e));
      const looks = looksSorted().filter(l => fuzzyScore(q, `${l.name} look`) > 0).map(lookTile);
      const capes = capeEntries().map(e => ({ e, s: fuzzyScore(q, e.name + ' cape') })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => capeTile(x.e));
      tiles = [...items, ...looks, ...capes];
      if (!tiles.length) shelfNote.appendChild(emptyState({ iconName: 'search', title: 'Nothing called that', message: `Nothing in the wardrobe matches “${q}”.` }));
    } else if (cat === 'capes' && pickingOwned) {
      /* Picking the capes you own: every official cape, a tap each to say
         your account has it. */
      if (!state.officialFailed.size) fetchOfficialCapes();
      const all = capeEntries();
      tiles = [
        h('.shelf-bar',
          raw(icon('check', 14)),
          h('span', { text: `Tap every cape your account has — ${plural(state.ownedCapes.size, 'cape')} picked.` }),
          h('.spacer'),
          h('button.btn.btn-sm.btn-primary', { onclick: () => { pickingOwned = false; renderShelf(); } }, 'Done'),
        ),
        ...CAPE_GROUPS.flatMap(g => [shelfHead(g.label), ...all.filter(e => e.group === g.id).map(ownedPickTile)]),
      ];
      shelfNote.appendChild(h('.caption.muted', { text: 'Mojang does not say which capes an account has without a sign-in, so this is you saying. It is kept in this browser, and the ones you pick go to the front of the Capes shelf.' }));
    } else if (cat === 'capes') {
      if (!state.officialFailed.size) fetchOfficialCapes();
      const all = capeEntries();
      const owned = all.filter(e => e.kind === 'mojang' && state.ownedCapes.has(e.id));
      tiles = [
        h('.shelf-bar',
          h('span', { text: owned.length ? `${plural(owned.length, 'cape')} you own, first.` : 'Own some official capes? Pick them and they come first.' }),
          h('.spacer'),
          h('button.btn.btn-sm', { onclick: () => { pickingOwned = true; renderShelf(); } }, raw(icon('check', 13)), h('span', { text: owned.length ? 'Change' : 'Pick the capes you own' })),
        ),
        noCapeTile(), ...all.filter(e => e.group === 'fish').map(capeTile),
        shelfHead('Yours'),
        ...owned.map(capeTile),
        ...all.filter(e => e.group === 'yours').map(capeTile),
        addTile('Add a cape', [
          { label: 'Pick the capes I own…', icon: 'check', run: () => { pickingOwned = true; renderShelf(); } },
          { label: 'Borrow a player’s cape…', icon: 'search', run: () => openPlayerDialog({ mode: 'cape' }) },
          { label: 'Import a cape PNG…', icon: 'upload', run: () => openCapeFileDialog() },
        ]),
        ...CAPE_GROUPS.flatMap(g => {
          const rest = all.filter(e => e.group === g.id && !state.ownedCapes.has(e.id));
          return rest.length ? [shelfHead(g.label), ...rest.map(capeTile)] : [];
        }),
      ];
      shelfNote.appendChild(h('.caption.muted', { text: 'The official capes are Mojang’s own, fetched from textures.minecraft.net by their texture id. The game only shows a cape Mojang gave the account, so wearing one here is for the look, for mods that read cape files, and for matching the outfit to it. Right-click one to say you own it.' }));
    } else if (cat === 'looks') {
      tiles = [...looksSorted().map(lookTile), addTile('Save as a look', () => saveLookFromOutfit())];
      shelfNote.appendChild(h('.caption.muted', { text: state.looks.size
        ? 'A look is a few items saved together. Click one to put the whole thing on in its colours; click again to take it off. Right-click for more.'
        : 'A look is a few items saved together, to put on in one click. Save what this outfit is wearing as one — and splitting a skin into pieces saves the pieces as a look too.' }));
    } else if (cat === 'yours') {
      tiles = [...itemEntries().filter(e => e.kind === 'item').map(itemTile), addTile('Make an item', [
        { label: 'From a player’s skin…', icon: 'search', run: () => openPlayerDialog({ mode: 'item' }) },
        { label: 'From a skin PNG…', icon: 'upload', run: () => openSkinFileDialog({ mode: 'item' }) },
        { label: 'Draw one from scratch…', icon: 'pencil', run: () => { state.paint.target = 'new'; setRoute('paint'); } },
      ])];
      shelfNote.appendChild(h('.caption.muted', { text: state.items.size
        ? 'Everything you made, whichever shelf it is on. Right-click one to paint it, split it into pieces, or move it to another shelf.'
        : 'Cut clothes out of any skin — a hoodie from one, a hat from another — or draw your own, and wear them over any base. They tint like the rest.' }));
    } else {
      tiles = itemEntries().filter(e => e.cat === cat).map(itemTile);
      shelfNote.appendChild(h('.caption.muted', { text: 'Right-click anything to paint it — a preset becomes your own copy.' }));
    }
    shelf.replaceChildren(...tiles.filter(Boolean));
  }

  function itemTile(e) {
    const o = state.project;
    const model = modelOf(o);
    const r = resolveItem(e.ref, model);
    if (!r) return null;
    const worn = findWorn(o, e.ref);
    const url = itemThumbURL(e.ref + (e.rec ? `@${e.rec.updatedAt}` : ''), r.layer, { slim: model === 'slim', view: e.view || 'front', px: 128 });
    return h('button.item-tile', {
      'aria-pressed': String(!!worn),
      'data-tip': worn ? `Take off ${e.name}` : `Wear ${e.name}`, 'data-tip-pos': 'bottom',
      onclick: () => { toggleWear(e.ref); },
      oncontextmenu: ev => { ev.preventDefault(); itemMenu(e, { x: ev.clientX, y: ev.clientY }); },
    },
      h('.it-pic', url ? h('img', { src: url, alt: '', draggable: 'false' }) : h('span.caption', { text: e.name.slice(0, 1) })),
      h('.it-foot', h('span.it-name.truncate', { text: e.name }), swatchDots(r.layer, worn?.tints || {})),
      worn ? h('span.it-check', raw(icon('check', 11, { stroke: 2.6 }))) : null,
      e.kind === 'item' ? h('span.it-own', { text: 'Yours' }) : null,
    );
  }

  /** In the pick-what-you-own mode: a tap says you have it, or that you do not. */
  function ownedPickTile(e) {
    const r = resolveCape(e.ref);
    if (!r) return null;
    const owned = state.ownedCapes.has(e.id);
    const url = r.layer ? capeThumbURL(`${e.ref}@${r.split ?? ''}`, r.layer, { px: 128 }) : null;
    return h('button.item-tile.item-tile-pick', {
      'aria-pressed': String(owned),
      'data-tip': owned ? `I do not have ${e.name}` : `I have ${e.name}`, 'data-tip-pos': 'bottom',
      onclick: () => setCapeOwned(e.id, !owned),
    },
      h('.it-pic', url ? h('img', { src: url, alt: '', draggable: 'false' }) : h('.spinner')),
      h('.it-foot', h('span.it-name.truncate', { text: e.name })),
      owned ? h('span.it-check', raw(icon('check', 11, { stroke: 2.6 }))) : null,
    );
  }

  function capeTile(e) {
    const o = state.project;
    const r = resolveCape(e.ref);
    if (!r) return null;
    const on = o.cape?.ref === e.ref;
    const owned = e.kind === 'mojang' && state.ownedCapes.has(e.id);
    const officialMenu = e.kind === 'mojang' ? ev => {
      ev.preventDefault();
      contextMenu([
        { type: 'label', label: `${e.name} cape` },
        { label: on ? 'Take it off' : 'Wear it', icon: on ? 'x' : 'plus', run: wear },
        { label: owned ? 'I don’t own this one' : 'I own this one', icon: owned ? 'x' : 'check', run: () => setCapeOwned(e.id, !owned) },
        { label: 'Pick the capes I own…', icon: 'check', run: () => { pickingOwned = true; renderShelf(); } },
      ], { x: ev.clientX, y: ev.clientY });
    } : null;
    const wear = () => { setCape(on ? null : e.ref); if (!r.layer) fetchOfficialCapes(); };
    if (!r.layer) {
      // An official cape that has not arrived: wearable already, drawn when it lands.
      return h('button.item-tile.item-tile-loading', {
        'aria-pressed': String(on),
        'data-tip': r.failed ? 'Could not reach textures.minecraft.net — click to try again' : 'Fetching it from Mojang…', 'data-tip-pos': 'bottom',
        onclick: wear,
        oncontextmenu: officialMenu,
      },
        h('.it-pic', r.failed ? raw(icon('refresh', 18)) : h('.spinner')),
        h('.it-foot', h('span.it-name.truncate', { text: e.name })),
        on ? h('span.it-check', raw(icon('check', 11, { stroke: 2.6 }))) : null,
      );
    }
    const url = capeThumbURL(e.ref + (e.rec ? `@${e.rec.updatedAt}` : `@${r.split ?? ''}`), r.layer, { px: 128 });
    return h('button.item-tile', {
      'aria-pressed': String(on),
      'data-tip': on ? `Take off ${e.name}` : `Wear ${e.name}`, 'data-tip-pos': 'bottom',
      onclick: wear,
      oncontextmenu: e.rec ? ev => { ev.preventDefault(); ownMenu('cape', e.rec, { x: ev.clientX, y: ev.clientY }); } : officialMenu,
    },
      h('.it-pic', url ? h('img', { src: url, alt: '', draggable: 'false' }) : null),
      h('.it-foot', h('span.it-name.truncate', { text: e.name }), swatchDots(r.layer, on ? o.cape.tints : {})),
      on ? h('span.it-check', raw(icon('check', 11, { stroke: 2.6 }))) : null,
      e.kind === 'cape' ? h('span.it-own', { text: 'Yours' }) : owned ? h('span.it-own.it-owned', { text: 'Owned' }) : null,
    );
  }

  function lookTile(look) {
    const o = state.project;
    const model = modelOf(o);
    const pieces = lookPieces(look, model);
    const on = lookWorn(look, o);
    const key = `${look.id}@${look.updatedAt}|${pieces.map(p => `${p.ref}@${p.r.rec?.updatedAt || ''}`).join(',')}|${JSON.stringify(pieces.map(p => p.tints))}`;
    const url = pieces.length ? lookThumbURL(key, pieces.map(p => ({ layer: p.r.layer, tints: p.tints })), { slim: model === 'slim', px: 128 }) : null;
    return h('button.item-tile.look-tile', {
      'aria-pressed': String(on),
      'data-tip': on ? `Take off ${look.name}` : `Wear all of ${look.name}`, 'data-tip-pos': 'bottom',
      onclick: () => { if (pieces.length) wearLook(look); },
      oncontextmenu: ev => { ev.preventDefault(); lookMenu(look, { x: ev.clientX, y: ev.clientY }); },
    },
      h('.it-pic', url ? h('img', { src: url, alt: '', draggable: 'false' }) : raw(icon('x', 20))),
      h('.it-foot', h('span.it-name.truncate', { text: look.name }), h('span.it-count', { text: plural(pieces.length, 'piece') })),
      on ? h('span.it-check', raw(icon('check', 11, { stroke: 2.6 }))) : null,
    );
  }

  const noCapeTile = () => h('button.item-tile.item-tile-none', {
    'aria-pressed': String(!state.project?.cape), onclick: () => setCape(null),
  }, h('.it-pic', raw(icon('x', 22))), h('.it-foot', h('span.it-name', { text: 'No cape' })));

  /** A dashed "add" tile: a menu of ways, or one thing to do. */
  const addTile = (label, what) => h('button.item-tile.item-tile-new', {
    onclick: e => (typeof what === 'function' ? what() : contextMenu(what, e.currentTarget)),
  }, h('.it-pic', raw(icon('plus', 22))), h('.it-foot', h('span.it-name', { text: label })));

  function itemMenu(e, at) {
    const o = state.project;
    const worn = findWorn(o, e.ref);
    contextMenu([
      { type: 'label', label: e.name },
      { label: worn ? 'Take it off' : 'Wear it', icon: worn ? 'x' : 'plus', run: () => toggleWear(e.ref) },
      { label: e.kind === 'preset' ? 'Paint my own copy…' : 'Paint it…', icon: 'pencil', run: () => openItemInPaint(e.ref) },
      ...(e.rec ? [
        { label: 'Split into pieces…', icon: 'scissors', run: () => openSplitDialog({ item: e.rec, model: modelOf(o) }) },
        { label: 'Rename…', icon: 'edit', run: () => renameOwn('item', e.rec) },
        '-', { type: 'label', label: 'Shelf' },
        ...CATEGORIES.map(c => ({ label: c.label, icon: e.rec.cat === c.id ? 'check' : null, run: () => updateOwn('item', e.rec.id, { cat: c.id }) })),
        '-',
        { label: 'Delete…', icon: 'trash', destructive: true, run: () => deleteOwnAsk('item', e.rec) },
      ] : []),
    ], at);
  }

  function ownMenu(kind, rec, at) {
    contextMenu([
      { type: 'label', label: rec.name },
      { label: 'Rename…', icon: 'edit', run: () => renameOwn(kind, rec) },
      '-',
      { label: 'Delete…', icon: 'trash', destructive: true, run: () => deleteOwnAsk(kind, rec) },
    ], at);
  }

  async function renameOwn(kind, rec) {
    const v = await promptDialog({ title: `Rename ${kind === 'cape' ? 'cape' : 'item'}`, value: rec.name, confirmLabel: 'Rename' });
    if (v?.trim()) updateOwn(kind, rec.id, { name: v.trim() });
  }
  async function deleteOwnAsk(kind, rec) {
    const ok = await confirmDialog({ title: `Delete “${rec.name}”?`, message: `It is taken off every outfit${kind === 'item' ? ' and look' : ''} wearing it, and removed from this browser.`, confirmLabel: 'Delete', danger: true });
    if (ok) deleteOwn(kind, rec.id);
  }

  /* ---- Looks --------------------------------------------------------------- */
  async function saveLookFromOutfit() {
    const o = state.project;
    const on = o?.items.filter(w => !w.hidden) || [];
    if (!on.length) { toast({ title: 'Nothing on to save', message: 'Put a few things on first — a look is what you are wearing, saved together.', kind: 'info' }); return; }
    const name = await promptDialog({ title: 'Save as a look', message: `${plural(on.length, 'item')}, in the colours they are now, to put on together in one click — over any outfit.`, value: `${o.name} look`, confirmLabel: 'Save look' });
    if (!name?.trim()) return;
    const look = await addLook({ name: name.trim(), items: on });
    toast({ title: 'Look saved', message: `“${look.name}” is on the Looks shelf.`, kind: 'ok' });
  }

  function lookMenu(look, at) {
    const o = state.project;
    contextMenu([
      { type: 'label', label: look.name },
      { label: 'Wear only this look', icon: 'layers', run: () => {
          const before = o.items;
          o.items = [];
          wearLook(look);
          toast({ title: `Wearing ${look.name}`, message: 'Everything else came off.', kind: 'ok', action: { label: 'Undo', run: () => { o.items = before; outfitChanged('wear'); } } });
        } },
      { label: 'Save what I’m wearing into it', icon: 'save', run: async () => {
          const on = o.items.filter(w => !w.hidden);
          if (!on.length) return;
          const ok = await confirmDialog({ title: `Replace what is in ${look.name}?`, message: `It becomes the ${plural(on.length, 'item')} this outfit is wearing, in their colours now.`, confirmLabel: 'Replace' });
          if (ok) updateLook(look.id, { items: on });
        } },
      { label: 'Rename…', icon: 'edit', run: async () => {
          const v = await promptDialog({ title: 'Rename look', value: look.name, confirmLabel: 'Rename' });
          if (v?.trim()) updateLook(look.id, { name: v.trim() });
        } },
      '-',
      { label: 'Delete look…', icon: 'trash', destructive: true, run: async () => {
          const ok = await confirmDialog({ title: `Delete “${look.name}”?`, message: 'Only the look goes. Its items stay on their shelves and on any outfit wearing them.', confirmLabel: 'Delete', danger: true });
          if (ok) deleteLook(look.id);
        } },
    ], at);
  }

  /* ======================================================================= */
  /* INSPECTOR                                                               */
  /* ======================================================================= */
  function capeColours(o) {
    const r = o?.cape && resolveCape(o.cape.ref);
    return r?.layer ? visibleGroups(r.layer).sort((a, b) => b.count - a.count).map(g => groupHex(r.layer, g.gi, o.cape.tints)) : [];
  }

  function palettes(except) {
    const o = state.project;
    const out = [];
    const cape = capeColours(o);
    if (cape.length) out.push({ label: 'The cape', colors: cape });
    const skin = basePalette(baseOf(o)).all;
    if (skin.length) out.push({ label: 'The base skin', colors: skin });
    const mine = [];
    for (const w of o?.items || []) {
      if (w === except) continue;
      const r = resolveItem(w.ref, modelOf(o));
      if (r) for (const g of visibleGroups(r.layer)) mine.push(groupHex(r.layer, g.gi, w.tints));
    }
    if (mine.length) out.push({ label: 'This outfit', colors: mine });
    return out;
  }

  function renderInspector() {
    closeTintPopover();
    const o = state.project;
    if (!o) { inspScroll.replaceChildren(); return; }
    const keep = inspScroll.scrollTop;
    inspScroll.replaceChildren(headBlock(o), baseSection(o), wearingSection(o), capeSection(o));
    inspScroll.scrollTop = keep;
  }

  function headBlock(o) {
    const nameInput = h('input.insp-name', {
      value: o.name, 'aria-label': 'Outfit name', maxlength: 60,
      oninput: e => { o.name = e.target.value; markDirty('name'); },
      onchange: () => renderOutfitSel(),
      onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
    });
    const model = modelOf(o);
    return h('.insp-head',
      h('.eyebrow', { text: 'Outfit' }),
      nameInput,
      h('.insp-badges',
        badge(model === 'slim' ? 'Slim arms' : 'Classic arms'),
        badge(o.items.length ? plural(o.items.length, 'item') : 'Nothing on yet', o.items.length ? 'accent' : ''),
        o.cape ? badge('Cape') : null,
      ),
    );
  }

  function baseSection(o) {
    const base = baseOf(o);
    if (!base) {
      return section('Base skin', [note('This outfit’s base skin is gone. Pick another.', 'warn'), h('button.btn.btn-sm', { onclick: () => openBasePicker() }, 'Pick a base')], { key: 'dress-base' });
    }
    const src = base.source?.kind === 'player' ? `${base.source.name}’s skin` : base.source?.kind === 'starter' ? 'The mannequin' : base.source?.name || 'From a file';
    const pal = basePalette(base);
    return section('Base skin', [
      h('.base-card',
        h('.bc-face', faceCanvas(base.img, 5)),
        h('.col.grow', { style: 'min-width:0' }, h('.strong.truncate', { text: base.name }), h('.caption.truncate', { text: src }), swatchRow(pal.match.slice(0, 8))),
        h('button.btn.btn-sm', { onclick: () => openBasePicker() }, h('span', { text: 'Change' })),
      ),
      h('.row.g-2',
        h('.grow', segmented({
          options: [{ value: 'classic', label: 'Classic arms' }, { value: 'slim', label: 'Slim arms' }],
          value: base.model, block: true,
          onChange: async v => {
            if (base.model === v) return;
            base.model = v;
            await saveBase(base);
            bus.emit('bases');
            outfitChanged('model');
          },
        })),
        h('button.btn.btn-sm', { 'data-tip': 'Paint this base in 3D', onclick: () => { state.paint.target = 'base'; setRoute('paint'); } }, raw(icon('pencil', 13)), h('span', { text: 'Paint' })),
      ),
      o.items.length && pal.match.length ? h('button.btn.btn-sm', {
        onclick: () => matchTo('skin'),
        'data-tip': 'Give every item the skin’s own colours — its hair, its clothes, its eyes — biggest first. Not its skin tone.',
      }, raw(icon('palette', 13)), h('span', { text: 'Match the outfit to this skin' })) : null,
      h('.caption.muted', { text: 'Shared: every outfit on this base shows what you paint on it. Items are drawn for the arm width you pick here.' }),
    ], { key: 'dress-base' });
  }

  const swatchRow = colours => h('span.dots.base-dots', ...colours.map(c => h('i', { style: { background: c }, 'data-tip': c.toUpperCase() })));

  function wearingSection(o) {
    const body = h('.col.g-3');
    const model = modelOf(o);
    if (!o.items.length) {
      body.appendChild(h('.caption.muted', { text: 'Nothing on yet. Click anything in the wardrobe on the left and it goes on over the base.' }));
    } else {
      const list = h('.wear-list', ...o.items.map((w, i) => wearRow(o, w, i, model)));
      body.appendChild(list);
      makeSortable(list, {
        selector: '.wear-row',
        onReorder: (from, to) => {
          const [w] = o.items.splice(from, 1);
          o.items.splice(to, 0, w);
          outfitChanged('order');
        },
      });
      add(body, h('.row.g-2.wrap',
        h('button.btn.btn-sm', {
          'data-tip': 'Dress every item in the colours of the cape or the skin',
          onclick: e => contextMenu([
            { type: 'label', label: 'Match every item’s colours to…' },
            { label: 'The cape', icon: 'flipV', disabled: !capeColours(o).length, run: () => matchTo('cape') },
            { label: 'The base skin', icon: 'image', disabled: !basePalette(baseOf(o)).match.length, run: () => matchTo('skin') },
          ], e.currentTarget),
        }, raw(icon('palette', 13)), h('span', { text: 'Match colours' }), raw(icon('chevDown', 11))),
        h('button.btn.btn-sm', { onclick: () => saveLookFromOutfit(), 'data-tip': 'Keep these items together on the Looks shelf' }, raw(icon('star', 13)), h('span', { text: 'Save as a look' })),
        h('button.btn.btn-sm.btn-ghost', { onclick: () => clearTints() }, h('span', { text: 'Undo all tints' })),
        h('.spacer'),
        h('button.btn.btn-sm.btn-ghost.btn-danger', { onclick: () => takeAllOff() }, h('span', { text: 'Take everything off' })),
      ));
      body.appendChild(h('.caption.muted', { text: 'Later items sit on top of earlier ones. Drag to change the order.' }));
    }
    return section('Wearing', [body], { key: 'dress-wear', count: o.items.length || null });
  }

  function wearRow(o, w, i, model) {
    const r = resolveItem(w.ref, model);
    const selected = state.selWear === w.key;
    if (!r) {
      return h('.wear-row', { dataset: { index: i } },
        h('.wr-main', h('.wr-name', { text: 'Missing item' }), h('.caption', { text: 'It was deleted from the wardrobe.' })),
        iconButton('x', { tip: 'Remove', onClick: () => { o.items.splice(i, 1); outfitChanged('wear'); } }),
      );
    }
    const url = itemThumbURL(w.ref + (r.rec ? `@${r.rec.updatedAt}` : ''), r.layer, { slim: model === 'slim', view: r.view || 'front', px: 64 });
    const dots = h('span.wr-dots', swatchDots(r.layer, w.tints, 6));
    const row = h('.wear-row', {
      dataset: { index: i, key: w.key, hidden: String(!!w.hidden) },
      'aria-selected': String(selected),
      onclick: e => { if (e.target.closest('button')) return; state.selWear = selected ? null : w.key; renderInspector(); },
      oncontextmenu: e => { e.preventDefault(); itemMenu({ ref: w.ref, name: r.name, kind: r.kind, rec: r.rec }, { x: e.clientX, y: e.clientY }); },
    },
      h('.wr-pic', url ? h('img', { src: url, alt: '', draggable: 'false' }) : null),
      h('.wr-main', h('.wr-name.truncate', { text: r.name }), h('.wr-sub', h('span', { text: shelfLabel(r.cat) }), dots)),
      iconButton(w.hidden ? 'eyeOff' : 'eye', { tip: w.hidden ? 'Show it  H' : 'Hide it  H', onClick: () => { w.hidden = !w.hidden; outfitChanged('hide'); } }),
      iconButton('x', { tip: 'Take it off  Delete', onClick: () => { toggleWear(w.ref); } }),
    );
    row._dots = () => dots.replaceChildren(swatchDots(r.layer, w.tints, 6));
    if (!selected) return row;

    const detail = h('.wear-detail');
    add(detail,
      h('.eyebrow', { text: 'Colours' }),
      tintEditor({
        layer: r.layer, tints: w.tints, palettes: () => palettes(w), pick: pickFromModel,
        onChange: () => { row._dots(); outfitChanged('tint'); },
      }),
      coversInner(r.layer, model) ? switchRow({
        title: 'Hide the base’s outer layer under it',
        desc: 'So a jacket drawn into the base skin’s sleeves does not show through.',
        checked: w.hideUnder !== false,
        onChange: v => { w.hideUnder = v; outfitChanged('hide'); },
      }) : null,
      r.rec ? groupingControl(r.rec.split ?? 0.5, v => updateOwn('item', r.rec.id, { split: v }), () => { w.tints = {}; }) : null,
      r.rec ? h('.form-grid.own-fields',
        field('Name', textInput({ value: r.rec.name, maxlength: 60, onChange: v => { if (v.trim()) updateOwn('item', r.rec.id, { name: v.trim() }); } })),
        field('Shelf', selectInput({ options: CATEGORIES.map(c => ({ value: c.id, label: c.label })), value: r.rec.cat, onChange: v => updateOwn('item', r.rec.id, { cat: v }) })),
      ) : null,
      h('.row.g-2.wrap',
        h('button.btn.btn-sm', {
          onclick: () => openItemInPaint(w.ref),
          'data-tip': r.kind === 'preset' ? 'Presets stay as they are — this paints your own copy, colours and all' : 'Change its pixels on the model',
        }, raw(icon('pencil', 13)), h('span', { text: r.kind === 'preset' ? 'Paint a copy' : 'Paint it' })),
        r.rec ? h('button.btn.btn-sm', {
          onclick: () => openSplitDialog({ item: r.rec, model }),
          'data-tip': 'Cut it into a hat, a top, bottoms and shoes — each its own item',
        }, raw(icon('scissors', 13)), h('span', { text: 'Split into pieces' })) : null,
      ),
    );
    return h('.wear-block', { dataset: { index: i } }, row, detail);
  }

  /** How readily an imported thing's colours split into separate groups. */
  function groupingControl(value, onSet, onSplit) {
    return h('.field',
      h('label', { text: 'Colour groups' }),
      slider({
        min: 0, max: 100, value: Math.round(value * 100),
        format: v => (v < 34 ? 'fewer' : v > 66 ? 'more' : 'balanced'),
        onChange: v => { onSplit(); onSet(v / 100); },
      }),
      h('.field-hint', { text: 'Colours are split into groups automatically. Slide right if two colours are sharing a swatch; left if one colour is split in two. Changing it clears this piece’s tints.' }),
    );
  }

  function capeSection(o) {
    const body = h('.col.g-3');
    const r = o.cape && resolveCape(o.cape.ref);
    const toShelf = () => { state.catalog.cat = 'capes'; state.catalog.q = ''; search.value = ''; renderChips(); renderShelf(); };
    if (!o.cape || !r) {
      add(body,
        h('.caption.muted', { text: o.cape ? 'This outfit’s cape was deleted.' : 'No cape. Pick one of the official capes from the Capes shelf, or borrow a player’s.' }),
        h('.row.g-2',
          h('button.btn.btn-sm', { onclick: toShelf }, raw(icon('flipV', 13)), h('span', { text: 'Capes shelf' })),
          h('button.btn.btn-sm', { onclick: () => openPlayerDialog({ mode: 'cape' }) }, raw(icon('search', 13)), h('span', { text: 'Borrow a player’s' })),
        ),
      );
      return section('Cape', [body], { key: 'dress-cape' });
    }
    const url = r.layer ? capeThumbURL(o.cape.ref + (r.rec ? `@${r.rec.updatedAt}` : `@${r.split ?? ''}`), r.layer, { px: 64 }) : null;
    // add(), not append(): the native one prints a skipped `null` as text.
    add(body,
      h('.wear-row.cape-row', { dataset: { hidden: String(!!o.cape.hidden) } },
        h('.wr-pic', url ? h('img', { src: url, alt: '' }) : h('.spinner')),
        h('.wr-main', h('.wr-name.truncate', { text: r.name }), h('.wr-sub', h('span', { text: CAPE_KIND[r.kind] || '' }))),
        iconButton(o.cape.hidden ? 'eyeOff' : 'eye', { tip: o.cape.hidden ? 'Show it' : 'Hide it', onClick: () => { o.cape.hidden = !o.cape.hidden; outfitChanged('cape'); } }),
        iconButton('x', { tip: 'Take it off', onClick: () => setCape(null) }),
      ),
    );
    if (!r.layer) {
      add(body,
        note(r.failed ? `Could not fetch the ${r.name} cape from textures.minecraft.net. It is still on — it will show once it arrives.` : `Fetching the ${r.name} cape from Mojang…`, r.failed ? 'warn' : 'info'),
        r.failed ? h('button.btn.btn-sm', { onclick: () => fetchOfficialCapes() }, raw(icon('refresh', 13)), h('span', { text: 'Try again' })) : null,
      );
      return section('Cape', [body], { key: 'dress-cape' });
    }
    add(body,
      tintEditor({ layer: r.layer, tints: o.cape.tints, pick: pickFromModel, palettes: () => palettes(null).filter(p => p.label !== 'The cape'), onChange: () => outfitChanged('tint') }),
      r.rec ? groupingControl(r.rec.split ?? 0.5, v => updateOwn('cape', r.rec.id, { split: v }), () => { o.cape.tints = {}; }) : null,
      r.kind === 'mojang' ? groupingControl(r.split, v => setCapeSplit(r.id, v), () => { o.cape.tints = {}; }) : null,
      o.items.length ? h('button.btn.btn-sm', { onclick: () => matchTo('cape') }, raw(icon('palette', 13)), h('span', { text: 'Match the outfit to this cape' })) : null,
    );
    return section('Cape', [body], { key: 'dress-cape' });
  }

  /* ---- Whole-outfit colour actions --------------------------------------- */
  function withUndo(title, message, change) {
    const o = state.project;
    const before = o.items.map(w => ({ key: w.key, tints: { ...w.tints } }));
    change(o);
    outfitChanged('match');
    renderInspector();
    toast({
      title, message, kind: 'ok',
      action: { label: 'Undo', run: () => {
        for (const b of before) { const w = o.items.find(x => x.key === b.key); if (w) w.tints = b.tints; }
        outfitChanged('match');
        renderInspector();
      } },
    });
  }

  /* Each item's biggest colour takes the palette's biggest, its second the
     palette's second, and so on round it — so a hat and a jacket both come
     out in the cape's (or the skin's) main colour with its next as accent. */
  function matchTo(what) {
    const o = state.project;
    if (!o) return;
    const pal = what === 'cape' ? capeColours(o) : basePalette(baseOf(o)).match;
    if (!pal.length) return;
    const from = what === 'cape' ? 'cape colour' : 'skin colour';
    withUndo(what === 'cape' ? 'Matched to the cape' : 'Matched to the skin', `${plural(o.items.length, 'item')} recoloured from ${plural(pal.length, from)}.`, () => {
      for (const w of o.items) {
        const r = resolveItem(w.ref, modelOf(o));
        if (!r) continue;
        w.tints = {};
        visibleGroups(r.layer).sort((a, b) => b.count - a.count).forEach((g, i) => { w.tints[g.gi] = pal[i % pal.length]; });
      }
    });
  }
  const clearTints = () => withUndo('Tints undone', 'Every item is back to how it was drawn.', o => { for (const w of o.items) w.tints = {}; });

  async function takeAllOff() {
    const o = state.project;
    const ok = await confirmDialog({ title: 'Take everything off?', message: `All ${plural(o.items.length, 'item')} come off. The base and cape stay.`, confirmLabel: 'Take it all off' });
    if (!ok) return;
    const before = o.items;
    o.items = [];
    state.selWear = null;
    outfitChanged('wear');
    toast({ title: 'Back to the base', kind: 'ok', action: { label: 'Undo', run: () => { o.items = before; outfitChanged('wear'); } } });
  }

  /* ======================================================================= */
  /* WIRING                                                                  */
  /* ======================================================================= */
  let stale = true;
  function renderAll() {
    stale = false;
    renderOutfitSel();
    renderChips();
    renderShelf();
    renderInspector();
    repaint();
    syncSpin();
  }
  const whenShown = fn => (...a) => { if (state.route === 'dress') fn(...a); else stale = true; };
  const shelfAndAll = whenShown(() => { renderChips(); renderShelf(); renderInspector(); repaint(); });

  bus.on('project:open', whenShown(renderAll));
  bus.on('library', () => renderOutfitSel());
  bus.on('outfit:changed', whenShown(reason => {
    repaint();
    if (reason === 'tint' || reason === 'name') return;
    renderChips();
    renderShelf();
    if (reason !== 'hide-soft') renderInspector();
  }));
  bus.on('base:painted', whenShown(() => { repaint(); renderInspector(); }));
  bus.on('bases', whenShown(() => { repaint(); renderInspector(); }));
  bus.on('items', shelfAndAll);
  bus.on('capes', shelfAndAll);
  bus.on('looks', whenShown(() => { renderChips(); renderShelf(); }));
  bus.on('prefs', key => { if (key === 'turntable') syncSpin(); });
  bus.on('route', r => { if (r !== 'dress') { stage.setTurntable(false); stage.cancelPick(); closeTintPopover(); } });

  /* ---- Keys -------------------------------------------------------------- */
  on(window, 'keydown', e => {
    if (state.route !== 'dress' || !state.project || stage.picking) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('.overlay, .cmdk-host, .menu')) return;
    if (hasMod(e) || e.altKey) return;
    const o = state.project;
    const sel = o.items.find(w => w.key === state.selWear);
    const k = e.key.toLowerCase();
    if (k === 't') { e.preventDefault(); toggleSpin(); }
    else if (k === 'o') { e.preventDefault(); toggleOuter(); }
    else if (k === 'c') { e.preventDefault(); toggleCapeView(); }
    else if (e.key === '/') { e.preventDefault(); search.focus(); }
    else if (k === 'h' && sel) { e.preventDefault(); sel.hidden = !sel.hidden; outfitChanged('hide'); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); toggleWear(sel.ref); }
    else if (e.key === 'Escape' && sel) { state.selWear = null; renderInspector(); }
  });

  root.refresh = () => { if (stale) renderAll(); else { repaint(); syncSpin(); } };
  return root;
}
