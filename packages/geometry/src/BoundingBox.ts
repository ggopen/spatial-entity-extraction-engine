import type { BoundingBox, Triangle, Vertex } from "@seee/core";

/** Compute an axis-aligned bounding box from triangles (envelope of vertices). */
export function bboxFromTriangles(triangles: Triangle[]): BoundingBox {
  if (triangles.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of triangles) {
    if (t.bbox) {
      if (t.bbox.min[0] < minX) minX = t.bbox.min[0];
      if (t.bbox.min[1] < minY) minY = t.bbox.min[1];
      if (t.bbox.min[2] < minZ) minZ = t.bbox.min[2];
      if (t.bbox.max[0] > maxX) maxX = t.bbox.max[0];
      if (t.bbox.max[1] > maxY) maxY = t.bbox.max[1];
      if (t.bbox.max[2] > maxZ) maxZ = t.bbox.max[2];
    } else {
      // Fallback for triangles without a precomputed bbox.
      const [x, y, z] = t.centroid;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Compute an AABB from a list of vertices. */
export function bboxFromVertices(vertices: Vertex[]): BoundingBox {
  if (vertices.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Merge two AABBs. */
export function mergeBBox(a: BoundingBox, b: BoundingBox): BoundingBox {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** Diagonal length (longest dimension) of an AABB. */
export function bboxDiagonal(bbox: BoundingBox): number {
  const dx = bbox.max[0] - bbox.min[0];
  const dy = bbox.max[1] - bbox.min[1];
  const dz = bbox.max[2] - bbox.min[2];
  return Math.hypot(dx, dy, dz);
}

/** Test whether two AABBs overlap (closed intervals). */
export function bboxIntersects(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] && a.max[2] >= b.min[2]
  );
}
