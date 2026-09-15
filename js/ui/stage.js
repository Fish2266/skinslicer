/* ============================================================================
   The stage — the player model in 3D, on Frame & Groove's WebGL viewer.

   The viewer does the two things that matter for skins: nearest filtering, so
   a pixel is a pixel, and a picking pass that turns a click into the exact
   texel under it, which is what lets the Paint view paint on the model
   itself. This module is the interaction around it: orbit, zoom, the named
   views, the turntable, and handing paint strokes to whoever asked.

   Drag to turn it; wheel to zoom; double-click to put it back. While painting,
   the left button paints and the right button (or Alt, or Space) turns.
   ========================================================================= */

import { h, raw, on, observeResize } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { createViewer } from '../model/render3d.js';
import { playerModel } from '../model/models.js';

export const VIEWS = {
  front: { yaw: Math.PI, pitch: -0.1, label: 'Front' },
  right: { yaw: -Math.PI / 2, pitch: -0.1, label: 'Their right side' },
  back:  { yaw: 0, pitch: -0.1, label: 'Back' },
  left:  { yaw: Math.PI / 2, pitch: -0.1, label: 'Their left side' },
};

const ORBIT = 0.0105;
/* The viewer's home framing fits the whole bounding sphere edge to edge; a
   person reads better with a little air round them. */
const HOME_ZOOM = 1.14;

export function createStage({ paint = false, onStroke, onHover } = {}) {
  const canvas = h('canvas.stage-gl');
  const stage = h('.stage.wd-stage', { dataset: { mode: paint ? 'paint' : 'view' } }, canvas);
  const hud = h('.stage-hud.wd-hud');
  const host = h('.stage-host', stage, hud);

  let viewer = null;
  try { viewer = createViewer(canvas, { model: playerModel(false) }); } catch (e) { console.warn('3D unavailable', e); }
  viewer?.setView({ zoom: HOME_ZOOM });
  if (!viewer) {
    stage.appendChild(h('.stage-fallback',
      raw(icon('cube', 28)),
      h('.strong', { text: 'This browser will not draw 3D' }),
      h('.caption', { text: 'WebGL is switched off or unavailable. Everything else works, and the Export page shows the flat skin.' }),
    ));
  }

  let slim = null;
  let paintMode = paint;
  let spin = false, spinRaf = 0, spinLast = 0;
  let queued = false;

  const draw = () => {
    if (!viewer || queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (stage.offsetParent) viewer.draw(); });
  };
  observeResize(stage, () => viewer?.draw());

  /* ---- Pointer ------------------------------------------------------------ */
  let drag = null;
  let spaceHeld = false;
  on(window, 'keydown', e => { if (e.code === 'Space' && paintMode && !e.repeat && stage.matches(':hover')) { spaceHeld = true; stage.dataset.orbitKey = 'true'; } });
  on(window, 'keyup', e => { if (e.code === 'Space') { spaceHeld = false; delete stage.dataset.orbitKey; } });

  /* ---- Picking one texel ---------------------------------------------------
     For the colour pipette: the next left click on the model hands its texel
     to whoever asked, instead of turning the model. Escape gives up. */
  let pick = null;
  function endPick(t) {
    const p = pick;
    if (!p) return;
    pick = null;
    delete stage.dataset.picking;
    offPickKey?.();
    if (viewer?.hoverTexel(null)) draw();
    p.done(t);
  }
  let offPickKey = null;

  stage.addEventListener('pointerdown', e => {
    if (!viewer) return;
    if (pick && e.button === 0) {
      e.preventDefault();
      endPick(viewer.pickTexel(e.clientX, e.clientY));
      return;
    }
    const orbiting = !paintMode || e.button === 2 || e.button === 1 || e.altKey || spaceHeld;
    if (!orbiting && e.button !== 0) return;
    try { stage.setPointerCapture?.(e.pointerId); } catch { /* a pointer already gone */ }
    if (orbiting) {
      drag = { kind: 'orbit', x: e.clientX, y: e.clientY };
      stage.dataset.orbiting = 'true';
    } else {
      drag = { kind: 'paint', last: { x: e.clientX, y: e.clientY } };
      onStroke?.('start', viewer.pickTexel(e.clientX, e.clientY), e);
    }
    e.preventDefault();
  });
  stage.addEventListener('pointermove', e => {
    if (!viewer) return;
    if (drag?.kind === 'orbit') {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      viewer.orbit(-dx * ORBIT, dy * ORBIT);
      draw();
      return;
    }
    if (pick) {
      const t = viewer.pickTexel(e.clientX, e.clientY);
      if (viewer.hoverTexel(t)) draw();
      pick.hover?.(t);
      return;
    }
    if (!paintMode) return;
    const t = viewer.pickTexel(e.clientX, e.clientY);
    if (drag?.kind === 'paint') {
      /* Pointer events arrive further apart than texels on a quick stroke,
         and a stroke can cross from one face to the next, where joining two
         texels on the sheet would draw across the wrong pixels. So the gap
         is filled on screen instead: pick every few pixels along the path. */
      const last = drag.last || { x: e.clientX, y: e.clientY };
      const dist = Math.hypot(e.clientX - last.x, e.clientY - last.y);
      const steps = Math.min(48, Math.floor(dist / 3));
      for (let i = 1; i < steps; i++) {
        const f = i / steps;
        onStroke?.('move', viewer.pickTexel(last.x + (e.clientX - last.x) * f, last.y + (e.clientY - last.y) * f), e);
      }
      onStroke?.('move', t, e);
      drag.last = { x: e.clientX, y: e.clientY };
    }
    if (viewer.hoverTexel(t)) draw();
    onHover?.(t);
  });
  const end = e => {
    if (!drag) return;
    if (drag.kind === 'paint') onStroke?.('end', null, e);
    drag = null;
    delete stage.dataset.orbiting;
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('pointerleave', () => {
    if (drag || !viewer) return;
    if (viewer.hoverTexel(null)) draw();
    onHover?.(null);
  });
  stage.addEventListener('contextmenu', e => e.preventDefault());
  stage.addEventListener('wheel', e => {
    if (!viewer) return;
    e.preventDefault();
    viewer.zoom(Math.exp(e.deltaY * 0.0012));
    draw();
  }, { passive: false });
  stage.addEventListener('dblclick', () => { if (!paintMode) api.resetView(); });

  /* ---- Turntable ---------------------------------------------------------- */
  function tick(t) {
    spinRaf = 0;
    if (!spin || !viewer) return;
    const dt = spinLast ? Math.min(64, t - spinLast) : 16;
    spinLast = t;
    if (!drag && !pick && !document.hidden && stage.offsetParent) { viewer.orbit(dt * 0.00032, 0); viewer.draw(); }
    spinRaf = requestAnimationFrame(tick);
  }

  /* ---- HUD --------------------------------------------------------------- */
  const hudBtn = (name, tip, run) => h('button', { 'data-tip': tip, 'data-tip-pos': 'top', 'aria-label': tip, onclick: run }, raw(icon(name, 14)));
  hud.append(
    hudBtn('refresh', 'Reset the view  (double-click)', () => api.resetView()),
    h('.hud-sep'),
    ...Object.entries(VIEWS).map(([id, v]) => h('button.hud-view', {
      'data-tip': v.label, 'data-tip-pos': 'top', 'aria-label': v.label,
      onclick: () => api.setView(id),
    }, h('span', { text: { front: 'F', right: 'R', back: 'B', left: 'L' }[id] }))),
    h('.hud-sep'),
    hudBtn('zoomIn', 'Closer', () => { viewer?.zoom(1 / 1.18); draw(); }),
    hudBtn('zoomOut', 'Further', () => { viewer?.zoom(1.18); draw(); }),
  );

  const api = {
    el: host,
    stage,
    hud,
    viewer,
    draw,
    setModel(isSlim) {
      if (!viewer || slim === !!isSlim) return;
      slim = !!isSlim;
      viewer.setModel(playerModel(slim));
      draw();
    },
    setTexture(img) { if (!viewer) return; viewer.setTexture(img); draw(); },
    setHidden(names) { if (!viewer) return; viewer.setHidden(names); draw(); },
    setPaintMode(onOff) { paintMode = !!onOff; stage.dataset.mode = paintMode ? 'paint' : 'view'; if (!paintMode && viewer?.hoverTexel(null)) draw(); },
    resetView() { if (!viewer) return; viewer.reset(); viewer.setView({ zoom: HOME_ZOOM }); draw(); },
    setView(id) {
      const v = VIEWS[id];
      if (!viewer || !v) return;
      viewer.setView({ yaw: v.yaw, pitch: v.pitch });
      draw();
    },
    setTurntable(onOff) {
      spin = !!onOff && !!viewer;
      spinLast = 0;
      if (spin && !spinRaf) spinRaf = requestAnimationFrame(tick);
    },
    get turntable() { return spin; },
    hoverTexel(t) { if (viewer?.hoverTexel(t)) draw(); },
    /**
     * The next left click on the model picks a texel instead of turning it.
     * @param {(t: {x,y}|null) => void} done  null if it was called off
     * @param {(t) => void} [hover]
     */
    pickOnce(done, hover) {
      if (!viewer) { done(null); return; }
      endPick(null);
      pick = { done, hover };
      stage.dataset.picking = 'true';
      offPickKey = on(window, 'keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); endPick(null); } }, true);
    },
    cancelPick() { endPick(null); },
    get picking() { return !!pick; },
    /** Let the WebGL context go — for stages that live in a dialog. */
    dispose() { endPick(null); spin = false; viewer?.dispose?.(); },
  };
  return api;
}
