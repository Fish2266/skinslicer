/* ============================================================================
   Export — the outfit as the one PNG the game reads, its cape, and the whole
   wardrobe as a backup.
   ========================================================================= */

import { h, raw, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { downloadBlob, formatBytes, plural } from '../../core/util.js';
import { state, bus, composeOutfit, baseOf } from '../../core/store.js';
import { imageToPng } from '../../skin/image.js';
import { panel, note, progressBar, toast } from '../kit.js';
import { renderScene, flatCanvas } from '../thumbs.js';
import { buildBackup, fileSafe } from '../../export/backup.js';

export function buildExportView() {
  const body = h('.view-body');
  const view = h('.view', { dataset: { view: 'export' } },
    h('.view-header',
      h('.vh-text',
        h('h1', { text: 'Export' }),
        h('p', { text: 'The base with everything worn flattened into one 64×64 PNG — a skin the game reads, ready to upload.' }),
      ),
    ),
    body,
  );

  function render() {
    clear(body);
    const o = state.project;
    if (!o) return;
    const c = composeOutfit(o);
    const slim = c.model === 'slim';
    body.appendChild(h('.export-grid.export-wrap',
      h('.col.g-5', skinPanel(o, c, slim), c.cape ? capePanel(o, c) : null),
      h('.col.g-5', installPanel(slim), backupPanel()),
    ));
  }

  /* ---- Skin ---- */
  function skinPanel(o, c, slim) {
    const name = `${fileSafe(o.name)}.png`;
    const pics = h('.export-pics',
      ...['front', 'back'].map(v => renderScene({ skin: c.skin, cape: c.cape, slim, view: v, px: 220 }) || null).filter(Boolean),
      h('.flat-preview.checker.checker-sm', flatCanvas(c.skin, 4)),
    );
    const hidden = o.items.filter(w => w.hidden).length;
    const download = async () => {
      const blob = await imageToPng(c.skin);
      downloadBlob(blob, name);
      toast({ title: 'Skin saved', message: `${name} · ${formatBytes(blob.size)}`, kind: 'ok' });
    };
    const copy = async () => {
      try {
        const blob = await imageToPng(c.skin);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast({ title: 'Copied', message: 'The skin PNG is on your clipboard.', kind: 'ok', duration: 1800 });
      } catch { toast({ title: 'Could not copy', message: 'This browser will not put images on the clipboard — download it instead.', kind: 'warn' }); }
    };
    return panel('Skin', [h('.col.g-4',
      pics,
      h('.export-target',
        h('.et-icon', raw(icon('image', 18))),
        h('.et-main',
          h('.et-name.truncate', { text: name }),
          h('.et-meta', { text: `64 × 64 · ${slim ? 'slim' : 'classic'} arms · ${plural(o.items.length - hidden, 'item')} worn${c.cape ? ' · cape not included' : ''}` }),
        ),
      ),
      h('.row.g-2',
        h('button.btn.btn-xl.btn-primary.grow', { onclick: download }, raw(icon('download', 16)), h('span', { text: 'Download skin PNG' })),
        typeof ClipboardItem === 'function' ? h('button.btn.btn-xl', { onclick: copy, 'data-tip': 'Copy the image' }, raw(icon('copy', 16))) : null,
      ),
      hidden ? note(`${plural(hidden, 'hidden item')} left out — they are hidden in the Dress view.`, 'info') : null,
      !baseOf(o) ? note('This outfit’s base skin is missing, so it exports over the mannequin.', 'warn') : null,
      note(`Upload it with the ${slim ? 'Slim (Alex)' : 'Classic (Steve)'} arm model. Pick the other one and the arms come out a pixel wrong.`, slim ? 'warn' : 'info'),
    )]);
  }

  /* ---- Cape ---- */
  function capePanel(o, c) {
    const name = `${fileSafe(o.name)}_cape.png`;
    return panel('Cape', [h('.col.g-4',
      h('.export-pics',
        renderScene({ skin: c.skin, cape: c.cape, slim: c.model === 'slim', view: 'back', px: 180 }),
        h('.flat-preview.checker.checker-sm', flatCanvas(c.cape, 4)),
      ),
      h('button.btn.btn-lg', { onclick: async () => downloadBlob(await imageToPng(c.cape), name) }, raw(icon('download', 15)), h('span', { text: 'Download cape PNG' })),
      note('Minecraft only shows capes Mojang gave the account, and a cape cannot be uploaded. This file is for mods and launchers that read cape files — and for keeping.', 'info'),
    )]);
  }

  /* ---- Instructions ---- */
  function installPanel(slim) {
    const step = (n, title, content) => h('.install-step',
      h('.is-num', { text: String(n) }),
      h('.is-body', h('strong', { text: title }), h('div', { style: 'margin-top:2px' }, content)),
    );
    const model = slim ? 'Slim' : 'Classic';
    return panel('Putting it on', [
      h('div',
        step(1, 'In the launcher', `Open the Skins tab, press New skin, choose the PNG and the ${model} model, then Save & use.`),
        step(2, 'Or on the website', h('span', 'Sign in at ', h('code', { text: 'minecraft.net' }), `, open your profile’s Skin page, upload the PNG and pick ${model}.`)),
        step(3, 'Rejoin', 'The game fetches skins when it loads a player, so a world or server you are already in shows the new one after you rejoin.'),
      ),
      note('This is a Java Edition skin file. Bedrock can use the same 64×64 PNG as a custom skin from its own dressing room.', 'info'),
    ]);
  }

  /* ---- Backup ---- */
  function backupPanel() {
    const prog = progressBar({ label: '' });
    prog.hidden = true;
    const btn = h('button.btn.btn-lg.btn-block', { onclick: () => go() }, raw(icon('package', 15)), h('span', { text: 'Download the whole wardrobe' }));
    async function go() {
      btn.disabled = true;
      prog.hidden = false;
      try {
        const blob = await buildBackup({ onProgress: (p, msg) => prog.set(p, msg) });
        downloadBlob(blob, 'skin-slicer.zip');
        prog.set(1, `skin-slicer.zip — ${formatBytes(blob.size)}`);
        toast({ title: 'Backup saved', message: `${plural(state.library.length, 'outfit')}, ${formatBytes(blob.size)}.`, kind: 'ok' });
      } catch (e) {
        console.error(e);
        prog.hidden = true;
        toast({ title: 'Could not build the zip', message: e.message, kind: 'error' });
      } finally { btn.disabled = false; }
    }
    return panel('Everything', [h('.col.g-3',
      h('.caption', { text: `Every outfit as a finished skin, plus every base, item, look and cape — ${plural(state.library.length, 'outfit')}, ${plural(state.bases.size, 'skin')}, ${plural(state.items.size, 'item')} of your own, ${plural(state.looks.size, 'look')}, ${plural(state.capes.size, 'cape')}.` }),
      btn, prog,
      h('.caption.muted', { text: 'Your wardrobe lives in this browser, and browsers can clear site data. This zip is the real backup — drop it on the Outfits page to put everything back.' }),
    )]);
  }

  bus.on('project:open', () => { if (state.route === 'export') render(); });
  bus.on('outfit:changed', () => { if (state.route === 'export') render(); });
  view.refresh = render;
  return view;
}
