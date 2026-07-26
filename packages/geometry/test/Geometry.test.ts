import { describe, it, expect } from "vitest";
import { bboxFromTriangles, bboxFromVertices, mergeBBox, bboxDiagonal, bboxIntersects } from "../src/BoundingBox.js";
import { obbFromTriangles, obbToAABB, obbVolume } from "../src/OBB.js";
import { pcaFromTriangles, pcaFromVertices } from "../src/PCA.js";
import { makeTriangle, type Vertex, type Triangle } from "@seee/core";

describe("BoundingBox", () => {
  it("computes AABB from triangles", () => {
    const v: Vertex[] = [
      { id: 0, x: -1, y: 0, z: 2 },
      { id: 1, x: 3, y: 0, z: 2 },
      { id: 2, x: 1, y: 0, z: -5 },
    ];
    const t = [makeTriangle(0, v[0], v[1], v[2])];
    const b = bboxFromTriangles(t);
    expect(b.min).toEqual([-1, 0, -5]);
    expect(b.max).toEqual([3, 0, 2]);
  });

  it("computes AABB from vertices", () => {
    const v: Vertex[] = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 2, y: -1, z: 5 },
    ];
    const b = bboxFromVertices(v);
    expect(b.min).toEqual([0, -1, 0]);
    expect(b.max).toEqual([2, 0, 5]);
  });

  it("mergeBBox unions two boxes", () => {
    const a = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
    const b = { min: [2, -1, 0] as [number, number, number], max: [3, 2, 1] as [number, number, number] };
    const m = mergeBBox(a, b);
    expect(m.min).toEqual([0, -1, 0]);
    expect(m.max).toEqual([3, 2, 1]);
  });

  it("bboxDiagonal", () => {
    expect(bboxDiagonal({ min: [0, 0, 0], max: [3, 4, 0] })).toBeCloseTo(5);
  });

  it("bboxIntersects", () => {
    const a = { min: [0, 0, 0] as [number, number, number], max: [2, 2, 2] as [number, number, number] };
    const b = { min: [1, 1, 1] as [number, number, number], max: [3, 3, 3] as [number, number, number] };
    const c = { min: [5, 5, 5] as [number, number, number], max: [6, 6, 6] as [number, number, number] };
    expect(bboxIntersects(a, b)).toBe(true);
    expect(bboxIntersects(a, c)).toBe(false);
  });

  it("handles empty input", () => {
    expect(bboxFromTriangles([])).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
    expect(bboxFromVertices([])).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });
});

describe("PCA", () => {
  it("returns identity for empty input", () => {
    const p = pcaFromTriangles([]);
    expect(p.center).toEqual([0, 0, 0]);
    expect(p.axes[0]).toEqual([1, 0, 0]);
  });

  it("recovers the dominant axis of an elongated cloud", () => {
    const v: Vertex[] = [];
    for (let i = 0; i < 50; i++) v.push({ id: i, x: i * 10, y: 0, z: 0 });
    const p = pcaFromVertices(v);
    // The first principal axis should be (±1,0,0).
    expect(Math.abs(p.axes[0][0])).toBeGreaterThan(0.99);
    expect(p.eigenvalues[0]).toBeGreaterThan(p.eigenvalues[1]);
  });

  it("PCA from triangles", () => {
    const v: Vertex[] = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 1, y: 0, z: 0 },
      { id: 2, x: 0, y: 1, z: 0 },
    ];
    const t: Triangle[] = [makeTriangle(0, v[0], v[1], v[2])];
    const p = pcaFromTriangles(t);
    expect(p.center.length).toBe(3);
    expect(p.eigenvalues.length).toBe(3);
  });
});

describe("OBB", () => {
  it("builds OBB with non-negative half extents", () => {
    const v: Vertex[] = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 4, y: 0, z: 0 },
      { id: 2, x: 0, y: 2, z: 0 },
      { id: 3, x: 4, y: 2, z: 0 },
    ];
    const t: Triangle[] = [makeTriangle(0, v[0], v[1], v[2]), makeTriangle(1, v[1], v[3], v[2])];
    const o = obbFromTriangles(t);
    expect(o.halfExtents[0]).toBeGreaterThanOrEqual(0);
    expect(o.halfExtents[1]).toBeGreaterThanOrEqual(0);
    expect(o.halfExtents[2]).toBeGreaterThanOrEqual(0);
  });

  it("obbToAABB and obbVolume", () => {
    // Two non-coplanar triangles forming a "tent" -> non-zero volume OBB.
    const v: Vertex[] = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 2, y: 0, z: 0 },
      { id: 2, x: 0, y: 2, z: 0 },
      { id: 3, x: 0, y: 0, z: 2 },
    ];
    const t = [
      makeTriangle(0, v[0], v[1], v[2]),
      makeTriangle(1, v[0], v[1], v[3]),
    ];
    const o = obbFromTriangles(t);
    const ab = obbToAABB(o);
    expect(ab.min.length).toBe(3);
    expect(obbVolume(o)).toBeGreaterThan(0);
  });

  it("returns identity OBB for empty input", () => {
    const o = obbFromTriangles([]);
    expect(o.center).toEqual([0, 0, 0]);
    expect(o.halfExtents).toEqual([0, 0, 0]);
  });
});
