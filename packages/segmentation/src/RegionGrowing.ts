import type { Region, Triangle } from "@seee/core";
import { angleBetween } from "@seee/core";
import type { TriangleGraph } from "@seee/graph";

/** Tunable parameters for region growing. */
export interface RegionGrowingOptions {
  /** Max dihedral angle (degrees) between a seed's normal and a candidate. */
  maxAngle: number;
  /** Max centroid distance for a candidate triangle. */
  maxDistance: number;
  /** Max normal-curvature proxy (deviation of a triangle's normal from the
   * local plane fit). Set to Infinity to disable. */
  maxCurvature: number;
  /** Min # triangles for a region to be kept (smaller ones get re-absorbed). */
  minRegionSize: number;
}

export const DEFAULT_REGION_GROWING_OPTIONS: RegionGrowingOptions = {
  maxAngle: 15,
  maxDistance: 0.5,
  maxCurvature: 0.35,
  minRegionSize: 3,
};

/**
 * Region-growing segmentation on a triangle graph.
 *
 * Algorithm:
 *   1. Sort triangles by ascending "curvature" proxy = (1 - |n · n_neighbour_avg|).
 *   2. Pick the lowest-curvature unassigned triangle as a seed.
 *   3. BFS-expand: enqueue neighbours; add a neighbour iff its normal is within
 *      `maxAngle` of the seed normal AND its centroid is within `maxDistance`
 *      of the seed centroid.
 *   4. Repeat with the next unassigned seed until every triangle is assigned.
 *
 * The result is a list of {@link Region} objects whose `boundary` lists the
 * triangles that touch a triangle of another region.
 */
export class RegionGrowing {
  constructor(private readonly options: RegionGrowingOptions = DEFAULT_REGION_GROWING_OPTIONS) {}

  execute(graph: TriangleGraph): Region[] {
    const triangles = graph.triangles;
    if (triangles.length === 0) return [];

    // Curvature proxy: average normal deviation against neighbours.
    const curvature = computeCurvature(graph);
    // Seed order: low curvature first (smooth areas).
    const seedOrder = triangles
      .map((t) => t.id)
      .sort((a, b) => curvature[a] - curvature[b]);

    const regionOf = triangles.map(() => -1);
    const regions: Region[] = [];
    let nextRegionId = 0;

    for (const seedId of seedOrder) {
      if (regionOf[seedId] !== -1) continue;
      const seed = triangles[seedId];
      const regionTriangles: number[] = [seedId];
      regionOf[seedId] = -2; // temporary marker "in progress"

      // BFS expansion.
      const queue: number[] = [seedId];
      const inQueue = new Set<number>([seedId]);
      while (queue.length > 0) {
        const curId = queue.shift()!;
        const cur = triangles[curId];
        for (const nbId of cur.neighbors) {
          if (regionOf[nbId] !== -1) continue;
          if (inQueue.has(nbId)) continue;
          const nb = triangles[nbId];
          const angle = angleBetween(seed.normal, nb.normal);
          const dist = Math.hypot(
            seed.centroid[0] - nb.centroid[0],
            seed.centroid[1] - nb.centroid[1],
            seed.centroid[2] - nb.centroid[2],
          );
          const curv = curvature[nbId];
          if (
            angle <= this.options.maxAngle &&
            dist <= this.options.maxDistance &&
            curv <= this.options.maxCurvature
          ) {
            regionOf[nbId] = -2;
            regionTriangles.push(nbId);
            queue.push(nbId);
            inQueue.add(nbId);
          }
        }
      }

      // Commit region.
      const regionId = nextRegionId++;
      for (const tid of regionTriangles) {
        regionOf[tid] = regionId;
        triangles[tid].regionId = regionId;
      }
      regions.push(buildRegion(regionId, regionTriangles, triangles));
    }

    // Re-absorb tiny regions into their largest-touching neighbour.
    return this.absorbSmallRegions(regions, regionOf, triangles, graph);
  }

  private absorbSmallRegions(
    regions: Region[],
    regionOf: number[],
    triangles: Triangle[],
    graph: TriangleGraph,
  ): Region[] {
    const small = regions.filter((r) => r.triangles.length < this.options.minRegionSize);
    if (small.length === 0) return regions;

    const byId = new Map(regions.map((r) => [r.id, r]));
    for (const s of small) {
      // Find neighbour regions by triangle adjacency.
      const counts = new Map<number, number>();
      for (const tid of s.triangles) {
        for (const nb of triangles[tid].neighbors) {
          const rid = regionOf[nb];
          if (rid !== s.id && rid >= 0) {
            counts.set(rid, (counts.get(rid) ?? 0) + 1);
          }
        }
      }
      if (counts.size === 0) continue;
      let best = -1;
      let bestCount = -1;
      for (const [rid, c] of counts) {
        if (c > bestCount) { bestCount = c; best = rid; }
      }
      if (best < 0) continue;
      const target = byId.get(best)!;
      for (const tid of s.triangles) {
        target.triangles.push(tid);
        regionOf[tid] = target.id;
        triangles[tid].regionId = target.id;
      }
      byId.delete(s.id);
    }
    // Re-sort ids sequentially and recompute boundary/normal/centroid.
    const kept = [...byId.values()];
    kept.sort((a, b) => a.id - b.id);
    const result: Region[] = [];
    for (let i = 0; i < kept.length; i++) {
      result.push(buildRegion(i, kept[i].triangles, triangles));
    }
    // Fix regionId on triangles.
    for (let i = 0; i < kept.length; i++) {
      for (const tid of result[i].triangles) {
        triangles[tid].regionId = i;
      }
    }
    return result;
  }
}

/** Compute a per-triangle curvature proxy = average angle to neighbours. */
export function computeCurvature(graph: TriangleGraph): Float32Array {
  const triangles = graph.triangles;
  const out = new Float32Array(triangles.length);
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    const neighbors = t.neighbors;
    if (neighbors.length === 0) {
      out[i] = 0;
      continue;
    }
    let sum = 0;
    for (const nb of neighbors) {
      sum += angleBetween(t.normal, triangles[nb].normal);
    }
    out[i] = sum / neighbors.length;
  }
  return out;
}

/** Build a {@link Region} from its triangle ids (computes normal/centroid/boundary). */
export function buildRegion(id: number, triangleIds: number[], triangles: Triangle[]): Region {
  if (triangleIds.length === 0) {
    return { id, triangles: [], boundary: [], normal: [0, 0, 0], centroid: [0, 0, 0], area: 0 };
  }
  let nx = 0, ny = 0, nz = 0;
  let cx = 0, cy = 0, cz = 0;
  let area = 0;
  const memberSet = new Set(triangleIds);
  const boundary = new Set<number>();
  for (const tid of triangleIds) {
    const t = triangles[tid];
    nx += t.normal[0]; ny += t.normal[1]; nz += t.normal[2];
    cx += t.centroid[0]; cy += t.centroid[1]; cz += t.centroid[2];
    area += t.area;
    for (const nb of t.neighbors) {
      if (!memberSet.has(nb)) boundary.add(tid);
    }
  }
  const n = triangleIds.length;
  const normal: [number, number, number] = [nx / n, ny / n, nz / n];
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  if (len > 1e-12) {
    normal[0] /= len; normal[1] /= len; normal[2] /= len;
  }
  return {
    id,
    triangles: triangleIds.slice(),
    boundary: [...boundary],
    normal,
    centroid: [cx / n, cy / n, cz / n],
    area,
  };
}
