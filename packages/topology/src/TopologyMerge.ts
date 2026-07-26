import type { Entity, Region, Triangle, BoundingBox } from "@seee/core";
import { angleBetween } from "@seee/core";
import { obbFromTriangles, bboxFromTriangles, mergeBBox } from "@seee/geometry";

/** Tunable merge rules. */
export interface TopologyMergeOptions {
  /** Min shared boundary triangle count to consider two regions "touching". */
  minTouchArea: number;
  /** Min boundary length proxy (sum of triangle count) for merging. */
  minBoundary: number;
  /** Whether to merge regions that support each other (one above another). */
  enableSupport: boolean;
  /** Max vertical gap (in scene units) for a "support" relation. */
  supportGap: number;
  /** Max angle (deg) between region normals for them to merge into one entity. */
  maxMergeAngle: number;
}

export const DEFAULT_TOPOLOGY_MERGE_OPTIONS: TopologyMergeOptions = {
  minTouchArea: 2,
  minBoundary: 1,
  enableSupport: true,
  supportGap: 1.0,
  maxMergeAngle: 25,
};

/**
 * Topology Merge Engine.
 *
 * Groups regions into entities by union-find on a relation graph where edges
 * encode "touch with sufficient area" or "support". Each connected component
 * becomes a candidate Entity; coplanar neighbours are absorbed greedily to
 * keep entity boundaries aligned with perception.
 */
export class TopologyMerge {
  constructor(private readonly options: TopologyMergeOptions = DEFAULT_TOPOLOGY_MERGE_OPTIONS) {}

  execute(regions: Region[], triangles: Triangle[]): Entity[] {
    if (regions.length === 0) return [];

    // Touch counts: how many boundary triangles each region shares with another.
    const touch = buildTouchCounts(regions, triangles);
    const n = regions.length;
    // Build a region-id → array-index map so we never index `regions` by a
    // stale triangle.regionId that doesn't match the (possibly renumbered)
    // array layout.
    const idToIndex = new Map<number, number>();
    for (let i = 0; i < n; i++) idToIndex.set(regions[i].id, i);
    const parent = new Array<number>(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    // Merge coplanar touching regions.
    for (let a = 0; a < n; a++) {
      for (const [bId, count] of touch[a]) {
        const b = idToIndex.get(bId);
        if (b === undefined || b <= a) continue;
        if (count < this.options.minTouchArea) continue;
        const ang = angleBetween(regions[a].normal, regions[b].normal);
        const touches = regions[a].boundary.length >= this.options.minBoundary ||
          regions[b].boundary.length >= this.options.minBoundary;
        if (ang <= this.options.maxMergeAngle && touches) {
          union(a, b);
        }
      }
    }

    // Support relation: region whose normal points up, sitting on another.
    if (this.options.enableSupport) {
      for (let a = 0; a < n; a++) {
        const ra = regions[a];
        if (!isUpFacing(ra.normal)) continue;
        for (let b = 0; b < n; b++) {
          if (b === a) continue;
          const rb = regions[b];
          const verticalGap = ra.centroid[2] - rb.centroid[2];
          if (verticalGap > 0 && verticalGap <= this.options.supportGap) {
            // horizontal proximity
            const dx = ra.centroid[0] - rb.centroid[0];
            const dy = ra.centroid[1] - rb.centroid[1];
            if (Math.hypot(dx, dy) <= 2) union(a, b);
          }
        }
      }
    }

    // Build entities per connected component.
    const groups = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      let g = groups.get(r);
      if (!g) { g = []; groups.set(r, g); }
      g.push(i);
    }

    let entityId = 0;
    const entities: Entity[] = [];
    for (const regionIds of groups.values()) {
      const regionList = regionIds.map((i) => regions[i]);
      const triIds: number[] = [];
      let area = 0;
      for (const r of regionList) {
        for (const t of r.triangles) triIds.push(t);
        area += r.area;
      }
      const tris = triIds.map((id) => triangles[id]);
      const bbox: BoundingBox = tris.length > 0
        ? bboxFromTriangles(tris)
        : { min: [0, 0, 0], max: [0, 0, 0] };
      const obb = obbFromTriangles(tris);
      entities.push({
        id: entityId++,
        regions: regionIds,
        triangles: triIds,
        bbox,
        obb,
        neighbors: [],
        label: inferLabel(regionList, area),
        triangleCount: triIds.length,
      });
    }

    // Compute entity neighbours (touch relations).
    const regionToEntity = new Map<number, number>();
    for (let e = 0; e < entities.length; e++) {
      for (const rid of entities[e].regions) regionToEntity.set(rid, e);
    }
    for (let a = 0; a < n; a++) {
      const ea = regionToEntity.get(regions[a].id)!;
      for (const [bId] of touch[a]) {
        const eb = regionToEntity.get(bId);
        if (eb !== undefined && eb !== ea) {
          if (!entities[ea].neighbors.includes(eb)) entities[ea].neighbors.push(eb);
          if (!entities[eb].neighbors.includes(ea)) entities[eb].neighbors.push(ea);
        }
      }
    }
    return entities;
  }
}

/** Count shared boundary triangles between each region pair (deduped). */
export function buildTouchCounts(regions: Region[], triangles: Triangle[]): Map<number, number>[] {
  const n = regions.length;
  const out: Map<number, number>[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = new Map();
  // Map triangle.regionId → array index so map keys are always valid indices.
  const idToIndex = new Map<number, number>();
  for (let i = 0; i < n; i++) idToIndex.set(regions[i].id, i);
  for (const r of regions) {
    const aIdx = idToIndex.get(r.id) ?? -1;
    if (aIdx < 0) continue;
    for (const tid of r.triangles) {
      const t = triangles[tid];
      for (const nb of t.neighbors) {
        const other = triangles[nb].regionId;
        const otherIdx = other >= 0 ? idToIndex.get(other) : undefined;
        if (otherIdx === undefined || otherIdx === aIdx) continue;
        // Only count each unordered pair once (from the lower-index region).
        if (aIdx < otherIdx) {
          out[aIdx].set(otherIdx, (out[aIdx].get(otherIdx) ?? 0) + 1);
        }
      }
    }
  }
  return out;
}

/** True if a normal is "up-facing" (z-component > 0.7). */
export function isUpFacing(normal: [number, number, number]): boolean {
  return normal[2] > 0.7;
}

/** Infer a coarse geometry label from region normals & area. */
export function inferLabel(regions: Region[], area: number): string {
  if (regions.length === 0) return "unknown";
  // Dominant normal: average.
  let nz = 0;
  for (const r of regions) nz += r.normal[2];
  nz /= regions.length;
  if (nz > 0.7) return area > 50 ? "ground" : "roof";
  if (nz < -0.7) return "ceiling";
  if (Math.abs(nz) < 0.3) return "wall";
  return "surface";
}

/** Merge two entities' bboxes (helper for incremental updates). */
export function mergeEntityBBoxes(a: BoundingBox, b: BoundingBox): BoundingBox {
  return mergeBBox(a, b);
}
