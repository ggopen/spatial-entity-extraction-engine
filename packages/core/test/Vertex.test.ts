import { describe, it, expect } from "vitest";
import { VertexUtil } from "../src/Vertex.js";
import type { Vertex } from "../src/types.js";

describe("VertexUtil", () => {
  it("distance computes Euclidean length", () => {
    const a: Vertex = { id: 0, x: 0, y: 0, z: 0 };
    const b: Vertex = { id: 1, x: 3, y: 4, z: 0 };
    expect(VertexUtil.distance(a, b)).toBeCloseTo(5);
  });

  it("distance is symmetric", () => {
    const a: Vertex = { id: 0, x: 1, y: 2, z: 3 };
    const b: Vertex = { id: 1, x: 4, y: 6, z: 8 };
    expect(VertexUtil.distance(a, b)).toBeCloseTo(VertexUtil.distance(b, a));
  });

  it("centroid averages vertices", () => {
    const vs: Vertex[] = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 3, y: 0, z: 0 },
      { id: 2, x: 0, y: 3, z: 0 },
      { id: 3, x: 0, y: 0, z: 3 },
    ];
    const c = VertexUtil.centroid(vs);
    expect(c[0]).toBeCloseTo(0.75);
    expect(c[1]).toBeCloseTo(0.75);
    expect(c[2]).toBeCloseTo(0.75);
  });

  it("centroid returns origin for empty input", () => {
    expect(VertexUtil.centroid([])).toEqual([0, 0, 0]);
  });
});
