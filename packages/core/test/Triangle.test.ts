import { describe, it, expect } from "vitest";
import { makeTriangle, buildVerticesAndTriangles, angleBetween, cross, dot, normalize } from "../src/Triangle.js";
import type { Vertex } from "../src/types.js";

describe("Triangle math", () => {
  it("cross product is right-handed", () => {
    const r = cross(1, 0, 0, 0, 1, 0);
    expect(r).toEqual([0, 0, 1]);
  });

  it("dot product", () => {
    expect(dot(1, 2, 3, 4, 5, 6)).toBe(32);
  });

  it("normalize makes a unit vector", () => {
    const v: [number, number, number] = [3, 4, 0];
    const len = normalize(v);
    expect(len).toBeCloseTo(5);
    expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1);
  });

  it("normalize leaves zero vector as zero", () => {
    const v: [number, number, number] = [0, 0, 0];
    normalize(v);
    expect(v).toEqual([0, 0, 0]);
  });

  it("angleBetween is 0 for parallel normals and 90 for orthogonal", () => {
    expect(angleBetween([0, 0, 1], [0, 0, 1])).toBeCloseTo(0, 5);
    expect(angleBetween([0, 0, 1], [1, 0, 0])).toBeCloseTo(90, 5);
  });

  it("makeTriangle computes area and normal", () => {
    const a: Vertex = { id: 0, x: 0, y: 0, z: 0 };
    const b: Vertex = { id: 1, x: 2, y: 0, z: 0 };
    const c: Vertex = { id: 2, x: 0, y: 2, z: 0 };
    const t = makeTriangle(0, a, b, c);
    expect(t.area).toBeCloseTo(2);
    expect(t.normal[2]).toBeCloseTo(1);
    expect(t.regionId).toBe(-1);
    expect(t.neighbors).toEqual([]);
    expect(t.centroid).toEqual([2 / 3, 2 / 3, 0]);
  });

  it("buildVerticesAndTriangles handles indexed mesh", () => {
    const mesh = {
      format: "glb" as const,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
    };
    const { vertices, triangles } = buildVerticesAndTriangles(mesh);
    expect(vertices.length).toBe(4);
    expect(triangles.length).toBe(2);
    expect(triangles[0].vertices).toEqual([0, 1, 2]);
    expect(triangles[1].vertices).toEqual([1, 3, 2]);
  });

  it("buildVerticesAndTriangles falls back to triangle-list when no indices", () => {
    // 9 positions = 3 vertices = 1 triangle (positions are treated as a tri-list).
    const mesh = {
      format: "glb" as const,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    };
    const { triangles } = buildVerticesAndTriangles(mesh);
    expect(triangles.length).toBe(1);
  });

  it("applies transform to vertices", () => {
    const mesh = {
      format: "glb" as const,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      transform: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        10, 20, 30, 1,
      ] as any,
    };
    const { triangles } = buildVerticesAndTriangles(mesh);
    expect(triangles[0].centroid).toEqual([10 + 1 / 3, 20 + 1 / 3, 30]);
  });
});
