/* ============================================================================
   Outfits — every outfit you have made, and the front door for new ones.
   ========================================================================= */

import { h, raw, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { relTime, plural, fuzzyScore, downloadBlob } from '../../core/util.js';
import {
  state, bus, refreshLibrary, openProject, deleteProject, duplicateProject, setRoute,
  composeOutfit, outfitDoc, addStarterBase, newProject, markDirty, saveProject,
} from '../../core/store.js';
import { Outfits } from '../../core/db.js';
import { modal, toast, confirmDialog, contextMenu, promptDialog, emptyState, note, dropzone, progressBar } from '../kit.js';
import { renderScene } from '../thumbs.js';
import { openPlayerDialog, openNewOutfitDialog, openSkinFileDialog } from '../sources.js';
import { importBackup, fileSafe } from '../../export/backup.js';
import { imageToPng } from '../../skin/image.js';
import { validName } from '../../skin/mojang.js';

/* Card pictures are drawn once per version of the outfit, its base and the
   wardrobe it draws from. */
const art = new Map();
let wardrobeRev = 0;
bus.on('items', () => { wardrobeRev++; });
bus.on('capes', () => { wardrobeRev++; });

function cardArt(rec) {
  const o = outfitDoc(rec);
  const base = state.bases.get(o.baseId);
  const key = `${rec.id}|${o === state.project ? 'live' : rec.updatedAt}|${base?.updatedAt}|${wardrobeRev}|${JSON.stringify(o.items)}|${JSON.stringify(o.cape)}`;
  if (art.has(key)) return art.get(key);
  // Every edit makes a new key, so the old pictures are let go now and then.
  if (art.size > 120) art.clear();
  const c = composeOutfit(o);
  const cv = renderScene({ skin: c.skin, cape: c.cape, slim: c.model === 'slim', view: 'card', px: 300 });
  const url = cv ? cv.toDataURL('image/png') : null;
  art.set(key, url);
  return url;
}

export function buildOutfitsView() {
  const grid = h('.lib-grid.stagger');
  const search = h('input.input.lib-search', { type: 'search', placeholder: 'Search outfits…', oninput: () => render() });
  const searchWrap = h('.input-group', h('span.input-icon', raw(icon('search', 14))), search);
  const sortSel = h('select.select', { style: 'width:150px', 'aria-label': 'Sort outfits', onchange: () => render() },
    h('option', { value: 'updated' }, 'Last edited'),
    h('option', { value: 'created' }, 'Date created'),
    h('option', { value: 'name' }, 'Name'),
    h('option', { value: 'size' }, 'Most items'),
  );
  const count = h('.caption.muted');

  const view = h('.view', { dataset: { view: 'outfits' } },
    h('.view-header',
      h('.vh-text',
        h('h1', { text: 'Your outfits' }),
        h('p', { text: 'Each outfit is a base skin and what is worn over it. Swap between them with [ and ], and export any of them as a skin the game reads.' }),
      ),
      h('.row.g-2.wrap',
        h('button.btn.btn-lg', { onclick: () => openImportBackup() }, raw(icon('upload', 15)), h('span', { text: 'Import backup' })),
        h('button.btn.btn-lg', { onclick: () => openPlayerDialog({ mode: 'outfit' }) }, raw(icon('search', 15)), h('span', { text: 'Wear a player’s skin' })),
        h('button.btn.btn-lg.btn-primary', { onclick: () => openNewOutfitDialog() }, raw(icon('plus', 15)), h('span', { text: 'New outfit' })),
      ),
    ),
    h('.lib-toolbar', searchWrap, sortSel, h('.spacer'), count),
    h('.view-body', grid),
    h('.lib-footer',
      h('span.caption.muted', { text: 'Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.' }),
    ),
  );

  function render() {
    const q = search.value.trim();
    const sort = sortSel.value;
    let rows = [...state.library];
    if (q) {
      rows = rows.map(r => ({ r, s: fuzzyScore(q, r.name) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.r);
    } else {
      rows.sort((a, b) =>
        sort === 'name' ? a.name.localeCompare(b.name)
        : sort === 'created' ? (b.createdAt || 0) - (a.createdAt || 0)
        : sort === 'size' ? (b.items || 0) - (a.items || 0)
        : (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    clear(grid);
    count.textContent = rows.length ? plural(rows.length, 'outfit') : '';
    if (!state.library.length) {
      grid.style.display = 'block';
      grid.appendChild(firstRunPanel());
      return;
    }
    grid.style.display = '';
    if (!rows.length) {
      grid.style.display = 'block';
      grid.appendChild(emptyState({
        iconName: 'search', title: 'Nothing matches',
        message: `No outfit is called “${q}”.`,
        action: h('button.btn', { text: 'Clear search', onclick: () => { search.value = ''; render(); } }),
      }));
      return;
    }
    grid.appendChild(h('button.proj-card.proj-card-new', { onclick: () => openNewOutfitDialog() },
      raw(icon('plus', 24)),
      h('.strong', { text: 'New outfit' }),
      h('.caption', { text: 'Pick a base, then dress it' }),
    ));
    for (const rec of rows) grid.appendChild(outfitCard(rec));
  }

  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (state.route === 'outfits') render(); else stale = true; });
  };
  let stale = false;
  for (const evt of ['library', 'bases', 'base:saved', 'items', 'capes', 'project:saved']) bus.on(evt, later);
  bus.on('prefs', key => { if (key === 'theme') later(); });
  view.refresh = () => { render(); stale = false; };
  render();
  return view;
}

/* ---- Card --------------------------------------------------------------- */

function outfitCard(rec) {
  const o = outfitDoc(rec);
  const base = state.bases.get(o.baseId);
  const url = cardArt(rec);
  const current = state.project?.id === rec.id;
  return h('button.proj-card.fit-card', {
    dataset: { current: String(current) },
    onclick: () => open(rec.id),
    oncontextmenu: e => { e.preventDefault(); cardMenu(rec, { x: e.clientX, y: e.clientY }); },
  },
    h('.pc-art.fit-art', url ? h('img', { src: url, alt: '' }) : h('span.caption', { text: 'No 3D preview in this browser' })),
    h('.pc-body',
      h('.pc-name.truncate', { text: rec.name }),
      h('.pc-ns.truncate', { text: base ? `on ${base.name} · ${base.model === 'slim' ? 'slim' : 'classic'}` : 'its base skin is missing' }),
      h('.pc-stats',
        h('span.stat-mini', { 'data-tip': 'Items worn' }, raw(icon('layers', 12)), h('span', { text: String(o.items.length) })),
        o.cape ? h('span.stat-mini', { text: 'Cape' }) : null,
        current ? h('span.badge.badge-accent', { text: 'Open' }) : null,
        h('.spacer'),
        h('span.caption', { text: relTime(rec.updatedAt) }),
      ),
    ),
    h('span.btn.btn-sm.btn-icon.pc-menu', {
      role: 'button', 'aria-label': 'More',
      onclick: e => { e.stopPropagation(); cardMenu(rec, e.currentTarget); },
    }, raw(icon('more', 14))),
  );
}

async function downloadSkin(rec) {
  const o = outfitDoc(rec);
  const { skin } = composeOutfit(o);
  downloadBlob(await imageToPng(skin), `${fileSafe(o.name)}.png`);
}

function cardMenu(rec, at) {
  contextMenu([
    { label: 'Open', icon: 'chevRight', run: () => open(rec.id) },
    { label: 'Rename…', icon: 'edit', run: async () => {
        const v = await promptDialog({ title: 'Rename outfit', value: rec.name, confirmLabel: 'Rename' });
        if (!v?.trim()) return;
        if (state.project?.id === rec.id) { state.project.name = v.trim(); markDirty('name'); await saveProject({ silent: true }); }
        else {
          const doc = { ...rec.doc, name: v.trim() };
          await Outfits.save({ ...rec, name: v.trim(), doc });
        }
        await refreshLibrary();
      } },
    { label: 'Duplicate', icon: 'duplicate', run: async () => {
        if (state.project?.id === rec.id && state.projectDirty) await saveProject({ silent: true });
        await duplicateProject(rec.id);
        toast({ title: 'Duplicated', message: `“${rec.name} copy” is in your outfits.`, kind: 'ok' });
      } },
    { label: 'Download skin PNG', icon: 'download', run: () => downloadSkin(rec) },
    '-',
    { label: 'Delete…', icon: 'trash', destructive: true, run: async () => {
        const ok = await confirmDialog({
          title: `Delete “${rec.name}”?`,
          message: 'The outfit is removed from this browser. Its base skin, your items and your capes stay, and any PNG you already exported is untouched.',
          confirmLabel: 'Delete outfit', danger: true,
        });
        if (!ok) return;
        await deleteProject(rec.id);
        toast({ title: 'Outfit deleted', kind: 'ok' });
      } },
  ], at);
}

async function open(id) {
  try {
    if (state.project?.id !== id) await openProject(id);
    setRoute('dress', { force: true });
  } catch (e) {
    toast({ title: 'Could not open that outfit', message: e.message, kind: 'error' });
    await refreshLibrary();
  }
}

/* ---- First run ---------------------------------------------------------- */
function firstRunPanel() {
  const step = (n, title, body) => h('.install-step',
    h('.is-num', { text: String(n) }),
    h('.is-body', h('strong', { text: title }), h('div', { style: 'margin-top:2px' }, body)),
  );
  const nameInput = h('input.input.hero-input', {
    placeholder: 'Your Minecraft name', maxlength: 36, autocomplete: 'off', spellcheck: 'false',
    onkeydown: e => { if (e.key === 'Enter') go(); },
  });
  const go = () => {
    const v = nameInput.value.trim();
    if (v && !validName(v)) { toast({ title: 'That is not a Minecraft name', message: '1–16 letters, numbers and underscores.', kind: 'warn' }); return; }
    openPlayerDialog({ mode: 'outfit', initial: v });
  };
  const mannequin = async () => {
    const b = await addStarterBase();
    await newProject({ name: 'First outfit', baseId: b.id });
    setRoute('dress', { force: true });
  };
  return h('.col.g-6', { style: 'max-width:760px;margin:24px auto 0' },
    h('.card.card-pad.col.g-4',
      h('.col.g-1',
        h('h2.title', { text: 'Dress up any skin' }),
        h('p.body', { text: 'Start from your own skin, put things on over it — hats, tops, capes — and recolour every piece one colour at a time. Keep as many outfits as you like and swap between them.' }),
      ),
      h('.hero-row',
        h('.input-group.grow', h('span.input-icon', raw(icon('search', 15))), nameInput),
        h('button.btn.btn-xl.btn-primary', { onclick: go }, h('span', { text: 'Get my skin' })),
      ),
      h('.divider'),
      h('div',
        step(1, 'Pick a base', 'Your skin by name, any skin PNG, or the plain mannequin. Your cape comes along if you have one.'),
        step(2, 'Dress it', 'Click things in the wardrobe to put them on. Tint any colour of any item — a red-and-green hat can be blue-and-yellow.'),
        step(3, 'Export', 'One PNG, ready for minecraft.net or the launcher’s Skins tab.'),
      ),
      h('.row.g-2.wrap',
        h('button.btn.btn-lg', { onclick: () => openSkinFileDialog({ mode: 'base' }) }, raw(icon('upload', 15)), h('span', { text: 'Import a skin PNG' })),
        h('button.btn.btn-lg', { onclick: mannequin }, raw(icon('sparkle', 15)), h('span', { text: 'Start from the mannequin' })),
        h('button.btn.btn-lg', { onclick: () => openImportBackup() }, raw(icon('upload', 15)), h('span', { text: 'Import a backup' })),
      ),
    ),
    note('The only thing that ever leaves your browser is a name you type: Mojang’s own lookup does not answer web pages, so names go through playerdb.co. Everything you make stays here.', 'info'),
  );
}

/* ---- Backups ------------------------------------------------------------ */
export function openImportBackup(file) {
  if (file) { doImport(file); return; }
  modal({
    title: 'Import a backup',
    subtitle: 'A zip made by Export → “Download the whole wardrobe”. Outfits, skins, items, looks and capes all come back.',
    icon: 'upload',
    body: ({ close }) => dropzone({
      label: 'Drop a Skin Slicer zip', hint: 'or click to choose one',
      accept: '.zip,application/zip',
      onFiles: fs => { close(); doImport(fs[0]); },
    }),
    actions: [{ label: 'Cancel' }],
  });
}

async function doImport(file) {
  const prog = progressBar({ label: 'Reading…' });
  prog.set(0.3, 'Reading…');
  const m = modal({ title: 'Importing', subtitle: file.name, icon: 'upload', body: prog, dismissable: false });
  try {
    const openId = state.project?.id;
    const n = await importBackup(file);
    m.close();
    if (openId && state.library.some(r => r.id === openId)) await openProject(openId);
    toast({
      title: 'Everything restored',
      message: `${plural(n.outfits, 'outfit')}, ${plural(n.bases, 'skin')}, ${plural(n.items, 'item')}, ${plural(n.looks || 0, 'look')} and ${plural(n.capes, 'cape')}.`,
      kind: 'ok',
    });
  } catch (e) {
    m.close();
    toast({ title: 'Could not import that', message: e.message, kind: 'error' });
  }
}
