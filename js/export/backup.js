/* ============================================================================
   The wardrobe zip — every outfit as a ready-to-upload skin, and everything
   needed to put the wardrobe back exactly as it was.

     skin-slicer.zip
     ├── skins/<outfit>.png           upload these to minecraft.net
     ├── capes/<outfit>_cape.png
     └── wardrobe/
         ├── wardrobe.json            outfits, looks, and what the PNGs below are
         ├── bases/<id>.png
         ├── items/<id>.png
         └── capes/<id>.png

   Ids are kept, so dropping the same backup in twice replaces rather than
   duplicates. Like its siblings' pack zips, exporting is the real backup:
   browsers can clear site data.
   ========================================================================= */

import { ZipWriter, unzip, jsonOf } from './zip.js';
import { AppError, slugifyId, uniqueId } from '../core/util.js';
import { state, composeOutfit, outfitDoc, refreshLibrary, loadWardrobe, bus } from '../core/store.js';
import { Outfits, Bases, Items, Capes, Looks } from '../core/db.js';
import { imageToPng, decodeImage, normalizeSkin, normalizeCape } from '../skin/image.js';
import { BACKUP_DIR, BACKUP_FILE, SCHEMA_VERSION, outfitFromJSON, outfitStats, cleanTints } from '../skin/outfit.js';
import { CATEGORIES } from '../skin/items.js';

export const fileSafe = s => slugifyId(s, 'outfit');

/* Colour groups go along, so tints on the other side mean the same thing. */
const meta = ({ id, name, model, cat, split, source, createdAt, groupMap, groupDefs, groupSplit }) => ({
  id, name, model, cat, split, source, createdAt,
  ...(groupMap ? { groupMap: Array.from(groupMap), groupDefs, groupSplit } : {}),
});
const groupsBack = r => (Array.isArray(r.groupMap) ? { groupMap: new Int8Array(r.groupMap) } : {});

export async function buildBackup({ onProgress } = {}) {
  const zip = new ZipWriter();
  const taken = new Set();
  const outfits = state.library.map(outfitDoc);
  let i = 0;
  for (const o of outfits) {
    onProgress?.(i++ / (outfits.length + 1), `Dressing ${o.name}`);
    const { skin, cape } = composeOutfit(o);
    const n = uniqueId(fileSafe(o.name), taken);
    taken.add(n);
    zip.file(`skins/${n}.png`, await imageToPng(skin));
    if (cape) zip.file(`capes/${n}_cape.png`, await imageToPng(cape));
  }
  onProgress?.(outfits.length / (outfits.length + 1), 'Packing the wardrobe');
  for (const b of state.bases.values()) zip.file(`${BACKUP_DIR}/bases/${b.id}.png`, await imageToPng(b.img));
  for (const it of state.items.values()) zip.file(`${BACKUP_DIR}/items/${it.id}.png`, await imageToPng(it.img));
  for (const c of state.capes.values()) zip.file(`${BACKUP_DIR}/capes/${c.id}.png`, await imageToPng(c.img));
  zip.json(BACKUP_FILE, {
    app: 'skin-slicer',
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    outfits,
    bases: [...state.bases.values()].map(meta),
    items: [...state.items.values()].map(meta),
    capes: [...state.capes.values()].map(meta),
    looks: [...state.looks.values()],
  });
  zip.file('README.txt', [
    'Skin Slicer',
    '',
    'skins/  — every outfit as a finished skin. Upload one at minecraft.net or in the launcher’s Skins tab.',
    'capes/  — the capes those outfits wear. Minecraft only shows capes Mojang gave the account; these are for mods and for keeping.',
    '',
    'Drop this whole zip onto Skin Slicer to put everything back.',
    '',
  ].join('\n'));
  const blob = await zip.blob();
  onProgress?.(1, 'Done');
  return blob;
}

export async function importBackup(file) {
  const files = await unzip(file);
  const doc = jsonOf(files.get(BACKUP_FILE));
  // 'fishs-wardrobe' is what the app called itself before it was Skin Slicer.
  if (!doc || (doc.app !== 'skin-slicer' && doc.app !== 'fishs-wardrobe')) throw new AppError('That zip is not a Skin Slicer backup.');
  const png = async path => {
    const bytes = files.get(path);
    return bytes ? decodeImage(new Blob([bytes], { type: 'image/png' })) : null;
  };
  const now = Date.now();
  const n = { outfits: 0, bases: 0, items: 0, capes: 0, looks: 0 };

  for (const b of doc.bases || []) {
    const img = await png(`${BACKUP_DIR}/bases/${b.id}.png`);
    if (!img) continue;
    await Bases.save({ ...b, model: b.model === 'slim' ? 'slim' : 'classic', pixels: new Uint8ClampedArray(normalizeSkin(img).img.data), updatedAt: now });
    n.bases++;
  }
  for (const it of doc.items || []) {
    const img = await png(`${BACKUP_DIR}/items/${it.id}.png`);
    if (!img || img.width !== 64 || img.height !== 64) continue;
    const cat = CATEGORIES.some(c => c.id === it.cat) ? it.cat : 'extras';
    await Items.save({ ...it, ...groupsBack(it), cat, split: it.split ?? 0.5, pixels: new Uint8ClampedArray(img.data), updatedAt: now });
    n.items++;
  }
  for (const c of doc.capes || []) {
    const img = await png(`${BACKUP_DIR}/capes/${c.id}.png`);
    if (!img) continue;
    await Capes.save({ ...c, ...groupsBack(c), split: c.split ?? 0.5, pixels: new Uint8ClampedArray(normalizeCape(img).img.data), updatedAt: now });
    n.capes++;
  }
  for (const l of doc.looks || []) {
    if (!l?.id || !Array.isArray(l.items)) continue;
    await Looks.save({ id: l.id, name: l.name || 'A look', items: l.items.filter(e => typeof e?.ref === 'string').map(e => ({ ref: e.ref, tints: cleanTints(e.tints) })), createdAt: l.createdAt || now, updatedAt: now });
    n.looks++;
  }
  for (const raw of doc.outfits || []) {
    if (!raw?.id) continue;
    const o = outfitFromJSON(raw);
    const s = outfitStats(o);
    await Outfits.save({ id: o.id, name: o.name, baseId: o.baseId, createdAt: o.createdAt || now, updatedAt: now, items: s.items, cape: s.cape, doc: o });
    n.outfits++;
  }
  await loadWardrobe();
  await refreshLibrary();
  bus.emit('bases'); bus.emit('items'); bus.emit('capes'); bus.emit('looks');
  return n;
}
