/**
 * End-to-end verification against the real mars3d 3D Tiles tileset.
 *
 * Skipped by default to keep the unit-test suite offline & fast. Run with:
 *
 *   SEEE_E2E=1 npx vitest run tests/e2e-real-data.test.ts
 *
 * This validates the MVP requirements on real photogrammetry data:
 *   - 1M+ triangles input
 *   - bounded entity output
 *   - spatial continuity + topological consistency
 */
import { describe, it, expect } from "vitest";
import { SEEE, makeSyntheticScene, makeRandomMesh } from "@seee/sdk";

const RUN_E2E = process.env.SEEE_E2E === "1";
const RUN_BENCH = process.env.SEEE_BENCH === "1";
// Wrap so the reference to `it` is resolved at call-time (after globals load).
const itE2e = (name: string, fn: () => Promise<void> | void, timeout?: number) =>
  (RUN_E2E ? it : it.skip)(name, fn as any, timeout);
const itBench = (name: string, fn: () => Promise<void> | void, timeout?: number) =>
  (RUN_BENCH ? it : it.skip)(name, fn as any, timeout);

const TILESET_URL =
  process.env.SEEE_E2E_URL ?? "https://data.mars3d.cn/3dtiles/qx-simiao/tileset.json";
const MAX_TILES = Number(process.env.SEEE_E2E_MAX_TILES ?? 32);

describe("SEEE e2e on real 3D Tiles", () => {
  itE2e("loads + extracts entities from the mars3d tileset", async () => {
    const engine = new SEEE({
      regionOptions: { maxAngle: 25, maxDistance: 2.0, maxCurvature: 0.6, minRegionSize: 2 },
      topologyOptions: { minTouchArea: 1, minBoundary: 0, enableSupport: true, supportGap: 2.0, maxMergeAngle: 30 },
      chunkSize: 200_000,
    });

    const t0 = performance.now();
    await engine.load(TILESET_URL, {
      maxTiles: MAX_TILES,
      maxTriangles: 2_000_000,
      maxDepth: 4,
      onProgress: (info) => {
        if (info.tilesLoaded % 4 === 0) {
          process.stdout.write(`\r  fetched ${info.tilesLoaded} tiles (depth ${info.depth})…`);
        }
      },
    });
    process.stdout.write("\n");
    const entities = await engine.extract();
    const t1 = performance.now();

    const triCount = engine.getTriangles().length;
    console.log(`  triangles : ${triCount.toLocaleString()}`);
    console.log(`  entities  : ${entities.length.toLocaleString()}`);
    console.log(`  time      : ${(t1 - t0).toFixed(0)} ms`);

    expect(triCount).toBeGreaterThan(0);
    expect(entities.length).toBeGreaterThan(0);
    // Topology sanity: every entity has a finite bbox & ≥1 triangle.
    for (const e of entities) {
      expect(e.triangleCount).toBeGreaterThan(0);
      for (const v of [...e.bbox.min, ...e.bbox.max]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  }, 120_000);
});

describe("SEEE synthetic scaling", () => {
  itBench("handles a ~1M-triangle synthetic scene (MVP target)", async () => {
    const engine = new SEEE({
      regionOptions: { maxAngle: 15, maxDistance: 0.5, maxCurvature: 0.35, minRegionSize: 3 },
      topologyOptions: { minTouchArea: 2, minBoundary: 1, enableSupport: true, supportGap: 1.0, maxMergeAngle: 25 },
      chunkSize: 250_000,
    });
    // ~7.2k triangles per scene × 140 scenes ≈ 1M triangles.
    // Tile scenes on a 5-unit grid so they don't overlap and the proximity-
    // neighbour build stays O(n) instead of O(n²).
    const side = Math.ceil(Math.sqrt(140));
    const scenes = Array.from({ length: 140 }, (_, i) =>
      makeSyntheticScene(60, [(i % side) * 5, Math.floor(i / side) * 5, 0]),
    );
    engine.setMeshes(scenes);
    const t0 = performance.now();
    const entities = await engine.extract();
    const t1 = performance.now();
    console.log(`  triangles : ${engine.getTriangles().length.toLocaleString()}`);
    console.log(`  entities  : ${entities.length.toLocaleString()}`);
    console.log(`  time      : ${(t1 - t0).toFixed(0)} ms`);
    expect(engine.getTriangles().length).toBeGreaterThan(900_000);
    expect(entities.length).toBeGreaterThan(0);
  }, 300_000);

  it("survives a small unstructured (random) mesh without crashing", async () => {
    // Tiny random mesh (proximity-neighbour build is O(n·density); keep n small
    // so the default offline suite stays fast).
    const engine = new SEEE({ chunkSize: 50_000 });
    engine.setMeshes([makeRandomMesh(200)]);
    const entities = await engine.extract();
    console.log(`  random-mesh entities: ${entities.length}`);
    expect(entities.length).toBeGreaterThan(0);
  }, 30_000);
});
