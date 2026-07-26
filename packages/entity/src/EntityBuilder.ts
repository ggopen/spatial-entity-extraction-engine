import type { Entity, Region, Triangle } from "@seee/core";
import { bboxFromTriangles, mergeBBox } from "@seee/geometry";
import { obbFromTriangles } from "@seee/geometry";
import { inferLabel } from "@seee/topology";

/**
 * Entity Builder.
 *
 * Wraps the TopologyMerge output to provide incremental update helpers:
 *   - rebuild an entity's bbox/obb after triangle edits,
 *   - merge two entities into one,
 *   - split an entity by region.
 *
 * The builder is the single source of truth for "Entity ↔ Region ↔ Triangle"
 * bookkeeping; downstream packages (scene-graph, sdk) consume its output.
 */
export class EntityBuilder {
  /** Build an Entity from a flat list of regions & triangles. */
  build(id: number, regions: Region[], triangles: Triangle[]): Entity {
    const triIds: number[] = [];
    let area = 0;
    for (const r of regions) {
      for (const t of r.triangles) triIds.push(t);
      area += r.area;
    }
    const tris = triIds.map((i) => triangles[i]);
    const bbox = tris.length > 0
      ? bboxFromTriangles(tris)
      : { min: [0, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number] };
    const obb = obbFromTriangles(tris);
    return {
      id,
      regions: regions.map((r) => r.id),
      triangles: triIds,
      bbox,
      obb,
      neighbors: [],
      label: inferLabel(regions, area),
      triangleCount: triIds.length,
    };
  }

  /** Merge `b` into `a` (a absorbs b's regions & triangles). */
  merge(a: Entity, b: Entity, triangles: Triangle[], regions: Region[]): Entity {
    const regionObjs = [
      ...a.regions.map((id) => regions[id]),
      ...b.regions.map((id) => regions[id]),
    ];
    const triIds = [...a.triangles, ...b.triangles];
    const tris = triIds.map((i) => triangles[i]);
    const bbox = mergeBBox(a.bbox, b.bbox);
    const obb = obbFromTriangles(tris);
    const neighbors = new Set([...a.neighbors, ...b.neighbors]);
    neighbors.delete(a.id);
    neighbors.delete(b.id);
    return {
      id: a.id,
      regions: regionObjs.map((r) => r.id),
      triangles: triIds,
      bbox,
      obb,
      neighbors: [...neighbors],
      label: inferLabel(regionObjs, a.triangles.length + b.triangles.length),
      triangleCount: triIds.length,
    };
  }

  /** Recompute an entity's bbox/obb after its triangles changed in place. */
  rebuildGeometry(entity: Entity, triangles: Triangle[]): Entity {
    const tris = entity.triangles.map((i) => triangles[i]);
    return {
      ...entity,
      bbox: tris.length > 0 ? bboxFromTriangles(tris) : entity.bbox,
      obb: obbFromTriangles(tris),
      triangleCount: tris.length,
    };
  }

  /** Split an entity into two by region-id sets. */
  split(entity: Entity, keep: Set<number>, regions: Region[], triangles: Triangle[]): Entity[] {
    const keepRegions: Region[] = [];
    const dropRegions: Region[] = [];
    for (const rid of entity.regions) {
      if (keep.has(rid)) keepRegions.push(regions[rid]);
      else dropRegions.push(regions[rid]);
    }
    return [
      this.build(entity.id, keepRegions, triangles),
      this.build(entity.id + 1, dropRegions, triangles),
    ];
  }
}
