import { describe, it, expect } from "vitest";
import { EntityBuilder } from "../src/EntityBuilder.js";
import type { Region, Triangle } from "@seee/core";
import { makeTriangle, type Vertex } from "@seee/core";

describe("EntityBuilder", () => {
  function setup() {
    const v: Vertex[] = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 1, y: 0, z: 0 },
      { id: 2, x: 0, y: 1, z: 0 },
      { id: 3, x: 1, y: 1, z: 0 },
    ];
    const triangles: Triangle[] = [
      makeTriangle(0, v[0], v[1], v[2]),
      makeTriangle(1, v[1], v[3], v[2]),
    ];
    triangles[0].neighbors = [1];
    triangles[1].neighbors = [0];
    const regions: Region[] = [
      { id: 0, triangles: [0, 1], boundary: [], normal: [0, 0, 1], centroid: [0.5, 0.5, 0], area: 1 },
    ];
    return { v, triangles, regions };
  }

  it("builds an entity from regions", () => {
    const { triangles, regions } = setup();
    const builder = new EntityBuilder();
    const e = builder.build(0, regions, triangles);
    expect(e.id).toBe(0);
    expect(e.triangles).toEqual([0, 1]);
    expect(e.regions).toEqual([0]);
    expect(e.triangleCount).toBe(2);
    expect(e.bbox.min).toEqual([0, 0, 0]);
    expect(e.bbox.max).toEqual([1, 1, 0]);
  });

  it("merges two entities", () => {
    const { triangles, regions } = setup();
    const builder = new EntityBuilder();
    const e0 = builder.build(0, [regions[0]], triangles);
    const e1 = builder.build(1, [{ ...regions[0], id: 1, triangles: [], area: 0, centroid: [2, 2, 2] }], triangles);
    const merged = builder.merge(e0, e1, triangles, [...regions, { ...regions[0], id: 1 }]);
    expect(merged.triangles.length).toBe(2);
    expect(merged.regions.length).toBe(2);
  });

  it("rebuildGeometry updates bbox", () => {
    const { triangles, regions } = setup();
    const builder = new EntityBuilder();
    const e = builder.build(0, regions, triangles);
    // Mutate a triangle's per-triangle bbox (geometry envelope), which is
    // what bboxFromTriangles reads.
    triangles[0].bbox = {
      min: [5, 5, 5],
      max: [6, 6, 6],
    };
    const rebuilt = builder.rebuildGeometry(e, triangles);
    expect(rebuilt.bbox.max[0]).toBeGreaterThanOrEqual(5);
  });

  it("splits an entity", () => {
    const { triangles, regions } = setup();
    const builder = new EntityBuilder();
    const e = builder.build(0, regions, triangles);
    const [keep, drop] = builder.split(e, new Set([0]), regions, triangles);
    expect(keep.triangles).toEqual([0, 1]);
    expect(drop.triangles).toEqual([]);
  });
});
