import { describe, it, expect } from "vitest";
import { ConnectedComponent, buildRegionAdjacency } from "../src/ConnectedComponent.js";
import type { Region, Triangle } from "@seee/core";

function fakeTris(regionIds: number[]): Triangle[] {
  const tris: Triangle[] = regionIds.map((rid, i) => ({
    id: i,
    vertices: [i * 3, i * 3 + 1, i * 3 + 2],
    normal: [0, 0, 1],
    centroid: [i, 0, 0],
    neighbors: [],
    regionId: rid,
    area: 1,
  }));
  // make tri 0 and tri 1 neighbours (regions 0 and 1 connected)
  tris[0].neighbors = [1];
  tris[1].neighbors = [0];
  return tris;
}

describe("ConnectedComponent", () => {
  it("finds one component when all regions connect", () => {
    const tris = fakeTris([0, 1, 2]);
    // Connect all three: 0-1-2
    tris[0].neighbors = [1];
    tris[1].neighbors = [0, 2];
    tris[2].neighbors = [1];
    const regions: Region[] = [
      { id: 0, triangles: [0], boundary: [], normal: [0, 0, 1], centroid: [0, 0, 0], area: 1 },
      { id: 1, triangles: [1], boundary: [], normal: [0, 0, 1], centroid: [1, 0, 0], area: 1 },
      { id: 2, triangles: [2], boundary: [], normal: [0, 0, 1], centroid: [2, 0, 0], area: 1 },
    ];
    const cc = new ConnectedComponent();
    const comps = cc.find(regions, tris, "bfs");
    expect(comps.length).toBe(1);
  });

  it("separates disconnected components", () => {
    const tris = fakeTris([0, 1, 2]);
    // break the link between tri 0 and 1
    tris[0].neighbors = [];
    tris[1].neighbors = [];
    const regions: Region[] = [
      { id: 0, triangles: [0], boundary: [], normal: [0, 0, 1], centroid: [0, 0, 0], area: 1 },
      { id: 1, triangles: [1], boundary: [], normal: [0, 0, 1], centroid: [1, 0, 0], area: 1 },
      { id: 2, triangles: [2], boundary: [], normal: [0, 0, 1], centroid: [2, 0, 0], area: 1 },
    ];
    const cc = new ConnectedComponent();
    const comps = cc.find(regions, tris, "union-find");
    expect(comps.length).toBe(3);
  });

  it("bfs, dfs and union-find agree on component count", () => {
    const tris = fakeTris([0, 1, 2, 3]);
    // chain: 0-1-2-3
    tris[0].neighbors = [1];
    tris[1].neighbors = [0, 2];
    tris[2].neighbors = [1, 3];
    tris[3].neighbors = [2];
    const regions: Region[] = [0, 1, 2, 3].map((i) => ({
      id: i, triangles: [i], boundary: [], normal: [0, 0, 1], centroid: [i, 0, 0], area: 1,
    }));
    const cc = new ConnectedComponent();
    const bfs = cc.find(regions, tris, "bfs");
    const dfs = cc.find(regions, tris, "dfs");
    const uf = cc.find(regions, tris, "union-find");
    expect(bfs.length).toBe(1);
    expect(dfs.length).toBe(1);
    expect(uf.length).toBe(1);
  });

  it("buildRegionAdjacency dedups edges", () => {
    const tris = fakeTris([0, 1]);
    tris[0].neighbors = [1, 1]; // duplicate neighbour id (unusual)
    tris[1].neighbors = [0, 0];
    const regions: Region[] = [
      { id: 0, triangles: [0], boundary: [], normal: [0, 0, 1], centroid: [0, 0, 0], area: 1 },
      { id: 1, triangles: [1], boundary: [], normal: [0, 0, 1], centroid: [1, 0, 0], area: 1 },
    ];
    const adj = buildRegionAdjacency(regions, tris);
    expect(adj[0]).toEqual([1]);
    expect(adj[1]).toEqual([0]);
  });

  it("handles empty input", () => {
    const cc = new ConnectedComponent();
    expect(cc.find([], [])).toEqual([]);
  });
});
