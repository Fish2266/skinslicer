/* ============================================================================
   Looking a player up by name.

   Mojang's own profile API does not send CORS headers, so a page cannot read
   it. Two public mirrors do: playerdb.co (first — it answered with the live
   skin in testing) and api.ashcon.app (the fallback). Either hands back the
   texture URLs; the textures themselves come straight from Mojang's
   textures.minecraft.net, which does allow it.

   The name typed is the only thing that leaves the browser.
   ========================================================================= */

import { AppError } from '../core/util.js';

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const UUID_RE = /^[0-9a-f]{32}$/i;

export function validName(s) {
  const t = String(s || '').trim().replace(/-/g, '');
  return NAME_RE.test(t) || UUID_RE.test(t);
}

async function getJSON(url, timeout = 9000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } finally { clearTimeout(timer); }
}

const https = u => (u ? String(u).replace(/^http:/, 'https:') : null);

/** The textures property, decoded — it carries the arm model. */
function decodeProps(props) {
  try {
    const v = (props || []).find(p => p.name === 'textures')?.value;
    return v ? JSON.parse(atob(v)) : null;
  } catch { return null; }
}

async function viaPlayerDB(name) {
  const r = await getJSON(`https://playerdb.co/api/player/minecraft/${encodeURIComponent(name)}`);
  const pl = r.body?.data?.player;
  if (!r.ok || !r.body?.success || !pl) {
    if (r.status >= 400 && r.status < 500) return { missing: true };
    throw new Error('playerdb did not answer');
  }
  const tex = decodeProps(pl.properties)?.textures || {};
  return {
    name: pl.username,
    uuid: pl.raw_id || String(pl.id || '').replace(/-/g, ''),
    skin: https(tex.SKIN?.url || pl.skin_texture),
    cape: https(tex.CAPE?.url || pl.cape_texture),
    slim: tex.SKIN?.metadata?.model === 'slim',
  };
}

async function viaAshcon(name) {
  const r = await getJSON(`https://api.ashcon.app/mojang/v2/user/${encodeURIComponent(name)}`);
  if (r.status === 404 || r.status === 400) return { missing: true };
  if (!r.ok || !r.body?.textures) throw new Error('ashcon did not answer');
  const t = r.body.textures;
  return {
    name: r.body.username,
    uuid: String(r.body.uuid || '').replace(/-/g, ''),
    skin: https(t.skin?.url),
    cape: https(t.cape?.url),
    slim: !!t.slim,
  };
}

async function fetchTexture(url) {
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new AppError('Mojang would not hand over that texture.');
  return res.blob();
}

/**
 * @returns {Promise<{name, uuid, slim, skin: Blob|null, cape: Blob|null}>}
 */
export async function lookupPlayer(input) {
  const name = String(input || '').trim();
  if (!validName(name)) throw new AppError('Minecraft names are 1–16 letters, numbers and underscores.');

  let found = null, lastErr = null;
  for (const via of [viaPlayerDB, viaAshcon]) {
    try {
      const r = await via(name);
      if (r.missing) { found = found || r; continue; }
      found = r;
      break;
    } catch (e) { lastErr = e; }
  }
  if (!found) throw new AppError('Could not reach the player lookup. Check your connection and try again.', { cause: lastErr });
  if (found.missing) throw new AppError(`No Minecraft account is called “${name}”.`);

  const [skin, cape] = await Promise.all([fetchTexture(found.skin), fetchTexture(found.cape).catch(() => null)]);
  return { name: found.name || name, uuid: found.uuid, slim: found.slim, skin, cape };
}
