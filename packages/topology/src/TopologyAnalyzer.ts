import type { Entity, Region, Triangle } from "@seee/core";
import { SpatialGraph } from "./SpatialGraph.js";
import { buildTouchCounts } from "./TopologyMerge.js";

/**
 * Topology Analyzer.
 *
 * Builds the SpatialGraph (touch / contain / adjacent / support / intersect)
 * for a set of entities. Also exposes high-level analytical queries used by the
 * SDK: e.g. "what supports this entity?" or "what's inside this entity?".
 */
export class TopologyAnalyzer {
  private readonly graph: SpatialGraph;

  constructor(graph?: SpatialGraph) {
    this.graph = graph ?? new SpatialGraph();
  }

  /** Build the spatial graph from entities. */
  analyze(entities: Entity[]): SpatialGraph {
    this.graph.buildFromEntities(entities);
    return this.graph;
  }

  /** Get the underlying graph. */
  getGraph(): SpatialGraph {
    return this.graph;
  }

  /** Entities supporting the given entity (i.e. directly below it).
   *
   * A support edge `from → to` means `from` supports `to` (from is below to).
   * So the supporters of `entityId` are the `from` nodes of edges whose `to`
   * is `entityId`.
   */
  supporters(entityId: number): number[] {
    return this.graph
      .query({ type: "support" })
      .filter((e) => e.to === entityId)
      .map((e) => e.from);
  }

  /** Entities contained by the given entity. */
  contained(entityId: number): number[] {
    return this.graph
      .query({ type: "contain" })
      .filter((e) => e.from === entityId)
      .map((e) => e.to);
  }

  /** Entities touching the given entity. */
  touching(entityId: number): number[] {
    return this.graph
      .query({ type: "touch", nodeId: entityId })
      .map((e) => (e.from === entityId ? e.to : e.from));
  }
}

/** Recompute region touch counts (useful after incremental updates). */
export function recomputeTouches(regions: Region[], triangles: Triangle[]): Map<number, number>[] {
  return buildTouchCounts(regions, triangles);
}
