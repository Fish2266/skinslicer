/* ============================================================================
   Shell — chrome, routing, global shortcuts, and the app-wide drop target.
   Frame & Groove's shell with four places: the outfits, the dressing room,
   the paint shop and the door out.
   ========================================================================= */

import { h, raw, clear, on } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { hasMod, keyLabel, plural, debounce } from '../core/util.js';
import {
  state, bus, setRoute, saveProject, closeProject, setPref, openProject, modelOf, toggleWear, setCape,
  flushBaseSaves,
} from '../core/store.js';
import { outfitStats, isWorn } from '../skin/outfit.js';
import { PRESETS } from '../skin/items.js';
import { PRESET_CAPES, OFFICIAL_CAPES } from '../skin/capes.js';
import { openPalette, paletteOpen } from './cmdk.js';
import { modal, toast, switchRow, badge, iconButton, field, segmented, slider } from './kit.js';
import { sfxPreview } from './sfx.js';
import { markCanvas } from './brandmark.js';
import { pixIcon } from './pixicons.js';
import { wardIcon } from './wardicons.js';
import { openDroppedImage, openPlayerDialog, openNewOutfitDialog, openSkinFileDialog, openCapeFileDialog, openBasePicker } from './sources.js';

/* The chest and the tray are Frame & Groove's own rail icons (pixicons.js is
   a straight copy); the tunic and the brush are this app's. */
const ROUTES = [
  { id: 'outfits', label: 'Outfits', icon: () => pixIcon('packs', 2, { accent: '#B99A62', accentLight: '#B99A62' }), needsProject: false },
  { id: 'dress',   label: 'Dress',   icon: () => wardIcon('tunic', 2, { accent: '#DE9820' }), needsProject: true },
  { id: 'paint',   label: 'Paint',   icon: () => wardIcon('brush', 2, { accent: '#F05C48' }), needsProject: true },
  { id: 'export',  label: 'Export',  icon: () => pixIcon('export', 2, { accent: '#3FD98B', accentLight: '#3FD98B' }), needsProject: true },
];

/* The way back to the landing page. The same link, in the same place, in all
   three tools. */
export const homeLink = () => h('a.home-link.no-drag', {
  href: 'https://fish2266.github.io/mctools/',
  'data-tip': 'All three tools', 'data-tip-pos': 'bottom', 'aria-label': 'Fish’s MC Tools',
}, raw(icon('chevLeft', 14)), h('span', { text: 'MC Tools' }));

export function buildShell(views) {
  /* ---- Top bar ---- */
  const crumbs = h('.crumbs');
  const saveChip = h('.save-chip', { dataset: { state: 'idle' } }, h('.dot'), h('span', { text: '' }));

  const topbar = h('.topbar',
    homeLink(),
    h('.divider-v', { style: 'height:20px;margin:0 2px 0 4px' }),
    h('.logo.no-drag',
      h('.logo-mark', markCanvas(28)),
      h('.col', h('.logo-word', 'Skin ', h('em', 'Slicer'))),
    ),
    h('.divider-v', { style: 'height:20px;margin:0 4px' }),
    crumbs,
    h('.spacer'),
    saveChip,
    h('button.btn.btn-sm.btn-ghost.no-drag', {
      'data-tip': `Command palette  ${keyLabel('mod+K')}`, 'data-tip-pos': 'bottom',
      onclick: () => palette(),
    }, raw(icon('search', 14)), h('span.caption', { text: keyLabel('mod+K') })),
    iconButton('keyboard', { tip: 'Keyboard shortcuts  ?', pos: 'bottom', cls: 'btn-ghost btn-sm no-drag', onClick: () => showShortcuts() }),
    iconButton('sliders', { tip: 'Preferences', pos: 'left', cls: 'btn-ghost btn-sm no-drag', onClick: () => showPreferences() }),
  );

  /* ---- Rail ---- */
  const rail = h('.rail');
  const railBtns = new Map();
  for (const r of ROUTES) {
    if (r.id === 'dress') rail.appendChild(h('.rail-sep'));
    const b = h('button.rail-btn', {
      'aria-current': 'false',
      dataset: { route: r.id },
      'data-tip': r.label, 'data-tip-pos': 'right',
      onclick: () => setRoute(r.id),
    }, h('span.rb-icon', r.icon()), h('span.rb-label', { text: r.label }));
    railBtns.set(r.id, b);
    rail.appendChild(b);
  }
  rail.appendChild(h('.spacer'));
  const themeBtn = h('button.rail-btn', {
    'data-tip-pos': 'right',
    onclick: () => setPref('theme', state.prefs.theme === 'bone' ? 'deepslate' : 'bone'),
  });
  const syncThemeBtn = () => {
    const goingDark = state.prefs.theme === 'bone';
    themeBtn.innerHTML = icon(goingDark ? 'moon' : 'sun', 19);
    themeBtn.appendChild(h('span.rb-label', { text: goingDark ? 'Dark' : 'Light' }));
    themeBtn.dataset.tip = goingDark ? 'Switch to dark' : 'Switch to light';
  };
  syncThemeBtn();
  bus.on('prefs', key => { if (key === 'theme') syncThemeBtn(); });
  rail.appendChild(themeBtn);

  /* ---- View host ---- */
  const viewhost = h('.viewhost');
  for (const [id, el] of Object.entries(views)) { el.hidden = true; el.dataset.route = id; viewhost.appendChild(el); }

  const shell = h('.shell', rail, viewhost);
  const app = h('#app', topbar, shell);

  /* ---- Routing ---- */
  function applyRoute(route) {
    const hasProject = !!state.project;
    if (ROUTES.find(r => r.id === route)?.needsProject && !hasProject) route = state.route = 'outfits';
    for (const r of ROUTES) {
      const b = railBtns.get(r.id);
      b.setAttribute('aria-current', String(r.id === route));
      b.disabled = r.needsProject && !hasProject;
    }
    for (const [id, el] of Object.entries(views)) el.hidden = id !== route;
    views[route]?.refresh?.();
    renderCrumbs(route);
    document.documentElement.dataset.route = route;
  }

  function renderCrumbs(route) {
    clear(crumbs);
    const o = state.project;
    if (!o) { crumbs.appendChild(h('span.crumb.current', { text: 'Outfits' })); return; }
    crumbs.append(
      h('button.crumb', { text: 'Outfits', onclick: () => setRoute('outfits') }),
      h('span.sep', raw(icon('chevRight', 12))),
      h('button.crumb', { text: o.name || 'Untitled', onclick: () => setRoute('dress') }),
    );
    if (route !== 'outfits') {
      crumbs.append(h('span.sep', raw(icon('chevRight', 12))), h('span.crumb.current', { text: ROUTES.find(r => r.id === route).label }));
    }
    const s = outfitStats(o);
    crumbs.append(
      h('span', { style: 'margin-left:8px' }, badge(modelOf(o) === 'slim' ? 'Slim' : 'Classic')),
      h('span', { style: 'margin-left:4px' }, badge(s.items ? plural(s.items, 'item') : 'Bare', s.items ? 'accent' : '')),
    );
  }
  const syncCrumbs = debounce(() => renderCrumbs(state.route), 200);

  bus.on('route', applyRoute);
  bus.on('project:open', () => applyRoute(state.route));
  bus.on('project:close', () => applyRoute('outfits'));
  bus.on('project:dirty', syncCrumbs);
  bus.on('outfit:changed', syncCrumbs);

  /* ---- Save indicator ---- */
  let saveTimer;
  const setSave = (mode, text) => {
    saveChip.dataset.state = mode;
    saveChip.querySelector('span').textContent = text;
  };
  bus.on('project:dirty', () => setSave('dirty', 'Unsaved'));
  bus.on('base:dirty', () => setSave('dirty', 'Unsaved'));
  bus.on('save:state', (s, err) => {
    clearTimeout(saveTimer);
    if (s === 'saving') setSave('saving', 'Saving…');
    else if (s === 'saved') { setSave('saved', 'Saved'); saveTimer = setTimeout(() => setSave('idle', ''), 2600); }
    else setSave('error', 'Save failed');
    if (s === 'error') toast({ title: 'Could not save', message: err?.message, kind: 'error' });
  });
  bus.on('base:saved', () => { if (!state.projectDirty) { setSave('saved', 'Saved'); clearTimeout(saveTimer); saveTimer = setTimeout(() => setSave('idle', ''), 2600); } });

  /* ---- Global keys ---- */
  on(window, 'keydown', e => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    if (hasMod(e) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); return; }
    if (hasMod(e) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      flushBaseSaves();
      (state.project ? saveProject() : Promise.resolve()).then(() => toast({ title: 'Saved', kind: 'ok', duration: 1400 }));
      return;
    }
    if (typing || paletteOpen() || document.querySelector('.overlay, .tint-pop')) return;
    if (e.key === '?') { e.preventDefault(); showShortcuts(); return; }
    if (hasMod(e) && e.key >= '1' && e.key <= String(ROUTES.length)) {
      e.preventDefault();
      const r = ROUTES[+e.key - 1];
      if (r && !(r.needsProject && !state.project)) setRoute(r.id);
      return;
    }
    if (!hasMod(e) && (e.key === '[' || e.key === ']') && state.project && state.library.length > 1) {
      e.preventDefault();
      stepOutfit(e.key === ']' ? 1 : -1);
    }
  });

  /* ---- Global drop ---- */
  let dropOverlay = null;
  let dragDepth = 0;
  const showDrop = () => {
    if (dropOverlay) return;
    dropOverlay = h('.global-drop',
      h('.gd-card',
        h('span', { style: 'color:var(--accent)' }, raw(icon('upload', 34))),
        h('.title-sm', { text: 'Drop to add' }),
        h('.caption', { text: 'A skin, a cape or an item PNG · a Skin Slicer zip puts a backup back' }),
      ));
    document.body.appendChild(dropOverlay);
  };
  const hideDrop = () => { dropOverlay?.remove(); dropOverlay = null; dragDepth = 0; };

  on(window, 'dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; showDrop(); } });
  on(window, 'dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  on(window, 'dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) hideDrop(); });
  on(window, 'drop', async e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    hideDrop();
    if (e.target.closest?.('.dropzone')) return;     // a dropzone in a dialog has it
    const file = [...e.dataTransfer.files][0];
    if (/\.zip$/i.test(file.name)) {
      const { openImportBackup } = await import('./views/outfits.js');
      openImportBackup(file);
    } else if (file.type.startsWith('image/') || /\.png$/i.test(file.name)) {
      openDroppedImage(file);
    } else {
      toast({ title: 'Not something this app reads', message: file.name, kind: 'warn' });
    }
  });

  on(window, 'beforeunload', e => {
    if (state.projectDirty) { e.preventDefault(); e.returnValue = ''; }
  });

  applyRoute(state.route);
  return app;
}

/** The next or previous outfit in the library's order — "[" and "]". */
export async function stepOutfit(dir) {
  const lib = state.library;
  if (!state.project || lib.length < 2) return;
  const i = lib.findIndex(r => r.id === state.project.id);
  const next = lib[(i + dir + lib.length) % lib.length];
  try { await openProject(next.id); } catch (e) { toast({ title: 'Could not open that outfit', message: e.message, kind: 'error' }); }
}

/* ========================================================================= */
/* PALETTE                                                                   */
/* ========================================================================= */

function palette() {
  const cmds = [];
  const o = state.project;
  cmds.push({ group: 'Go', label: 'Outfits', icon: 'library', key: 'mod+1', weight: 10, run: () => setRoute('outfits') });
  if (o) {
    cmds.push(
      { group: 'Go', label: 'Dress', icon: 'layers', key: 'mod+2', weight: 10, run: () => setRoute('dress') },
      { group: 'Go', label: 'Paint', icon: 'pencil', key: 'mod+3', weight: 9, keywords: 'base skin items brush draw', run: () => setRoute('paint') },
      { group: 'Create', label: 'Draw a new item…', icon: 'pencil', weight: 5, keywords: 'paint blank item', run: () => { state.paint.target = 'new'; setRoute('paint', { force: true }); } },
      { group: 'Go', label: 'Export', icon: 'download', key: 'mod+4', weight: 9, run: () => setRoute('export') },
      { group: 'Outfit', label: 'Change the base skin…', icon: 'image', weight: 7, keywords: 'base skin switch', run: () => openBasePicker() },
      { group: 'Outfit', label: 'Save now', icon: 'save', key: 'mod+S', weight: 5, run: () => saveProject().then(() => toast({ title: 'Saved', kind: 'ok', duration: 1400 })) },
      { group: 'Outfit', label: 'Close outfit', icon: 'x', weight: 4, run: async () => { await closeProject(); setRoute('outfits'); } },
    );
    for (const def of PRESETS) {
      const ref = `preset:${def.id}`;
      const worn = isWorn(o, ref);
      cmds.push({ group: 'Wear', label: `${worn ? 'Take off' : 'Wear'} ${def.name}`, icon: worn ? 'checkCirc' : 'plus', keywords: def.cat, weight: 1, run: () => { setRoute('dress'); toggleWear(ref); } });
    }
    for (const it of state.items.values()) {
      const ref = `item:${it.id}`;
      const worn = isWorn(o, ref);
      cmds.push({ group: 'Wear', label: `${worn ? 'Take off' : 'Wear'} ${it.name}`, icon: worn ? 'checkCirc' : 'plus', keywords: 'yours', weight: 1, run: () => { setRoute('dress'); toggleWear(ref); } });
    }
    for (const c of PRESET_CAPES) cmds.push({ group: 'Capes', label: `${c.name} cape`, icon: 'layers', weight: 0, run: () => { setRoute('dress'); setCape(`preset:${c.id}`); } });
    for (const c of OFFICIAL_CAPES) cmds.push({ group: 'Capes', label: `${c.name} cape`, icon: 'layers', keywords: 'official mojang', weight: 0, run: () => { setRoute('dress'); setCape(`mojang:${c.id}`); } });
    for (const c of state.capes.values()) cmds.push({ group: 'Capes', label: c.name, icon: 'layers', weight: 0, run: () => { setRoute('dress'); setCape(`cape:${c.id}`); } });
    if (o.cape) cmds.push({ group: 'Capes', label: 'Take the cape off', icon: 'x', weight: 1, run: () => setCape(null) });
  }
  for (const rec of state.library) {
    if (rec.id === o?.id) continue;
    cmds.push({ group: 'Outfits', label: rec.name, icon: 'chevRight', hint: rec.items ? plural(rec.items, 'item') : '', keywords: 'switch swap open', weight: 2,
      run: async () => { await openProject(rec.id); if (state.route === 'outfits') setRoute('dress'); } });
  }
  cmds.push(
    { group: 'Create', label: 'New outfit…', icon: 'plus', weight: 8, run: () => openNewOutfitDialog() },
    { group: 'Create', label: 'Wear a player’s skin…', icon: 'search', weight: 8, keywords: 'minecraft name username lookup mojang', run: () => openPlayerDialog({ mode: 'outfit' }) },
    { group: 'Create', label: 'Borrow a player’s cape…', icon: 'search', weight: 6, keywords: 'cape minecraft name', run: () => openPlayerDialog({ mode: 'cape' }) },
    { group: 'Create', label: 'Import a skin PNG…', icon: 'upload', weight: 6, run: () => openSkinFileDialog({ mode: 'base' }) },
    { group: 'Create', label: 'Make an item from a skin…', icon: 'sparkle', weight: 5, run: () => openSkinFileDialog({ mode: 'item' }) },
    { group: 'Create', label: 'Import a cape PNG…', icon: 'upload', weight: 5, run: () => openCapeFileDialog() },
    { group: 'App', label: state.prefs.theme === 'bone' ? 'Switch to dark' : 'Switch to light', icon: state.prefs.theme === 'bone' ? 'moon' : 'sun', weight: 3, run: () => setPref('theme', state.prefs.theme === 'bone' ? 'deepslate' : 'bone') },
    { group: 'App', label: 'Preferences', icon: 'sliders', weight: 3, run: () => showPreferences() },
    { group: 'App', label: 'Keyboard shortcuts', icon: 'keyboard', key: '?', weight: 2, run: () => showShortcuts() },
  );
  openPalette(cmds);
}

/* ========================================================================= */
/* PREFERENCES                                                               */
/* ========================================================================= */

export function showPreferences() {
  modal({
    title: 'Preferences',
    icon: 'sliders',
    body: h('.col.g-2',
      switchRow({
        title: 'Turntable',
        desc: 'Spin the model slowly on the Dress stage. T turns it on and off.',
        checked: !!state.prefs.turntable, onChange: v => setPref('turntable', v),
      }),
      h('.divider'),
      field('Theme', segmented({
        options: [
          { value: 'deepslate', label: 'Deepslate', icon: 'moon' },
          { value: 'bone', label: 'Bone', icon: 'sun' },
        ],
        value: state.prefs.theme, block: true, large: true,
        onChange: v => setPref('theme', v),
      })),
      switchRow({
        title: 'Block textures',
        desc: 'Generated stone and deepslate under the chrome. Off gives a flat, plain surface.',
        checked: state.prefs.textures !== false,
        onChange: v => setPref('textures', v),
      }),
      switchRow({
        title: 'Stone grain',
        desc: 'A very fine noise over the whole app.',
        checked: state.prefs.grain, onChange: v => setPref('grain', v),
      }),
      h('.divider'),
      switchRow({
        title: 'Interface sounds',
        desc: 'Frame & Groove’s synthesised clicks.',
        checked: state.prefs.sound !== false,
        onChange: v => { setPref('sound', v); if (v) sfxPreview('ok'); },
      }),
      field('Volume', h('.row.g-2',
        h('.grow', slider({
          min: 0, max: 100, value: state.prefs.soundVolume ?? 55,
          onInput: v => { state.prefs.soundVolume = v; },
          onChange: v => { setPref('soundVolume', v); sfxPreview('click'); },
          format: v => `${v}%`,
        })),
        h('button.btn.btn-sm', { dataset: { quiet: '' }, onclick: () => sfxPreview('place') },
          raw(icon('volume', 13)), h('span', { text: 'Test' })),
      )),
      switchRow({
        title: 'Reduce motion',
        desc: 'Cuts transitions and animation for a calmer interface.',
        checked: state.prefs.reduceMotion, onChange: v => setPref('reduceMotion', v),
      }),
      h('.divider'),
      h('.caption.muted', { text: 'Your outfits, skins and capes are stored in this browser and never leave your machine. Two things are fetched from outside: the official capes, from Mojang’s texture server by their texture ids (nothing about you goes with them) — and, only when you type a name to look a player up, that name, which goes to playerdb.co (or api.ashcon.app) because Mojang’s own lookup does not answer web pages. There are no accounts, no analytics and no servers of its own.' }),
      h('.divider'),
      h('.caption.muted', { text: 'Skin Slicer is a free, unofficial fan tool, offered as is with no warranty. Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.' }),
    ),
    actions: [{ label: 'Done', primary: true }],
  });
}

/* ========================================================================= */
/* SHORTCUTS                                                                 */
/* ========================================================================= */

const SHORTCUTS = [
  ['Everywhere', [
    ['mod+K', 'Command palette — every item and outfit by name'],
    ['mod+S', 'Save now'],
    ['mod+1…4', 'Jump between sections'],
    ['[ / ]', 'Previous / next outfit'],
    ['?', 'This sheet'],
  ]],
  ['Dress', [
    ['T', 'Turntable on and off'],
    ['O', 'Show or hide the outer layer'],
    ['C', 'Show or hide the cape'],
    ['H', 'Hide the selected item'],
    ['Delete', 'Take the selected item off'],
    ['/', 'Search the wardrobe'],
    ['Esc', 'Stop picking a colour off the model'],
  ]],
  ['Paint', [
    ['B', 'Brush'],
    ['E', 'Eraser'],
    ['L', 'Line'],
    ['U', 'Rectangle — hold Shift to fill it'],
    ['G', 'Fill a face'],
    ['R', 'Replace a colour everywhere'],
    ['I', 'Pick a colour'],
    ['S', 'Shade — hold Shift to lighten'],
    ['D', 'Dither'],
    ['N', 'Noise'],
    ['[ / ]', 'Smaller / bigger brush'],
    ['M', 'Mirror left and right'],
    ['O', 'Base layer / outer layer'],
    ['mod+Z', 'Undo'],
    ['mod+shift+Z', 'Redo'],
    ['Alt-drag', 'Turn the model while painting'],
  ]],
  ['Making an item', [
    ['W', 'Wand'],
    ['S', 'Skin — every shade of it'],
    ['C', 'A colour, everywhere'],
    ['E', 'Eraser'],
    ['R', 'Restore'],
    ['M', 'Mirror'],
    ['mod+Z', 'Undo'],
  ]],
];

export function showShortcuts() {
  modal({
    title: 'Keyboard shortcuts',
    icon: 'keyboard', width: 'wide',
    body: h('.col.g-5',
      ...SHORTCUTS.map(([group, rows]) => h('.col.g-2',
        h('.eyebrow', { text: group }),
        h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px 20px' },
          ...rows.map(([k, label]) => h('.row.between.g-3',
            h('span.body-sm', { text: label }),
            h('span.row.g-1', ...keyLabel(k).split(/(?<=\S)\s(?=\S)/).map(part => h('kbd', { text: part }))),
          )),
        ),
      )),
    ),
    actions: [{ label: 'Close', primary: true }],
  });
}

