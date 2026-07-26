/**
 * Standalone scaling benchmark for SEEE.
 *
 * Runs the full Triangle → Region → Entity → Graph pipeline at multiple
 * scales and prints triangle/region/entity counts plus timings. Designed
 * to be runnable in a memory-constrained sandbox (each scale is released
 * before the next one starts).
 *
 * Usage:
 *   node --experimental-vm-modules --loader ts-node/esm \
 *       packages/sdk/src/benchmark.ts
 *
 * Or, with vitest aliases, via tsx:
 *   npx tsx packages/sdk/src/benchmark.ts
 */
import { SEEE, makeSyntheticScene } from "./index.js";

interface ScaleResult {
  triangles: number;
  regions: number;
  entities: number;
  timeMs: number;
  memPeakMB: number;
}

async function runScale(scenes: number, grid: number, label: string): Promise<ScaleResult> {
  // Build meshes (release after ingestion).
  const meshes = Array.from({ length: scenes }, () => makeSyntheticScene(grid));

  const engine = new SEEE({
    regionOptions: { maxAngle: 15, maxDistance: 0.5, maxCurvature: 0.35, minRegionSize: 3 },
    topologyOptions: { minTouchArea: 2, minBoundary: 1, enableSupport: true, supportGap: 1.0, maxMergeAngle: 25 },
    chunkSize: 100_000,
  });
  engine.setMeshes(meshes);
  meshes.length = 0; // release

  const t0 = performance.now();
  const entities = await engine.extract();
  const t1 = performance.now();

  const memMB = process.memoryUsage().rss / (1024 * 1024);
  const triangles = engine.getTriangles().length;
  const regions = entities.reduce((s, e) => s + e.regions.length, 0);

  console.log(`[${label}] triangles=${triangles.toLocaleString()} regions=${regions.toLocaleString()} entities=${entities.length.toLocaleString()} time=${Math.round(t1 - t0)}ms mem=${Math.round(memMB)}MB`);

  return { triangles, regions, entities: entities.length, timeMs: t1 - t0, memPeakMB: memMB };
}

async function main(): Promise<void> {
  console.log("=== SEEE scaling benchmark ===");
  console.log(`node: ${process.version}  rss-limit-soft: ${Math.round((require("os").totalmem()) / (1024 * 1024))}MB total\n`);

  // Each scene at grid=20 ≈ 7.6k triangles; grid=40 ≈ 29.4k triangles.
  const scales: { scenes: number; grid: number; label: string }[] = [
    { scenes: 2, grid: 12, label: "tiny  (~3.5k tris)" },
    { scenes: 8, grid: 20, label: "small (~60k tris)" },
    { scenes: 30, grid: 30, label: "mid  (~270k tris)" },
    { scenes: 70, grid: 40, label: "large (~2M tris target)" },
  ];

  const results: ScaleResult[] = [];
  for (const s of scales) {
    try {
      const r = await runScale(s.scenes, s.grid, s.label);
      results.push(r);
      // Aggressive GC between scales (if exposed).
      if (global.gc) global.gc();
    } catch (err: any) {
      console.log(`[${s.label}] FAILED: ${err?.message ?? err}`);
      break;
    }
  }

  console.log("\n=== summary ===");
  for (const r of results) {
    console.log(
      `  ${r.triangles.toLocaleString().padStart(10)} tris → ` +
      `${r.entities.toString().padStart(5)} entities  ` +
      `(${Math.round(r.timeMs)}ms, ${Math.round(r.memPeakMB)}MB)`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
