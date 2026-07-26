import { describe, it, expect } from "vitest";
import {
  SegmentationWorkerPool,
  runSegmentation,
  type WorkerHandle,
  type SegmentationWorkerRequest,
  type SegmentationWorkerResponse,
} from "../src/SegmentationWorker.js";
import type { RawMesh } from "@seee/core";

/** Generate `count` random triangles in a unit cube (local copy to avoid sdk cycle). */
function makeRandomMesh(count: number): RawMesh {
  const positions = new Float32Array(count * 3 * 3);
  const indices = new Uint32Array(count * 3);
  for (let i = 0; i < count; i++) {
    for (let v = 0; v < 3; v++) {
      positions[(i * 3 + v) * 3] = Math.random();
      positions[(i * 3 + v) * 3 + 1] = Math.random();
      positions[(i * 3 + v) * 3 + 2] = Math.random();
    }
    indices[i * 3] = i * 3;
    indices[i * 3 + 1] = i * 3 + 1;
    indices[i * 3 + 2] = i * 3 + 2;
  }
  return { format: "glb", positions, indices };
}

/** Build a fake WorkerHandle that resolves requests synchronously via runSegmentation. */
function fakeWorker(): WorkerHandle & { posted: SegmentationWorkerRequest[] } {
  let cb: ((msg: SegmentationWorkerResponse) => void) | null = null;
  const posted: SegmentationWorkerRequest[] = [];
  return {
    posted,
    postMessage: (req: SegmentationWorkerRequest) => {
      posted.push(req);
      // Defer the response so the pool's pending/resolver bookkeeping runs
      // the same way as a real worker.
      const resp = runSegmentation(req);
      queueMicrotask(() => cb?.(resp));
    },
    onMessage: (handler: (msg: SegmentationWorkerResponse) => void) => {
      cb = handler;
    },
    terminate: () => {
      cb = null;
    },
  };
}

describe("SegmentationWorkerPool", () => {
  it("addWorker increases workerCount", () => {
    const pool = new SegmentationWorkerPool();
    expect(pool.workerCount).toBe(0);
    pool.addWorker(fakeWorker());
    expect(pool.workerCount).toBe(1);
  });

  it("runs a request and resolves with entities", async () => {
    const pool = new SegmentationWorkerPool();
    const w = fakeWorker();
    pool.addWorker(w);
    const mesh = makeRandomMesh(4);
    const resp = await pool.run({ chunkIndex: 0, mesh });
    expect(resp.chunkIndex).toBe(0);
    expect(resp.entities.length).toBeGreaterThan(0);
    expect(w.posted.length).toBe(1);
  });

  it("queues requests when all workers are busy", async () => {
    const pool = new SegmentationWorkerPool();
    pool.addWorker(fakeWorker());
    const mesh = makeRandomMesh(4);
    // Fire two requests on a one-worker pool: second must queue.
    const p1 = pool.run({ chunkIndex: 0, mesh });
    const p2 = pool.run({ chunkIndex: 1, mesh });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.chunkIndex).toBe(0);
    expect(r2.chunkIndex).toBe(1);
  });

  it("terminate clears all workers and queues", () => {
    const pool = new SegmentationWorkerPool();
    pool.addWorker(fakeWorker());
    pool.addWorker(fakeWorker());
    expect(pool.workerCount).toBe(2);
    pool.terminate();
    expect(pool.workerCount).toBe(0);
  });

  it("postMessage failure rejects the run promise", async () => {
    const pool = new SegmentationWorkerPool();
    const bad: WorkerHandle = {
      postMessage: () => {
        throw new Error("boom");
      },
      onMessage: () => undefined,
      terminate: () => undefined,
    };
    pool.addWorker(bad);
    await expect(pool.run({ chunkIndex: 0, mesh: makeRandomMesh(2) })).rejects.toThrow("boom");
  });
});

describe("runSegmentation", () => {
  it("produces timing data and triangle output", () => {
    const mesh = makeRandomMesh(6);
    const resp = runSegmentation({ chunkIndex: 0, mesh });
    expect(resp.triangles.length).toBe(6);
    expect(resp.timing.total).toBeGreaterThanOrEqual(0);
    expect(resp.regions.length).toBeGreaterThan(0);
  });
});
