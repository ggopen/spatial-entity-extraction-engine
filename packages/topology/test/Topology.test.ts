import { describe, it, expect } from "vitest";
import {
  TopologyMerge,
  DEFAULT_TOPOLOGY_MERGE_OPTIONS,
  buildTouchCounts,
  isUpFacing,
  inferLabel,
  mergeEntityBBoxes,
} from "../src/TopologyMerge.js";
import { SpatialGraph } from "../src/SpatialGraph.js";
import { TopologyAnalyzer } from "../src/TopologyAnalyzer.js";
import type { Region, Triangle, Entity } from "@seee/core";

function makeRegion(id: number, triIds: number[], normal: [number, number, number], centroid: [number, number, number], area = 1): Region {
  return { id, triangles: triIds, boundary: [], normal, centroid, area };
}

function makeTri(id: number, regionId: number, neighbors: number[] = []): Triangle {
  return { id, vertices: [id * 3, id * 3 + 1, id * 3 + 2], normal: [0, 0, 1], centroid: [id, 0, 0], bbox: { min: [id, 0, 0], max: [id, 0, 0] }, neighbors, regionId, area: 1 };
}

describe("TopologyMerge", () => {
  it("merges coplanar touching regions", () => {
    // Two coplanar regions, region 0's triangle is neighbour of region 1's.
    const tris = [makeTri(0, 0, [1]), makeTri(1, 1, [0])];
    const regions = [
      makeRegion(0, [0], [0, 0, 1], [0, 0, 0]),
      makeRegion(1, [1], [0, 0, 1], [1, 0, 0]),
    ];
    const merge = new TopologyMerge({ ...DEFAULT_TOPOLOGY_MERGE_OPTIONS, minTouchArea: 1, minBoundary: 0 });
    const entities = merge.execute(regions, tris);
    expect(entities.length).toBe(1);
    expect(entities[0].triangles.length).toBe(2);
  });

  it("keeps separate non-touching regions", () => {
    const tris = [makeTri(0, 0), makeTri(1, 1)];
    const regions = [
      makeRegion(0, [0], [0, 0, 1], [0, 0, 0]),
      makeRegion(1, [1], [0, 0, 1], [10, 0, 0]),
    ];
    const merge = new TopologyMerge(DEFAULT_TOPOLOGY_MERGE_OPTIONS);
    const entities = merge.execute(regions, tris);
    expect(entities.length).toBe(2);
  });

  it("buildTouchCounts counts shared boundary triangles", () => {
    const tris = [makeTri(0, 0, [1]), makeTri(1, 1, [0]), makeTri(2, 1, [3]), makeTri(3, 2, [2])];
    const regions = [
      makeRegion(0, [0], [0, 0, 1], [0, 0, 0]),
      makeRegion(1, [1, 2], [0, 0, 1], [1, 0, 0]),
      makeRegion(2, [3], [0, 0, 1], [2, 0, 0]),
    ];
    const counts = buildTouchCounts(regions, tris);
    expect(counts[0].get(1)).toBe(1);
    expect(counts[1].get(2)).toBe(1);
  });

  it("isUpFacing", () => {
    expect(isUpFacing([0, 0, 0.9])).toBe(true);
    expect(isUpFacing([0, 0, 0.5])).toBe(false);
  });

  it("inferLabel uses dominant normal", () => {
    expect(inferLabel([makeRegion(0, [0], [0, 0, 1], [0, 0, 0], 100)], 100)).toBe("ground");
    expect(inferLabel([makeRegion(0, [0], [0, 0, -1], [0, 0, 0])], 1)).toBe("ceiling");
    expect(inferLabel([makeRegion(0, [0], [1, 0, 0], [0, 0, 0])], 1)).toBe("wall");
  });

  it("mergeEntityBBoxes unions boxes", () => {
    const a = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
    const b = { min: [2, 2, 2] as [number, number, number], max: [3, 3, 3] as [number, number, number] };
    const m = mergeEntityBBoxes(a, b);
    expect(m.min).toEqual([0, 0, 0]);
    expect(m.max).toEqual([3, 3, 3]);
  });
});

describe("SpatialGraph", () => {
  function fakeEntity(id: number, bbox: { min: number[]; max: number[] }, neighbors: number[] = [], label = "wall"): Entity {
    return {
      id,
      regions: [],
      triangles: [],
      bbox: bbox as any,
      obb: { center: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfExtents: [1, 1, 1] },
      neighbors,
      label,
      triangleCount: 1,
    };
  }

  it("adds nodes and edges", () => {
    const g = new SpatialGraph();
    g.addNode(fakeEntity(0, { min: [0, 0, 0], max: [1, 1, 1] }));
    g.addNode(fakeEntity(1, { min: [2, 0, 0], max: [3, 1, 1] }));
    g.addEdge(0, 1, "touch");
    expect(g.nodeCount()).toBe(2);
    expect(g.edgeCount()).toBe(1);
    expect(g.query({ type: "touch" }).length).toBe(1);
  });

  it("buildFromEntities computes relations", () => {
    const g = new SpatialGraph();
    const e0 = fakeEntity(0, { min: [0, 0, 0], max: [2, 2, 2] }, [1]);
    const e1 = fakeEntity(1, { min: [1, 1, 1], max: [3, 3, 3] }, [0]);
    g.buildFromEntities([e0, e1]);
    // Should have at least the touch edge + an intersect edge (boxes overlap).
    expect(g.edgeCount()).toBeGreaterThanOrEqual(2);
  });

  it("query by nodeId filters", () => {
    const g = new SpatialGraph();
    g.addNode(fakeEntity(0, { min: [0, 0, 0], max: [1, 1, 1] }));
    g.addNode(fakeEntity(1, { min: [2, 0, 0], max: [3, 1, 1] }));
    g.addEdge(0, 1, "touch");
    g.addEdge(0, 1, "adjacent");
    const edges = g.query({ nodeId: 0 });
    expect(edges.length).toBe(2);
  });

  it("neighbors returns adjacency set", () => {
    const g = new SpatialGraph();
    g.addNode(fakeEntity(0, { min: [0, 0, 0], max: [1, 1, 1] }));
    g.addNode(fakeEntity(1, { min: [2, 0, 0], max: [3, 1, 1] }));
    g.addEdge(0, 1, "touch");
    expect(g.neighbors(0)).toEqual([1]);
  });
});

describe("TopologyAnalyzer", () => {
  it("builds graph and exposes queries", () => {
    const a = new TopologyAnalyzer();
    const e0: Entity = { id: 0, regions: [], triangles: [], bbox: { min: [0, 0, 0], max: [2, 2, 2] }, obb: { center: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfExtents: [1, 1, 1] }, neighbors: [1], label: "wall", triangleCount: 1 };
    const e1: Entity = { id: 1, regions: [], triangles: [], bbox: { min: [1, 1, 1], max: [3, 3, 3] }, obb: { center: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfExtents: [1, 1, 1] }, neighbors: [0], label: "wall", triangleCount: 1 };
    a.analyze([e0, e1]);
    expect(a.touching(0)).toContain(1);
    expect(a.getGraph().nodeCount()).toBe(2);
  });

  it("supporters / contained / touching return arrays", () => {
    const a = new TopologyAnalyzer();
    // Big container that contains a small box; small box sits on a slab.
    const slab: Entity = { id: 0, regions: [], triangles: [], bbox: { min: [0, 0, 0], max: [4, 4, 0.5] }, obb: { center: [2, 2, 0.25], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfExtents: [2, 2, 0.25] }, neighbors: [1], label: "ground", triangleCount: 1 };
    const box: Entity = { id: 1, regions: [], triangles: [], bbox: { min: [1, 1, 0.6], max: [2, 2, 2] }, obb: { center: [1.5, 1.5, 1.3], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfExtents: [0.5, 0.5, 0.7] }, neighbors: [0], label: "wall", triangleCount: 1 };
    const room: Entity = { id: 2, regions: [], triangles: [], bbox: { min: [-1, -1, -1], max: [5, 5, 5] }, obb: { center: [2, 2, 2], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfExtents: [3, 3, 3] }, neighbors: [], label: "wall", triangleCount: 1 };
    a.analyze([slab, box, room]);
    // box is supported by slab (slab directly below box).
    expect(a.supporters(1)).toContain(0);
    // room contains slab and box.
    expect(a.contained(2)).toEqual(expect.arrayContaining([0, 1]));
    // touching neighbours.
    expect(a.touching(0)).toContain(1);
  });

  it("accepts an injected graph", () => {
    const g = new SpatialGraph();
    const a = new TopologyAnalyzer(g);
    expect(a.getGraph()).toBe(g);
  });
});
