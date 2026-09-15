/* ============================================================================
   Storage — IndexedDB for outfits, the wardrobe's contents, and preferences.

   Frame & Groove's db.js, re-cut for what this app keeps. Pixels are stored
   as raw Uint8ClampedArray, which IndexedDB holds natively, so a base you are
   painting saves without a PNG encode on every stroke.

   The database is called `skin-slicer`: the three tools share one origin on
   GitHub Pages, so a shared name would open each other's data. Anything kept
   under the app's old name is brought across the first time it opens.
   ========================================================================= */

const DB_NAME = 'skin-slicer';
const DB_VERSION = 2;           // 2: looks
/* What the database was called when the app was Fish's Wardrobe. */
const OLD_DB_NAME = 'fishs-wardrobe';

const S_OUTFITS = 'outfits';
const S_BASES   = 'bases';
const S_ITEMS   = 'items';
const S_CAPES   = 'capes';
const S_LOOKS   = 'looks';
const S_PREFS   = 'prefs';
const S_CACHE   = 'cache';

let _db = null;
let _opening = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening;
  _opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let fresh = false;
    req.onupgradeneeded = e => {
      fresh = e.oldVersion === 0;
      const db = req.result;
      if (!db.objectStoreNames.contains(S_OUTFITS)) {
        const s = db.createObjectStore(S_OUTFITS, { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      for (const name of [S_BASES, S_ITEMS, S_CAPES, S_LOOKS]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(S_PREFS)) db.createObjectStore(S_PREFS);
      if (!db.objectStoreNames.contains(S_CACHE)) db.createObjectStore(S_CACHE);
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { _db.close(); _db = null; _opening = null; };
      // A brand-new database may be new only because the app was renamed.
      (fresh ? bringAcrossOldName(_db) : Promise.resolve()).catch(() => {}).then(() => resolve(_db));
    };
    req.onerror = () => { _opening = null; reject(req.error); };
    req.onblocked = () => { _opening = null; reject(new Error('Storage is blocked by another open tab of this app.')); };
  });
  return _opening;
}

/**
 * Everything the app stored under its old name, copied into this one. It runs
 * once, when the database is created. Anything in the way — no old database,
 * or a browser that will not open both — leaves the new one empty, which is
 * where it would have been anyway.
 */
async function bringAcrossOldName(db) {
  const old = await new Promise(res => {
    const r = indexedDB.open(OLD_DB_NAME);
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
    r.onblocked = () => res(null);
    // No such database: do not leave an empty one behind.
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch { /* it errors either way */ } res(null); };
  });
  if (!old) return;
  try {
    for (const name of [...old.objectStoreNames]) {
      if (!db.objectStoreNames.contains(name)) continue;
      const src = old.transaction(name).objectStore(name);
      const [values, keys] = await Promise.all([wrap(src.getAll()), wrap(src.getAllKeys())]);
      if (!values.length) continue;
      await new Promise((res, rej) => {
        const t = db.transaction(name, 'readwrite');
        const os = t.objectStore(name);
        values.forEach((v, i) => (os.keyPath ? os.put(v) : os.put(v, keys[i])));
        t.oncomplete = res;
        t.onerror = () => rej(t.error);
      });
    }
    console.info('Skin Slicer: brought your wardrobe across from the app’s old name.');
  } finally { old.close(); }
}

function tx(store, mode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}
function wrap(request) {
  return new Promise((res, rej) => {
    request.onsuccess = () => res(request.result);
    request.onerror = () => rej(request.error);
  });
}

async function put(store, value, key) { return wrap((await tx(store, 'readwrite')).put(value, key)); }
async function get(store, key)        { return wrap((await tx(store)).get(key)); }
async function del(store, key)        { return wrap((await tx(store, 'readwrite')).delete(key)); }
async function all(store)             { return wrap((await tx(store)).getAll()); }

const table = store => ({
  all: () => all(store),
  get: id => get(store, id),
  save: rec => put(store, rec),
  remove: id => del(store, id),
});

export const Outfits = {
  ...table(S_OUTFITS),
  async list() {
    const rows = await all(S_OUTFITS);
    return rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
};
export const Bases = table(S_BASES);
export const Items = table(S_ITEMS);
export const Capes = table(S_CAPES);
export const Looks = table(S_LOOKS);

export const Prefs = {
  async get(key, fallback = null) {
    const v = await get(S_PREFS, key);
    return v === undefined ? fallback : v;
  },
  set: (key, value) => put(S_PREFS, value, key),
  remove: key => del(S_PREFS, key),
};

export const Cache = {
  get: key => get(S_CACHE, key),
  set: (key, value) => put(S_CACHE, value, key),
  remove: key => del(S_CACHE, key),
};

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota, pct: quota ? usage / quota : 0 };
  } catch { return null; }
}

export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}
