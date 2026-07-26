import { describe, it, expect } from "vitest";
import { SEEE, LRUCache, chunkTriangles, chunkToRawMesh, labelColor, makeSyntheticScene, makeRandomMesh } from "../src/index.js";
import { makeTriangle, type Vertex } from "@seee/core";

describe("LRUCache", () => {
  it("evicts least recently used", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a now most recent
    c.set("c", 3); // b should be evicted
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(false);
    expect(c.has("c")).toBe(true);
    expect(c.size).toBe(2);
  });

  it("delete and clear", () => {
    const c = new LRUCache(2);
    c.set("a", 1);
    expect(c.delete("a")).toBe(true);
    expect(c.has("a")).toBe(false);
    c.set("b", 2);
    c.clear();
    expect(c.size).toBe(0);
  });

  it("throws for non-positive capacity", () => {
    expect(() => new LRUCache(0)).toThrow();
  });
});

describe("chunkTriangles", () => {
  it("splits into chunks of given size", () => {
    const v: Vertex[] = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 1, y: 0, z: 0 },
      { id: 2, x: 0, y: 1, z: 0 },
    ];
    const tris = [makeTriangle(0, v[0], v[1], v[2]), makeTriangle(1, v[0], v[1], v[2]), makeTriangle(2, v[0], v[1], v[2])];
    const chunks = chunkTriangles(tris, 2);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(2);
    expect(chunks[1].length).toBe(1);
  });
});

describe("chunkToRawMesh", () => {
  it("produces a valid indexed mesh", () => {
    const v: Vertex[] = [
      { id: 0, x: 0, y: 0, z: 0 },
      { id: 1, x: 1, y: 0, z: 0 },
      { id: 2, x: 0, y: 1, z: 0 },
    ];
    const tris = [makeTriangle(0, v[0], v[1], v[2])];
    const mesh = chunkToRawMesh(tris, v, 0);
    expect(mesh.positions.length).toBe(9);
    expect(mesh.indices!.length).toBe(3);
  });
});

describe("labelColor", () => {
  it("maps known labels", () => {
    expect(labelColor("ground").green).toBeGreaterThan(0.5);
    expect(labelColor("wall").red).toBeGreaterThan(0.5);
    expect(labelColor("roof").red).toBeGreaterThan(0.5);
    expect(labelColor("ceiling").blue).toBeGreaterThan(0.3);
  });
  it("default color for unknown", () => {
    const c = labelColor("xyz");
    expect(c.blue).toBeGreaterThan(0.5);
  });
});

describe("SEEE end-to-end", () => {
  it("extracts entities from a synthetic scene", async () => {
    const engine = new SEEE();
    engine.setMeshes([makeSyntheticScene(6)]);
    const entities = await engine.extract();
    expect(entities.length).toBeGreaterThan(0);
    // All triangle ids referenced by entities should be valid.
    for (const e of entities) {
      for (const t of e.triangles) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThan(engine.getTriangles().length);
      }
    }
  });

  it("getEntity and getEntities are consistent", async () => {
    const engine = new SEEE();
    engine.setMeshes([makeSyntheticScene(4)]);
    const entities = await engine.extract();
    for (const e of entities) {
      expect(engine.getEntity(e.id)?.id).toBe(e.id);
    }
    expect(engine.getEntities().length).toBe(entities.length);
  });

  it("query returns spatial edges", async () => {
    const engine = new SEEE();
    engine.setMeshes([makeSyntheticScene(6)]);
    await engine.extract();
    const all = engine.query();
    expect(Array.isArray(all)).toBe(true);
  });

  it("pick finds an entity by position", async () => {
    const engine = new SEEE();
    engine.setMeshes([makeSyntheticScene(6)]);
    await engine.extract();
    let picked = 0;
    for (const e of engine.getEntities()) {
      const c = [(e.bbox.min[0] + e.bbox.max[0]) / 2, (e.bbox.min[1] + e.bbox.max[1]) / 2, (e.bbox.min[2] + e.bbox.max[2]) / 2] as [number, number, number];
      if (engine.pick(c)) picked++;
    }
    expect(picked).toBeGreaterThan(0);
  });

  it("highlight without attach warns", async () => {
    const engine = new SEEE();
    engine.setMeshes([makeSyntheticScene(4)]);
    const entities = await engine.extract();
    // Should not throw even without a Cesium viewer.
    engine.highlight(entities[0].id);
  });

  it("incrementalUpdate re-extracts", async () => {
    const engine = new SEEE();
    engine.setMeshes([makeSyntheticScene(4)]);
    await engine.extract();
    const e = await engine.incrementalUpdate(new Set([0]));
    expect(e.length).toBeGreaterThan(0);
  });

  it("extract throws when nothing loaded", async () => {
    const engine = new SEEE();
    await expect(engine.extract()).rejects.toThrow();
  });
});

describe("makeRandomMesh", () => {
  it("generates the requested triangle count", () => {
    const m = makeRandomMesh(10);
    expect(m.positions.length).toBe(10 * 3 * 3);
    expect(m.indices!.length).toBe(10 * 3);
  });
});
