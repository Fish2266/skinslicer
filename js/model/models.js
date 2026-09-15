/* ============================================================================
   The player model, as the game builds it.

   Numbers are PlayerModel's own: the same boxes, pivots and CubeDeformation
   (half a pixel on the hat, a quarter everywhere else on the outer layer).
   Slim ("Alex") arms are three pixels wide and hang half a pixel lower.

   The viewer takes one texture per model, so the skin and the cape share an
   atlas: the 64×64 skin on top and the 64×32 cape underneath it, which is why
   the sheet is 64×96 and the cape's box starts at v = 64.

   flattenModel() is Frame & Groove's, unchanged — render3d.js imports it.
   ========================================================================= */

export const ATLAS = [64, 96];
export const CAPE_V = 64;

/* Arms rest a few degrees off the body, as the game's idle bob leaves them,
   so the silhouette reads as a person rather than a fence post. */
const ARM_SWAY = 0.05;
/* The cape hangs away from the back rather than through it. */
const CAPE_TILT = -0.1;

const box = (uv, from, size, inflate = 0) => ({ uv, from, size, inflate });

export function playerModel(slim = false) {
  const aw = slim ? 3 : 4;
  const ay = slim ? 2.5 : 2;
  const rx = slim ? -2 : -3;
  const arm = (x, sway, inner, outer, from) => [
    { pose: [x, ay, 0], rotation: [0, 0, sway], cubes: [box(inner, from, [aw, 12, 4])] },
    { pose: [x, ay, 0], rotation: [0, 0, sway], cubes: [box(outer, from, [aw, 12, 4], 0.25)] },
  ];
  const [rightArm, rightSleeve] = arm(-5, ARM_SWAY, [40, 16], [40, 32], [rx, -2, -2]);
  const [leftArm, leftSleeve] = arm(5, -ARM_SWAY, [32, 48], [48, 48], [-1, -2, -2]);
  return {
    texture: ATLAS.slice(),
    parts: {
      head:         { pose: [0, 0, 0], cubes: [box([0, 0], [-4, -8, -4], [8, 8, 8])] },
      body:         { pose: [0, 0, 0], cubes: [box([16, 16], [-4, 0, -2], [8, 12, 4])] },
      right_arm:    rightArm,
      left_arm:     leftArm,
      right_leg:    { pose: [-1.9, 12, 0], cubes: [box([0, 16], [-2, 0, -2], [4, 12, 4])] },
      left_leg:     { pose: [1.9, 12, 0],  cubes: [box([16, 48], [-2, 0, -2], [4, 12, 4])] },
      hat:          { pose: [0, 0, 0], cubes: [box([32, 0], [-4, -8, -4], [8, 8, 8], 0.5)] },
      jacket:       { pose: [0, 0, 0], cubes: [box([16, 32], [-4, 0, -2], [8, 12, 4], 0.25)] },
      right_sleeve: rightSleeve,
      left_sleeve:  leftSleeve,
      right_pants:  { pose: [-1.9, 12, 0], cubes: [box([0, 32], [-2, 0, -2], [4, 12, 4], 0.25)] },
      left_pants:   { pose: [1.9, 12, 0],  cubes: [box([0, 48], [-2, 0, -2], [4, 12, 4], 0.25)] },
      // Rotated half a turn so its outside — the patch at (1, 1) — faces the
      // world behind the player, exactly as the cape layer draws it.
      cape: { pose: [0, 0, 2], rotation: [CAPE_TILT, Math.PI, 0], cubes: [box([0, CAPE_V], [-5, 0, -1], [10, 16, 1])] },
    },
  };
}

/** Viewer part names, grouped the way the paint tools think about them. */
export const INNER_PARTS = ['head', 'body', 'right_arm', 'left_arm', 'right_leg', 'left_leg'];
export const OUTER_PARTS = ['hat', 'jacket', 'right_sleeve', 'left_sleeve', 'right_pants', 'left_pants'];

/* ---- Frame & Groove's flattener, unchanged ------------------------------ */
export function flattenModel(model) {
  const out = [];
  const parts = model.parts;
  const resolve = (name, seen = new Set()) => {
    const p = parts[name];
    if (!p || seen.has(name)) return { offset: [0, 0, 0], rotation: [0, 0, 0] };
    seen.add(name);
    const base = p.parent ? resolve(p.parent, seen) : { offset: [0, 0, 0], rotation: [0, 0, 0] };
    const pose = p.pose || [0, 0, 0];
    const rot = p.rotation || [0, 0, 0];
    return {
      offset: [base.offset[0] + pose[0], base.offset[1] + pose[1], base.offset[2] + pose[2]],
      rotation: [base.rotation[0] + rot[0], base.rotation[1] + rot[1], base.rotation[2] + rot[2]],
      pivot: base.offset,
    };
  };
  for (const [name, part] of Object.entries(parts)) {
    const t = resolve(name);
    for (const cube of part.cubes || []) {
      out.push({
        part: name,
        cube,
        offset: t.offset,
        rotation: t.rotation,
        pivot: t.pivot || [0, 0, 0],
        inflate: (cube.inflate || 0) + (model.inflate || 0),
      });
    }
  }
  return out;
}
