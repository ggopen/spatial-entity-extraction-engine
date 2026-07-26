import { describe, it, expect } from "vitest";
import { TriangleGraph } from "../src/TriangleGraph.js";
import { makeTriangle, type Vertex } from "@seee/core";

function square(): { v: Vertex[]; t: any[] } {
  const v: Vertex[] = [
    { id: 0, x: 0, y: 0, z: 0 },
    { id: 1, x: 1, y: 0, z: 0 },
    { id: 2, x: 1, y: 1, z: 0 },
    { id: 3, x: 0, y: 1, z: 0 },
  ];
  const t = [
    makeTriangle(0, v[0], v[1], v[2]),
    makeTriangle(1, v[0], v[2], v[3]),
  ];
  return { v, t };
}

describe("TriangleGraph", () => {
  it("builds edge neighbours for two triangles sharing an edge", () => {
    const { t } = square();
    const g = new TriangleGraph();
    g.build(t);
    expect(g.size()).toBe(2);
    expect(g.getNeighborIds(0)).toEqual([1]);
    expect(g.getNeighborIds(1)).toEqual([0]);
    expect(t[0].neighbors).toEqual([1]);
    expect(t[1].neighbors).toEqual([0]);
  });

  it("degree and getNeighbors return Triangle objects", () => {
    const { t } = square();
    const g = new TriangleGraph();
    g.build(t);
    expect(g.degree(0)).toBe(1);
    const n = g.getNeighbors(0);
    expect(n.length).toBe(1);
    expect(n[0].id).toBe(1);
  });

  it("isolated triangles have no neighbours", () => {
    const v: Vertex[] = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 1, y: 0, z: 0 },
      { id: 2, x: 0, y: 1, z: 0 },
    ];
    const t = [makeTriangle(0, v[0], v[1], v[2])];
    const g = new TriangleGraph();
    g.build(t);
    expect(g.degree(0)).toBe(0);
  });

  it("addEdge does not duplicate", () => {
    const { t } = square();
    const g = new TriangleGraph();
    g.build(t);
    g.addEdge(0, 1); // already exists
    expect(g.degree(0)).toBe(1);
  });

  it("addProximityNeighbours links nearby triangles", () => {
    const v: Vertex[] = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 1, y: 0, z: 0 },
      { id: 2, x: 0, y: 1, z: 0 },
      { id: 3, x: 5, y: 5, z: 0 }, // far
      { id: 4, x: 6, y: 5, z: 0 },
      { id: 5, x: 5, y: 6, z: 0 },
    ];
    const t = [makeTriangle(0, v[0], v[1], v[2]), makeTriangle(1, v[3], v[4], v[5])];
    const g = new TriangleGraph();
    g.build(t);
    const added = g.addProximityNeighbours(2.0);
    expect(added).toBe(0); // far apart, not within tolerance
    const added2 = g.addProximityNeighbours(10.0);
    expect(added2).toBe(1);
    expect(g.hasEdge(0, 1)).toBe(true);
  });

  it("iterTriangles yields all triangles", () => {
    const { t } = square();
    const g = new TriangleGraph();
    g.build(t);
    const ids = [...g.iterTriangles()].map((x) => x.id);
    expect(ids).toEqual([0, 1]);
  });
});
