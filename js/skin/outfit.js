/* ============================================================================
   Outfit — the document the wardrobe is made of.

   An outfit is a base skin plus the things worn over it, in order:

     outfit.baseId   which base skin (bases are shared: paint one and every
                     outfit built on it changes with it)
     outfit.items[]  { key, ref, tints, hidden, hideUnder }, drawn first to
                     last, so later items sit on top
     outfit.cape     { ref, tints, hidden } or null

   `ref` is 'preset:<id>' for the built-in wardrobe and 'item:<id>' / 'cape:<id>'
   for your own. `tints` maps a colour-group index to a hex colour; a group
   that is not in it is drawn as it was made.

   Nothing here holds pixels. The document is small enough to autosave on
   every swatch drag.
   ========================================================================= */

import { uid } from '../core/util.js';

export const SCHEMA_VERSION = 1;
export const BACKUP_DIR = 'wardrobe';
export const BACKUP_FILE = `${BACKUP_DIR}/wardrobe.json`;

export function createOutfit({ name = 'My outfit', baseId = null } = {}) {
  const now = Date.now();
  return {
    id: uid('fit'),
    schema: SCHEMA_VERSION,
    name: name.trim() || 'My outfit',
    baseId,
    items: [],
    cape: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function wornEntry(ref) {
  return { key: uid('w'), ref, tints: {}, hidden: false, hideUnder: true };
}

export const findWorn = (outfit, ref) => outfit?.items?.find(w => w.ref === ref) || null;
export const isWorn = (outfit, ref) => !!findWorn(outfit, ref);

export function outfitStats(outfit) {
  const items = outfit?.items || [];
  return {
    items: items.length,
    showing: items.filter(w => !w.hidden).length,
    cape: !!outfit?.cape,
    tinted: items.filter(w => Object.keys(w.tints || {}).length).length,
  };
}

export function outfitToJSON(outfit) {
  return JSON.parse(JSON.stringify({ ...outfit, schema: SCHEMA_VERSION }));
}

export function outfitFromJSON(j) {
  return migrate(JSON.parse(JSON.stringify(j)));
}

/**
 * Tints as the app expects them — a group number to a '#rrggbb' — whatever
 * a backup or an old version wrote. Anything else is dropped rather than
 * left to break the drawing of the outfit.
 */
export function cleanTints(t) {
  if (!t || typeof t !== 'object') return {};
  return Object.fromEntries(Object.entries(t).filter(([k, v]) => /^\d+$/.test(k) && typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)));
}

export function migrate(o) {
  o.schema = SCHEMA_VERSION;
  o.name = String(o.name || 'Outfit').slice(0, 80);
  o.items = (Array.isArray(o.items) ? o.items : []).filter(w => w && typeof w.ref === 'string')
    .map(w => ({ key: w.key || uid('w'), ref: w.ref, tints: cleanTints(w.tints), hidden: !!w.hidden, hideUnder: w.hideUnder !== false }));
  o.cape = o.cape && typeof o.cape.ref === 'string' ? { ref: o.cape.ref, tints: cleanTints(o.cape.tints), hidden: !!o.cape.hidden } : null;
  return o;
}
