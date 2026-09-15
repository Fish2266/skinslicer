/* ============================================================================
   Audio — only the context.

   ui/sfx.js is shared byte-for-byte with Frame & Groove and All The Sounds,
   and it asks this module for the AudioContext its clicks play through. The
   wardrobe records and encodes nothing, so that is all this stand-in has.
   ========================================================================= */

let ctx = null;

export function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
  }
  return ctx;
}
