/* ============================================================================
   Tint controls — one row per colour group, and the swatch popover.

   A row is the group's colour as worn, its name, a pipette, and a way back
   to how it was drawn. The popover offers the colours that make sense first
   — the cape's, the skin's, the rest of the outfit's, Minecraft's sixteen
   dyes — then any colour at all, or one picked off the model or the screen.
   ========================================================================= */

import { h, raw, on } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { openColorPopover, closeMenu, toast } from './kit.js';
import { visibleGroups, groupHex } from '../skin/tint.js';
import { DYES } from '../skin/color.js';

const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/** A few dots of an item's colours, as worn — for tiles and list rows. */
export function swatchDots(layer, tints = {}, max = 4) {
  if (!layer) return h('span.dots');
  const groups = visibleGroups(layer).sort((a, b) => b.count - a.count).slice(0, max);
  return h('span.dots', ...groups.map(g => h('i', { style: { background: groupHex(layer, g.gi, tints) } })));
}

/* The browser's own screen eyedropper, where there is one (Chromium). */
const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
async function screenPick() {
  try {
    const r = await new window.EyeDropper().open();
    const v = r.sRGBHex;
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
    const m = v.match(/(\d+)[, ]+(\d+)[, ]+(\d+)/);
    return m ? `#${[m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('')}` : null;
  } catch { return null; }   // Escape, or the page lost focus
}

/**
 * @param {object} o
 *   layer     the tintable layer
 *   tints     the worn thing's tints object — edited in place
 *   onChange  (gi, hex|null) after every change
 *   palettes  () => [{ label, colors: [hex] }], offered above the dyes
 *   pick      (done: hex => void) — pick a colour off the model; optional
 */
export function tintEditor({ layer, tints, onChange, palettes, pick }) {
  const el = h('.tint-list');

  function set(g, hex, row) {
    if (hex && same(hex, g.hex)) hex = null;
    if (hex) tints[g.gi] = hex; else delete tints[g.gi];
    row?._sync();
    onChange?.(g.gi, hex);
  }

  function rowFor(g) {
    const sw = h('button.tint-swatch', {
      'aria-label': `Change ${g.name}`, 'data-tip': 'Change this colour', 'data-tip-pos': 'left',
      onclick: () => openTintPopover(sw, groupHex(layer, g.gi, tints), palettes?.() || [], hex => set(g, hex, row), { pick }),
    });
    const sub = h('.tr-sub');
    const pipette = pick ? h('button.btn.btn-sm.btn-ghost.btn-icon', {
      'aria-label': `Pick ${g.name} off the model`, 'data-tip': 'Pick a colour off the model', 'data-tip-pos': 'left',
      onclick: () => pick(hex => set(g, hex, row)),
    }, raw(icon('pipette', 13))) : null;
    const reset = h('button.btn.btn-sm.btn-ghost.btn-icon', {
      'aria-label': 'As drawn', 'data-tip': 'Back to how it was drawn', 'data-tip-pos': 'left',
      onclick: () => set(g, null, row),
    }, raw(icon('undo', 13)));
    const orig = h('span.tr-orig', { style: { background: g.hex }, 'data-tip': `Drawn ${g.hex.toUpperCase()}`, 'data-tip-pos': 'left' });
    const row = h('.tint-row', { dataset: { pipette: String(!!pick) } }, sw, h('.tr-main', h('.tr-name.truncate', { text: g.name }), sub), orig, pipette, reset);
    row._sync = () => {
      const tinted = !!tints[g.gi];
      row.dataset.tinted = String(tinted);
      sw.style.setProperty('--c', groupHex(layer, g.gi, tints));
      sub.textContent = tinted ? `${tints[g.gi].toUpperCase()} · was ${g.hex.toUpperCase()}` : `${g.count.toLocaleString()} px · as drawn`;
      reset.hidden = !tinted;
    };
    row._sync();
    return row;
  }

  const groups = layer ? visibleGroups(layer) : [];
  el.append(...groups.map(rowFor));
  if (!groups.length) el.appendChild(h('.caption.muted', { text: 'Nothing here to tint.' }));
  el.sync = () => el.querySelectorAll('.tint-row').forEach(r => r._sync());
  return el;
}

/* ---- The popover --------------------------------------------------------- */
let pop = null, offs = [];

export function closeTintPopover() {
  pop?.remove(); pop = null;
  offs.forEach(f => f()); offs = [];
}

/**
 * @param {Element} anchor
 * @param {string} value     the colour now
 * @param {object[]} palettes
 * @param {(hex) => void} onPick
 * @param {object} [o] { pick } — pick off the model, as in tintEditor
 */
export function openTintPopover(anchor, value, palettes, onPick, { pick } = {}) {
  closeTintPopover();
  closeMenu();
  const all = [
    ...palettes.filter(p => p.colors?.length),
    { label: 'Dyes', colors: DYES.map(d => d[1]), names: DYES.map(d => d[0]) },
  ];
  const tool = (iconName, label, tip, run) => h('button.btn.btn-sm', { 'data-tip': tip, 'data-tip-pos': 'bottom', onclick: run }, raw(icon(iconName, 13)), h('span', { text: label }));
  pop = h('.menu.tint-pop', { role: 'dialog', 'aria-label': 'Pick a colour' },
    ...all.map(p => h('.tp-group',
      h('.menu-label', { text: p.label }),
      h('.tp-grid', ...[...new Set(p.colors.map(c => c.toLowerCase()))].slice(0, 16).map((c, i) => h('button.swatch', {
        style: { background: c },
        'aria-pressed': String(same(c, value)),
        'aria-label': p.names?.[i] || c.toUpperCase(),
        'data-tip': p.names?.[i] || c.toUpperCase(), 'data-tip-pos': 'top',
        onclick: () => { onPick(c); closeTintPopover(); },
      }))),
    )),
    h('.menu-sep'),
    h('.tp-tools',
      pick ? tool('pipette', 'Model', 'Click a pixel on the model to take its colour', () => { closeTintPopover(); pick(onPick); }) : null,
      hasEyeDropper ? tool('target', 'Screen', 'Take a colour from anywhere on the screen', async () => {
        closeTintPopover();
        const hex = await screenPick();
        if (hex) onPick(hex);
      }) : null,
      tool('palette', 'Any…', 'Any colour at all', () => {
        closeTintPopover();
        // Every drag of the picker is a change; the last one is what stays.
        // Its first report is only the colour it opened with, after a trip
        // through HSV that can land a shade off — so it is not a change.
        let first = true;
        openColorPopover(anchor, value, hex => { if (first) { first = false; return; } onPick(hex.slice(0, 7)); });
      }),
    ),
  );
  document.body.appendChild(pop);
  place(pop, anchor);
  setTimeout(() => {
    offs.push(on(window, 'pointerdown', e => { if (pop && !pop.contains(e.target)) closeTintPopover(); }, true));
    offs.push(on(window, 'keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeTintPopover(); } }, true));
  }, 0);
}

function place(el, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, ht = el.offsetHeight;
  let x = r.right - w, y = r.bottom + 6;
  if (x < 8) x = Math.min(innerWidth - w - 8, r.left);
  if (y + ht > innerHeight - 8) y = Math.max(8, r.top - ht - 6);
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${y}px`;
}

/** Say so when a picked pixel had nothing in it. */
export const nothingThere = () => toast({ title: 'Nothing there', message: 'That pixel is see-through. Click somewhere on the model with colour.', kind: 'info', duration: 2200 });
