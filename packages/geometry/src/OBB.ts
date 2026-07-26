import type { OBB, Triangle, BoundingBox } from "@seee/core";
import { pcaFromTriangles } from "./PCA.js";
import { bboxFromTriangles } from "./BoundingBox.js";

/**
 * Build an oriented bounding box from a set of triangles using PCA for the
 * local axes. Half extents are measured along the (orthonormal) PCA axes.
 *
 * The extent is computed by projecting each triangle's per-vertex bbox
 * corners (which enclose the 3 vertices) onto the PCA axes. This ensures
 * the OBB always encloses the actual geometry, even for a single flat
 * triangle where projecting only the centroid would yield zero volume.
 */
export function obbFromTriangles(triangles: Triangle[]): OBB {
  if (triangles.length === 0) {
    return {
      center: [0, 0, 0],
      axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      halfExtents: [0, 0, 0],
    };
  }
  const pca = pcaFromTriangles(triangles);
  const [a0, a1, a2] = pca.axes;

  let min0 = Infinity, min1 = Infinity, min2 = Infinity;
  let max0 = -Infinity, max1 = -Infinity, max2 = -Infinity;
  for (const t of triangles) {
    // Project all 8 corners of the triangle's per-vertex bbox onto the PCA
    // axes so the OBB encloses the true vertex extent (not just the centroid).
    const b = t.bbox ?? { min: t.centroid, max: t.centroid };
    for (let i = 0; i < 8; i++) {
      const x = (i & 1) ? b.max[0] : b.min[0];
      const y = (i & 2) ? b.max[1] : b.min[1];
      const z = (i & 4) ? b.max[2] : b.min[2];
      const dx = x - pca.center[0];
      const dy = y - pca.center[1];
      const dz = z - pca.center[2];
      const p0 = dx * a0[0] + dy * a0[1] + dz * a0[2];
      const p1 = dx * a1[0] + dy * a1[1] + dz * a1[2];
      const p2 = dx * a2[0] + dy * a2[1] + dz * a2[2];
      if (p0 < min0) min0 = p0; if (p0 > max0) max0 = p0;
      if (p1 < min1) min1 = p1; if (p1 > max1) max1 = p1;
      if (p2 < min2) min2 = p2; if (p2 > max2) max2 = p2;
    }
  }

  const halfExtents: [number, number, number] = [
    (max0 - min0) / 2,
    (max1 - min1) / 2,
    (max2 - min2) / 2,
  ];
  // Recenter using the PCA center plus the projection midpoint.
  const mid0 = (max0 + min0) / 2;
  const mid1 = (max1 + min1) / 2;
  const mid2 = (max2 + min2) / 2;
  const center: [number, number, number] = [
    pca.center[0] + a0[0] * mid0 + a1[0] * mid1 + a2[0] * mid2,
    pca.center[1] + a0[1] * mid0 + a1[1] * mid1 + a2[1] * mid2,
    pca.center[2] + a0[2] * mid0 + a1[2] * mid1 + a2[2] * mid2,
  ];
  return { center, axes: [a0, a1, a2], halfExtents };
}

/** Convert an OBB to its axis-aligned bounding box (envelope). */
export function obbToAABB(obb: OBB): BoundingBox {
  const [a0, a1, a2] = obb.axes;
  const [hx, hy, hz] = obb.halfExtents;
  const corners: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const sx = (i & 1) ? 1 : -1;
    const sy = (i & 2) ? 1 : -1;
    const sz = (i & 4) ? 1 : -1;
    corners.push([
      obb.center[0] + a0[0] * sx * hx + a1[0] * sy * hy + a2[0] * sz * hz,
      obb.center[1] + a0[1] * sx * hx + a1[1] * sy * hy + a2[1] * sz * hz,
      obb.center[2] + a0[2] * sx * hx + a1[2] * sy * hy + a2[2] * sz * hz,
    ]);
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of corners) {
    if (c[0] < minX) minX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[2] < minZ) minZ = c[2];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] > maxY) maxY = c[1];
    if (c[2] > maxZ) maxZ = c[2];
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Volume of an OBB. */
export function obbVolume(obb: OBB): number {
  return 8 * obb.halfExtents[0] * obb.halfExtents[1] * obb.halfExtents[2];
}
