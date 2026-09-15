/* ============================================================================
   Capes — every official Java Edition cape, and the Fish.

   The official ones are Mojang's own textures, fetched by hash from
   textures.minecraft.net (the same host every skin lookup already reads) and
   kept in the cache store, so each is downloaded once. Nothing is sent but
   the hash. They tint like everything else: the colours are split into
   groups automatically, as with any imported cape.

   The game only shows a cape Mojang gave the account, so wearing one here is
   for the look, for mods that read cape files, and for matching the outfit
   to it.

   A cape is its own 64×32 sheet: the outside at (1, 1), the side against
   the player's back at (12, 1), one-pixel edges round both.
   ========================================================================= */

import { CAPE_W, CAPE_H } from './layout.js';
import { layerFromSlots } from './tint.js';

export const TEXTURE_HOST = 'https://textures.minecraft.net/texture/';

/* Grouped as the Minecraft Wiki groups them. Hashes checked against
   textures.minecraft.net: every one answers with a 64×32 PNG. */
export const CAPE_GROUPS = [
  { id: 'everyone', label: 'Given to everyone' },
  { id: 'events', label: 'Events' },
  { id: 'minecon', label: 'MINECON' },
  { id: 'staff', label: 'Mojang' },
  { id: 'community', label: 'Community' },
  { id: 'personal', label: 'One of a kind' },
];

export const OFFICIAL_CAPES = [
  { id: 'migrator', name: 'Migrator', group: 'everyone', hash: '2340c0e03dd24a11b15a8b33c2a7e9e32abb2051b2481d0ba7defd635ca7a933' },
  { id: 'vanilla', name: 'Vanilla', group: 'everyone', hash: 'f9a76537647989f9a0b6d001e320dac591c359e9e61a31f4ce11c88f207f0ad4' },
  { id: 'pan', name: 'Pan', group: 'everyone', hash: '28de4a81688ad18b49e735a273e086c18f1e3966956123ccb574034c06f5d336' },
  { id: 'common', name: 'Common', group: 'everyone', hash: '5ec930cdd2629c8771655c60eebeb867b4b6559b0e6d3bc71c40c96347fa03f0' },

  { id: 'founders', name: 'Founder’s', group: 'events', hash: '99aba02ef05ec6aa4d42db8ee43796d6cd50e4b2954ab29f0caeb85f96bf52a1' },
  { id: 'cherry', name: 'Cherry Blossom', group: 'events', hash: 'afd553b39358a24edfe3b8a9a939fa5fa4faa4d9a9c3d6af8eafb377fa05c2bb' },
  { id: 'followers', name: 'Follower’s', group: 'events', hash: '569b7f2a1d00d26f30efe3f9ab9ac817b1e6d35f4f3cfb0324ef2d328223d350' },
  { id: 'purple-heart', name: 'Purple Heart', group: 'events', hash: 'cb40a92e32b57fd732a00fc325e7afb00a7ca74936ad50d8e860152e482cfbde' },
  { id: '15th-anniversary', name: '15th Anniversary', group: 'events', hash: 'cd9d82ab17fd92022dbd4a86cde4c382a7540e117fae7b9a2853658505a80625' },
  { id: 'mcc', name: 'MCC 15th Year', group: 'events', hash: '56c35628fe1c4d59dd52561a3d03bfa4e1a76d397c8b9c476c2f77cb6aebb1df' },
  { id: 'mojang-office', name: 'Mojang Office', group: 'events', hash: '5c29410057e32abec02d870ecb52ec25fb45ea81e785a7854ae8429d7236ca26' },
  { id: 'home', name: 'Home', group: 'events', hash: '1de21419009db483900da6298a1e6cbf9f1bc1523a0dcdc16263fab150693edd' },
  { id: 'menace', name: 'Menace', group: 'events', hash: 'dbc21e222528e30dc88445314f7be6ff12d3aeebc3c192054fba7e3b3f8c77b1' },
  { id: 'yearn', name: 'Yearn', group: 'events', hash: '308b32a9e303155a0b4262f9e5483ad4a22e3412e84fe8385a0bdd73dc41fa89' },
  { id: 'copper', name: 'Copper', group: 'events', hash: '5e6f3193e74cd16cdd6637d9bae5484e3a37ff2a14c2d157c659a07810b1bdca' },
  { id: 'zombie-horse', name: 'Zombie Horse', group: 'events', hash: 'a3f6e4f14801f3ea55e3d95b9b4ef3b5e8802d947f669de93d6ec4b9354a436b' },
  { id: 'builder', name: 'Builder', group: 'events', hash: '2c579968c64c1719740fd8c2a451461879b238002574fce48f7d1a7c36a1c7d4' },
  { id: 'experience', name: 'Minecraft Experience', group: 'events', hash: '7658c5025c77cfac7574aab3af94a46a8886e3b7722a895255fbf22ab8652434' },
  { id: 'moonlight-trail', name: 'Moonlight Trail', group: 'events', hash: 'fe8a02dfe9e390e44ff33d69feef9d3943f76d3901015bbd50f0b67722d288bd' },
  { id: 'crafter', name: 'Crafter', group: 'events', hash: '479eacefa3cdd7aca94207f36c0dd449653ddf259daf40544a5866baf05eee22' },

  { id: 'minecon-2011', name: 'MINECON 2011', group: 'minecon', hash: '953cac8b779fe41383e675ee2b86071a71658f2180f56fbce8aa315ea70e2ed6' },
  { id: 'minecon-2012', name: 'MINECON 2012', group: 'minecon', hash: 'a2e8d97ec79100e90a75d369d1b3ba81273c4f82bc1b737e934eed4a854be1b6' },
  { id: 'minecon-2013', name: 'MINECON 2013', group: 'minecon', hash: '153b1a0dfcbae953cdeb6f2c2bf6bf79943239b1372780da44bcbb29273131da' },
  { id: 'minecon-2015', name: 'MINECON 2015', group: 'minecon', hash: 'b0cc08840700447322d953a02b965f1d65a13a603bf64b17c803c21446fe1635' },
  { id: 'minecon-2016', name: 'MINECON 2016', group: 'minecon', hash: 'e7dfea16dc83c97df01a12fabbd1216359c0cd0ea42f9999b6e97c584963e980' },

  { id: 'mojang-classic', name: 'Mojang (Classic)', group: 'staff', hash: '8f120319222a9f4a104e2f5cb97b2cda93199a2ee9e1585cb8d09d6f687cb761' },
  { id: 'mojang', name: 'Mojang', group: 'staff', hash: '5786fe99be377dfb6858859f926c4dbc995751e91cee373468c5fbf4865e7151' },
  { id: 'mojang-studios', name: 'Mojang Studios', group: 'staff', hash: '9e507afc56359978a3eb3e32367042b853cddd0995d17d0da995662913fb00f7' },

  { id: 'translator', name: 'Translator', group: 'community', hash: '1bf91499701404e21bd46b0191d63239a4ef76ebde88d27e4d430ac211df681e' },
  { id: 'translator-chinese', name: 'Translator (Chinese)', group: 'community', hash: '2262fb1d24912209490586ecae98aca8500df3eff91f2a07da37ee524e7e3cb6' },
  { id: 'mojira-moderator', name: 'Mojira Moderator', group: 'community', hash: 'ae677f7d98ac70a533713518416df4452fe5700365c09cf45d0d156ea9396551' },
  { id: 'realms-mapmaker', name: 'Realms Mapmaker', group: 'community', hash: '17912790ff164b93196f08ba71d0e62129304776d0f347334f8a6eae509f8a56' },
  { id: 'scrolls', name: 'Scrolls Champion', group: 'community', hash: '3efadf6510961830f9fcc077f19b4daf286d502b5f5aafbd807c7bbffcaca245' },
  { id: 'cobalt', name: 'Cobalt', group: 'community', hash: 'ca35c56efe71ed290385f4ab5346a1826b546a54d519e6a3ff01efa01acce81' },

  { id: 'millionth-customer', name: 'Millionth Customer', group: 'personal', hash: '70efffaf86fe5bc089608d3cb297d3e276b9eb7a8f9f2fe6659c23a2d8b18edf' },
  { id: 'db', name: 'dB', group: 'personal', hash: 'bcfbe84c6542a4a5c213c1cacf8979b5e913dcb4ad783a8b80e3c4a7d5c8bdac' },
  { id: 'snowman', name: 'Snowman', group: 'personal', hash: '23ec737f18bfe4b547c95935fc297dd767bb84ee55bfd855144d279ac9bfd9fe' },
  { id: 'spade', name: 'Spade', group: 'personal', hash: '2e002d5e1758e79ba51d08d92a0f3a95119f2f435ae7704916507b6c565a7da8' },
  { id: 'prismarine', name: 'Prismarine', group: 'personal', hash: 'd8f8d13a1adf9636a16c31d47f3ecc9bb8d8533108aa5ad2a01b13b1a0c55eac' },
  { id: 'turtle', name: 'Turtle', group: 'personal', hash: '5048ea61566353397247d2b7d946034de926b997d5e66c86483dfb1e031aee95' },
  { id: 'birthday', name: 'Birthday', group: 'personal', hash: '2056f2eebd759cce93460907186ef44e9192954ae12b227d817eb4b55627a7fc' },
  { id: 'valentine', name: 'Valentine', group: 'personal', hash: 'e578ef995fabcf0a94768f9651ac3aaba30c59ef85d2438e9b3e0cc1d810652b' },
  { id: 'bacon', name: 'Bacon', group: 'personal', hash: 'fd14214cd8073059e93d9c626260f5df85e5a959181537119df56cadaf5002cc' },
  { id: 'cheapsh0t', name: 'cheapsh0t’s', group: 'personal', hash: 'ca29f5dd9e94fb1748203b92e36b66fda80750c87ebc18d6eafdb0e28cc1d05f' },
  { id: 'oxeye', name: 'Oxeye', group: 'personal', hash: '7706b5f5fc90329691e59277dcc66ba20572219fa8e5da472afd5235fad12cc8' },
  { id: 'blueprint', name: 'Blueprint', group: 'personal', hash: 'fdcf48f01ec480d1d7cbec27f7ddce48c9da2be6724641109444dae58d4cd013' },
];

const officialById = new Map(OFFICIAL_CAPES.map(c => [c.id, c]));
export const officialCapeById = id => officialById.get(id) || null;
export const capeTextureURL = hash => TEXTURE_HOST + hash;

/* ---- The Fish ---------------------------------------------------------------
   Not a real cape. It stays anyway. Drawn in slots, so its tints are exact. */

/* The cape's faces on its own sheet, as the game unwraps a 10×16×1 box. */
export const CAPE_FACES = {
  top: [1, 0, 10, 1], bottom: [11, 0, 10, 1],
  right: [0, 1, 1, 16], inside: [12, 1, 10, 16],
  left: [11, 1, 1, 16], outside: [1, 1, 10, 16],
};

function capePainter() {
  const n = CAPE_W * CAPE_H;
  const slot = new Int8Array(n).fill(-1), shade = new Float32Array(n), alpha = new Uint8Array(n);
  const put = (x, y, v) => {
    if (v == null) return;
    const [s, sh = 0] = Array.isArray(v) ? v : [v];
    const i = y * CAPE_W + x;
    slot[i] = s; shade[i] = sh; alpha[i] = 255;
  };
  const face = (name, fn) => {
    const [fx, fy, w, h] = CAPE_FACES[name];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(fx + x, fy + y, fn(x, y, w, h));
  };
  const noise = (x, y) => (((Math.imul(x + 3, 2654435761) ^ Math.imul(y + 11, 40503)) >>> 0) % 997) / 997 - 0.5;
  return { face, noise, finish: slots => layerFromSlots({ w: CAPE_W, h: CAPE_H, slot, shade, alpha, slots }) };
}

/** Edges, top and underside in the trim slot, and the inside a shade darker. */
function frame(p, cloth, trim, insideShade = -0.8) {
  p.face('inside', (x, y) => [cloth(x, y), insideShade]);
  p.face('right', () => [trim, -0.2]);
  p.face('left', () => [trim, -0.2]);
  p.face('top', () => [trim, 0.4]);
  p.face('bottom', () => [trim, -0.4]);
}

const FISH = [
  '..###...',
  '.#####.#',
  '#e######',
  '.#####.#',
  '..###...',
];

export const PRESET_CAPES = [
  {
    id: 'fish', name: 'Fish', slots: [{ name: 'Cloth', color: '#1E3A52' }, { name: 'Fish', color: '#E0784A' }, { name: 'Eye', color: '#EEF2F4' }, { name: 'Trim', color: '#4FD8DE' }],
    paint(p) {
      p.face('outside', (x, y, w, h) => {
        if (x === 0 || x === w - 1 || y === h - 1) return [3, 0];
        const fx = x - 1, fy = y - 5;
        const c = FISH[fy]?.[fx];
        if (c === 'e') return [2, 0];
        if (c === '#') return [1, fy === 0 ? 0.5 : fy === 4 ? -0.4 : 0];
        return [0, p.noise(x, y) * 0.25];
      });
      frame(p, () => 0, 3);
    },
  },
];

const byId = new Map(PRESET_CAPES.map(c => [c.id, c]));
export const presetCapeById = id => byId.get(id) || null;

const layers = new Map();
export function presetCapeLayer(id) {
  if (!layers.has(id)) {
    const def = byId.get(id);
    if (!def) return null;
    const p = capePainter();
    def.paint(p);
    layers.set(id, p.finish(def.slots));
  }
  return layers.get(id);
}
