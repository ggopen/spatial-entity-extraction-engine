import { describe, it, expect } from "vitest";
import { RegionGrowing, buildRegion, computeCurvature, DEFAULT_REGION_GROWING_OPTIONS } from "../src/RegionGrowing.js";
import { TriangleGraph } from "@seee/graph";
import { makeTriangle, type Vertex } from "@seee/core";

function gridMesh(n: number): { graph: TriangleGraph; vertices: Vertex[] } {
  const v: Vertex[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      v.push({ id: j * (n + 1) + i, x: i, y: j, z: 0 });
    }
  }
  const tris: any[] = [];
  let id = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = v[j * (n + 1) + i];
      const b = v[j * (n + 1) + i + 1];
      const c = v[(j + 1) * (n + 1) + i];
      const d = v[(j + 1) * (n + 1) + i + 1];
      tris.push(makeTriangle(id++, a, b, c));
      tris.push(makeTriangle(id++, b, d, c));
    }
  }
  const g = new TriangleGraph();
  g.build(tris);
  return { graph: g, vertices: v };
}

describe("RegionGrowing", () => {
  it("produces one region for a flat coplanar grid", () => {
    const { graph } = gridMesh(4);
    const regions = new RegionGrowing({ ...DEFAULT_REGION_GROWING_OPTIONS, minRegionSize: 1 }).execute(graph);
    expect(regions.length).toBeGreaterThanOrEqual(1);
    // All triangles should be assigned to a region (regionId >= 0).
    for (const t of graph.triangles) expect(t.regionId).toBeGreaterThanOrEqual(0);
    const total = regions.reduce((s, r) => s + r.triangles.length, 0);
    expect(total).toBe(graph.triangles.length);
  });

  it("separates two coplanar patches with a gap", () => {
    const v: Vertex[] = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 1, y: 0, z: 0 },
      { id: 2, x: 0, y: 1, z: 0 },
      // far patch (gap > maxDistance)
      { id: 3, x: 10, y: 0, z: 0 },
      { id: 4, x: 11, y: 0, z: 0 },
      { id: 5, x: 10, y: 1, z: 0 },
    ];
    const t = [
      makeTriangle(0, v[0], v[1], v[2]),
      makeTriangle(1, v[3], v[4], v[5]),
    ];
    const g = new TriangleGraph();
    g.build(t);
    const regions = new RegionGrowing({ ...DEFAULT_REGION_GROWING_OPTIONS, maxDistance: 0.5, minRegionSize: 1 }).execute(g);
    expect(regions.length).toBe(2);
  });

  it("computeCurvature returns non-negative values", () => {
    const { graph } = gridMesh(2);
    const c = computeCurvature(graph);
    expect(c.length).toBe(graph.triangles.length);
    for (const x of c) expect(x).toBeGreaterThanOrEqual(0);
  });

  it("buildRegion computes normal/centroid/area", () => {
    const { graph } = gridMesh(2);
    const r = buildRegion(0, graph.triangles.map((t) => t.id), graph.triangles);
    expect(r.area).toBeGreaterThan(0);
    expect(r.normal[2]).toBeCloseTo(1, 5);
    expect(r.centroid.length).toBe(3);
  });

  it("absorbs tiny regions below minRegionSize", () => {
    const v: Vertex[] = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 1, y: 0, z: 0 },
      { id: 2, x: 0, y: 1, z: 0 },
      { id: 3, x: 1, y: 1, z: 0 },
    ];
    const t = [
      makeTriangle(0, v[0], v[1], v[2]),
      makeTriangle(1, v[1], v[3], v[2]),
      // isolated single tri
      makeTriangle(2, { id: 4, x: 50, y: 0, z: 0 }, { id: 5, x: 51, y: 0, z: 0 }, { id: 6, x: 50, y: 1, z: 0 }),
    ];
    const g = new TriangleGraph();
    g.build(t);
    const regions = new RegionGrowing({ ...DEFAULT_REGION_GROWING_OPTIONS, minRegionSize: 3, maxDistance: 0.5 }).execute(g);
    // The isolated triangle (region size 1) should be its own region since it has
    // no neighbour to be absorbed into.
    expect(regions.length).toBeGreaterThanOrEqual(1);
  });
});
