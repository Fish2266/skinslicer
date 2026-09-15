/* ============================================================================
   Box UV unwrapping — vanilla's ModelPart.Cube, face for face.

   Every box is unwrapped from its texOffs (u, v) as a cross:

              u   u+d      u+d+w    u+2d+w   u+2d+2w
          v   +----+--------+--------+
              |    |  top   | bottom |
        v+d   +----+--------+--------+--------+
              |rght| front  |  left  |  back  |
      v+d+h   +----+--------+--------+--------+

   "Right" and "left" are the entity's own: the right side is -X, which is
   where the player's right arm hangs. The vertex order and the texture corner
   each vertex takes are copied from the game's Cube constructor, not derived,
   because a skin is the one texture where a mirrored face is instantly
   visible — writing on a shirt reads backwards.

   render3d.js is a straight copy from Frame & Groove and reads this module's
   cubeQuads(); this file is Skin Slicer's own.
   ========================================================================= */

/** Face order is fixed; the renderer relies on it only for lighting. */
export const FACES = ['top', 'bottom', 'right', 'front', 'left', 'back'];

/** Minecraft's own directional shading, so the preview reads like the game. */
export const FACE_LIGHT = { top: 1.0, bottom: 0.5, front: 0.8, back: 0.8, right: 0.6, left: 0.6 };

/** The texture rectangle for each face of one cube, in pixels. */
export function boxUV(cube) {
  const [u, v] = cube.uv;
  const [w, h, d] = cube.size.map(n => Math.round(Math.abs(n)));
  const rect = (x, y, rw, rh) => ({ x, y, w: rw, h: rh });
  return {
    top:    rect(u + d, v, w, d),
    bottom: rect(u + d + w, v, w, d),
    right:  rect(u, v + d, d, h),
    front:  rect(u + d, v + d, w, h),
    left:   rect(u + d + w, v + d, d, h),
    back:   rect(u + d + w + d, v + d, w, h),
  };
}

/**
 * Expand one cube into six textured quads in model space (Y down, -Z front).
 * `inflate` grows the box evenly, as CubeDeformation does; it never moves
 * the UVs, which is why the outer layer is the same pixels made bigger.
 */
export function cubeQuads(cube, inflate = 0) {
  const [fx, fy, fz] = cube.from;
  const [sx, sy, sz] = cube.size;
  const x0 = fx - inflate, y0 = fy - inflate, z0 = fz - inflate;
  const x1 = fx + sx + inflate, y1 = fy + sy + inflate, z1 = fz + sz + inflate;

  // The game's eight corners, named as it names them.
  const v7 = [x0, y0, z0], v = [x1, y0, z0], v1 = [x1, y1, z0], v2 = [x0, y1, z0];
  const v3 = [x0, y0, z1], v4 = [x1, y0, z1], v5 = [x1, y1, z1], v6 = [x0, y1, z1];

  const uv = boxUV(cube);
  // Polygon(verts, u1, v1, u2, v2) gives its four vertices (u2,v1) (u1,v1)
  // (u1,v2) (u2,v2). Every face but the bottom one runs top edge first.
  const topFirst = r => [[r.x + r.w, r.y], [r.x, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
  const bottomFirst = r => [[r.x + r.w, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y], [r.x + r.w, r.y]];

  const faces = {
    top:    { pos: [v4, v3, v7, v],  uvs: topFirst(uv.top) },
    bottom: { pos: [v1, v2, v6, v5], uvs: bottomFirst(uv.bottom) },
    right:  { pos: [v7, v3, v6, v2], uvs: topFirst(uv.right) },
    front:  { pos: [v, v7, v2, v1],  uvs: topFirst(uv.front) },
    left:   { pos: [v4, v, v1, v5],  uvs: topFirst(uv.left) },
    back:   { pos: [v3, v4, v5, v6], uvs: topFirst(uv.back) },
  };

  const out = [];
  for (const face of FACES) {
    const r = uv[face];
    // A flat box still has its two real faces; the rest are slivers.
    if (r.w <= 0 || r.h <= 0) continue;
    out.push({ face, pos: faces[face].pos, uvs: faces[face].uvs, light: FACE_LIGHT[face] });
  }
  return out;
}
