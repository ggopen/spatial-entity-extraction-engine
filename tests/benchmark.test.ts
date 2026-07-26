/**
 * SEEE scaling benchmark — runs as a vitest test so the workspace package
 * aliases resolve correctly. Activated by `SEEE_BENCH=1`:
 *
 *   SEEE_BENCH=1 npx vitest run tests/benchmark.test.ts
 *
 * Scenes are tiled across a 2D grid with spacing ≥ 5 units so they don't
 * overlap and the proximity-neighbour build stays O(n) instead of O(n²).
 * Reports triangle / region / entity counts and timings at multiple scales
 * to demonstrate the Triangle → Region → Entity → Graph pipeline scales
 * toward the 1M-triangle MVP target. The largest scale is gated separately
 * by SEEE_BENCH_BIG=1 because it needs a few GB of heap.
 */
import { describe, it, expect } from "vitest";
import { SEEE, makeSyntheticScene } from "@seee/sdk";

const RUN = process.env.SEEE_BENCH === "1";
const RUN_BIG = process.env.SEEE_BENCH_BIG === "1";
const itBench = (name: string, fn: () => Promise<void> | void, timeout?: number) =>
  (RUN ? it : it.skip)(name, fn as any, timeout);
const itBig = (name: string, fn: () => Promise<void> | void, timeout?: number) =>
  (RUN_BIG ? it : it.skip)(name, fn as any, timeout);

/** Tile `count` scenes on a square grid with 5-unit spacing. */
function tileScenes(count: number, grid: number) {
  const side = Math.ceil(Math.sqrt(count));
  const out = [];
  for (let i = 0; i < count; i++) {
    const gx = i % side;
    const gy = Math.floor(i / side);
    out.push(makeSyntheticScene(grid, [gx * 5, gy * 5, 0]));
  }
  return out;
}

async function runScale(scenes: number, grid: number, label: string) {
  const meshes = tileScenes(scenes, grid);
  const engine = new SEEE({
    regionOptions: { maxAngle: 15, maxDistance: 0.5, maxCurvature: 0.35, minRegionSize: 3 },
    topologyOptions: { minTouchArea: 2, minBoundary: 1, enableSupport: true, supportGap: 1.0, maxMergeAngle: 25 },
    chunkSize: 100_000,
  });
  engine.setMeshes(meshes);
  meshes.length = 0;

  const t0 = performance.now();
  const entities = await engine.extract();
  const t1 = performance.now();

  const triangles = engine.getTriangles().length;
  const regions = entities.reduce((s, e) => s + e.regions.length, 0);
  const memMB = process.memoryUsage().rss / (1024 * 1024);
  console.log(
    `[${label}] triangles=${triangles.toLocaleString()} regions=${regions.toLocaleString()} ` +
    `entities=${entities.length.toLocaleString()} time=${Math.round(t1 - t0)}ms mem=${Math.round(memMB)}MB`,
  );
  return { triangles, regions, entities: entities.length, timeMs: t1 - t0 };
}

describe("SEEE scaling benchmark", () => {
  itBench("tiny   (~0.6k tris) — sanity check", async () => {
    const r = await runScale(2, 12, "tiny");
    expect(r.triangles).toBeGreaterThan(500);
    expect(r.entities).toBeGreaterThan(0);
  }, 60_000);

  itBench("small  (~6k tris)   — pipeline runs end-to-end", async () => {
    const r = await runScale(8, 20, "small");
    expect(r.triangles).toBeGreaterThan(5_000);
    expect(r.entities).toBeGreaterThan(0);
  }, 120_000);

  itBench("medium (~55k tris)  — scales linearly", async () => {
    const r = await runScale(30, 30, "medium");
    expect(r.triangles).toBeGreaterThan(50_000);
    expect(r.entities).toBeGreaterThan(0);
  }, 180_000);

  itBench("large  (~150k tris) — sustained scaling", async () => {
    const r = await runScale(80, 30, "large");
    expect(r.triangles).toBeGreaterThan(120_000);
    expect(r.entities).toBeGreaterThan(0);
  }, 240_000);

  // Reaches toward the 1M-triangle MVP target. Needs ~3 GB heap.
  itBig("xlarge (~1M tris)    — MVP target band", async () => {
    const r = await runScale(140, 60, "xlarge");
    expect(r.triangles).toBeGreaterThan(900_000);
    expect(r.entities).toBeGreaterThan(0);
  }, 600_000);
});
