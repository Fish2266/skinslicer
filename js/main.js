/* ============================================================================
   Skin Slicer — entry point.
   ========================================================================= */

import { $, h, raw, on } from './core/dom.js';
import { sleep } from './core/util.js';
import { icon } from './core/icons.js';
import { state, loadPrefs, refreshLibrary, setRoute, openProject, saveProject, bus, loadWardrobe, flushBaseSaves, fetchOfficialCapes } from './core/store.js';
import { Prefs, openDB } from './core/db.js';
import { installTextures } from './ui/textures.js';
import { installFavicon, drawMark } from './ui/brandmark.js';
import { buildShell } from './ui/shell.js';
import { buildOutfitsView } from './ui/views/outfits.js';
import { buildDressView } from './ui/views/dress.js';
import { buildPaintView } from './ui/views/paint.js';
import { buildExportView } from './ui/views/export.js';
import { toast } from './ui/kit.js';
import { installSfx } from './ui/sfx.js';
import { installTooltips } from './ui/tooltip.js';

const BOOT_BLOCKS = 12;

async function boot() {
  const startedAt = performance.now();
  const bootEl = $('#boot');
  const bootTag = $('#boot-tag');
  const bootBar = $('#boot-bar');

  const markEl = $('#boot-mark');
  if (markEl) drawMark(markEl, 128);

  const blocks = [];
  if (bootBar) {
    for (let i = 0; i < BOOT_BLOCKS; i++) {
      const b = document.createElement('i');
      bootBar.appendChild(b);
      blocks.push(b);
    }
  }
  let filled = 0;
  const say = (text, progress) => {
    if (bootTag) bootTag.textContent = text;
    if (progress == null) return;
    const target = Math.round(progress * BOOT_BLOCKS);
    for (; filled < target; filled++) blocks[filled]?.setAttribute('data-on', 'true');
  };

  try {
    say('Opening storage', 0.1);
    await openDB();

    say('Reading your preferences', 0.22);
    await loadPrefs();
    installTextures();
    installFavicon();

    say('Opening the wardrobe', 0.4);
    await loadWardrobe();

    say('Counting your outfits', 0.56);
    await refreshLibrary();

    say('Setting up the mirror', 0.72);
    const views = {
      outfits: buildOutfitsView(),
      dress: buildDressView(),
      paint: buildPaintView(),
      export: buildExportView(),
    };
    const app = buildShell(views);
    document.body.insertBefore(app, bootEl);
    installSfx();
    installTooltips();

    say('Opening where you left off', 0.88);
    const last = await Prefs.get('lastProject', null);
    if (last && state.library.some(r => r.id === last)) {
      try {
        await openProject(last);
        setRoute(await Prefs.get('lastRoute', 'dress'), { force: true });
      } catch { setRoute('outfits', { force: true }); }
    } else {
      setRoute('outfits', { force: true });
    }
    bus.on('route', r => { if (r !== 'outfits') Prefs.set('lastRoute', r); });

    state.ready = true;
    say('Ready', 1);
    // The official capes come from Mojang's texture server the first time and
    // from the cache after; nothing waits on them.
    fetchOfficialCapes();
    const held = Math.max(0, 420 - (performance.now() - startedAt));
    if (held) await sleep(held);
    // A frame normally ends the splash; the timer covers a tab opened in the
    // background, where frames do not run until it is looked at.
    const finish = () => {
      if (bootEl.dataset.done) return;
      bootEl.dataset.done = 'true';
      const drop = () => bootEl.remove();
      bootEl.addEventListener('transitionend', drop, { once: true });
      setTimeout(drop, 1200);
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 250);

    const flush = () => {
      flushBaseSaves();
      if (state.projectDirty) saveProject({ silent: true }).catch(() => {});
    };
    on(document, 'visibilitychange', () => { if (document.hidden) flush(); });
    on(window, 'pagehide', flush);

    console.info('%cSkin Slicer', 'font-weight:700;font-size:13px',
      `— ready. ${state.library.length} outfits, ${state.bases.size} skins, ${state.items.size} items, ${state.looks.size} looks and ${state.capes.size} capes of your own; ${state.official.size} official capes cached.`);
  } catch (e) {
    console.error(e);
    bootEl.innerHTML = '';
    bootEl.appendChild(h('.col.g-4.center.boot-error',
      h('span', { style: 'color:var(--danger)' }, raw(icon('alert', 34))),
      h('h1.title', { text: 'Skin Slicer could not start' }),
      h('p.body', { text: e.message }),
      h('p.caption.muted', { text: 'This usually means the browser is blocking local storage, or the page was opened directly from the file system. Serve the folder over http and it will work.' }),
      h('button.btn.btn-lg.btn-primary', { onclick: () => location.reload() }, 'Try again'),
    ));
  }
}

on(window, 'error', e => {
  if (!state.ready) return;
  console.error(e.error || e.message);
});
on(window, 'unhandledrejection', e => {
  if (!state.ready) return;
  console.error('Unhandled:', e.reason);
  const msg = e.reason?.message || String(e.reason || '');
  if (msg && !/aborted|cancell?ed/i.test(msg)) {
    toast({ title: 'Something went wrong', message: msg.slice(0, 160), kind: 'error' });
  }
});

boot();
