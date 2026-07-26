import type { Triangle, Region, Entity, RawMesh } from "@seee/core";
import { buildVerticesAndTriangles } from "@seee/core";
import { TriangleGraph } from "@seee/graph";
import {
  RegionGrowing,
  DEFAULT_REGION_GROWING_OPTIONS,
  ConnectedComponent,
} from "@seee/segmentation";
import {
  TopologyMerge,
  DEFAULT_TOPOLOGY_MERGE_OPTIONS,
} from "@seee/topology";
import type { RegionGrowingOptions } from "@seee/segmentation";
import type { TopologyMergeOptions as TMOptions } from "@seee/topology";

/** Request sent to a segmentation worker. */
export interface SegmentationWorkerRequest {
  chunkIndex: number;
  mesh: RawMesh;
  regionOptions?: Partial<RegionGrowingOptions>;
  topologyOptions?: Partial<TMOptions>;
}

/** Response from a segmentation worker. */
export interface SegmentationWorkerResponse {
  chunkIndex: number;
  triangles: Triangle[];
  regions: Region[];
  entities: Entity[];
  timing: { graph: number; region: number; topology: number; total: number };
}

/**
 * Pure-function worker: runs the full Triangle → Region → Entity pipeline on
 * a single mesh chunk. Usable both from a Web Worker (browser) and from
 * `worker_threads` (Node) — the host posts a {@link SegmentationWorkerRequest}
 * and receives a {@link SegmentationWorkerResponse}.
 */
export function runSegmentation(req: SegmentationWorkerRequest): SegmentationWorkerResponse {
  const t0 = performance.now();
  const { triangles } = buildVerticesAndTriangles(req.mesh);

  const tGraph = performance.now();
  const graph = new TriangleGraph();
  graph.build(triangles);
  graph.addProximityNeighbours(req.regionOptions?.maxDistance ?? DEFAULT_REGION_GROWING_OPTIONS.maxDistance);

  const tRegion = performance.now();
  const regionOpts = { ...DEFAULT_REGION_GROWING_OPTIONS, ...req.regionOptions };
  const regions = new RegionGrowing(regionOpts).execute(graph);

  const tTopo = performance.now();
  const topoOpts = { ...DEFAULT_TOPOLOGY_MERGE_OPTIONS, ...req.topologyOptions };
  // Connected-component pass: combine coplanar adjacent regions first.
  const cc = new ConnectedComponent().find(regions, triangles, "union-find");
  const mergedRegions: Region[] = [];
  for (const group of cc) {
    if (group.length === 1) {
      const newId = mergedRegions.length;
      const r = { ...group[0], id: newId };
      mergedRegions.push(r);
      // Keep triangle.regionId consistent with the new sequential id so that
      // buildTouchCounts / buildRegionAdjacency read correct ids.
      for (const tid of r.triangles) triangles[tid].regionId = newId;
      continue;
    }
    const triIds: number[] = [];
    let area = 0;
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    const boundary = new Set<number>();
    const memberSet = new Set<number>();
    for (const r of group) for (const t of r.triangles) memberSet.add(t);
    for (const r of group) {
      for (const tid of r.triangles) {
        triIds.push(tid);
        const t = triangles[tid];
        area += t.area;
        nx += t.normal[0]; ny += t.normal[1]; nz += t.normal[2];
        cx += t.centroid[0]; cy += t.centroid[1]; cz += t.centroid[2];
        for (const nb of t.neighbors) if (!memberSet.has(nb)) boundary.add(tid);
      }
    }
    const n = triIds.length;
    const normal: [number, number, number] = [nx / n, ny / n, nz / n];
    const len = Math.hypot(normal[0], normal[1], normal[2]);
    if (len > 1e-12) { normal[0] /= len; normal[1] /= len; normal[2] /= len; }
    const newId = mergedRegions.length;
    mergedRegions.push({
      id: newId,
      triangles: triIds,
      boundary: [...boundary],
      normal,
      centroid: [cx / n, cy / n, cz / n],
      area,
    });
    for (const tid of triIds) triangles[tid].regionId = newId;
  }
  const entities = new TopologyMerge(topoOpts).execute(mergedRegions, triangles);
  const tEnd = performance.now();

  return {
    chunkIndex: req.chunkIndex,
    triangles,
    regions: mergedRegions,
    entities,
    timing: {
      graph: tRegion - tGraph,
      region: tTopo - tRegion,
      topology: tEnd - tTopo,
      total: tEnd - t0,
    },
  };
}

/**
 * Adapter interface the worker pool talks to. `postMessage` sends a request,
 * `onMessage` registers a single permanent callback for responses, `terminate`
 * disposes the worker.
 */
export interface WorkerHandle {
  postMessage: (msg: SegmentationWorkerRequest) => void;
  onMessage: (cb: (msg: SegmentationWorkerResponse) => void) => void;
  terminate: () => void;
}

/**
 * Minimal worker pool. Each worker processes one request at a time; the pool
 * dispatches queued requests to idle workers and resolves the corresponding
 * promises when responses arrive.
 */
export class SegmentationWorkerPool {
  private readonly handles: WorkerHandle[] = [];
  /** Pending resolver for the request currently being processed by worker i. */
  private readonly pending: ((r: SegmentationWorkerResponse) => void)[] = [];
  private readonly idle: number[] = [];
  private readonly queue: { req: SegmentationWorkerRequest; resolve: (r: SegmentationWorkerResponse) => void; reject: (e: any) => void }[] = [];

  addWorker(w: WorkerHandle): void {
    const idx = this.handles.length;
    this.handles.push(w);
    this.pending.push(() => undefined);
    this.idle.push(idx);
    w.onMessage((msg) => {
      const resolve = this.pending[idx];
      this.pending[idx] = () => undefined;
      this.idle.push(idx);
      if (resolve) resolve(msg);
      this.pump();
    });
  }

  run(req: SegmentationWorkerRequest): Promise<SegmentationWorkerResponse> {
    return new Promise((resolve, reject) => {
      this.queue.push({ req, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const wIdx = this.idle.shift()!;
      const item = this.queue.shift()!;
      this.pending[wIdx] = item.resolve;
      try {
        this.handles[wIdx].postMessage(item.req);
      } catch (e) {
        this.pending[wIdx] = () => undefined;
        this.idle.push(wIdx);
        item.reject(e);
      }
    }
  }

  terminate(): void {
    for (const w of this.handles) w.terminate();
    this.handles.length = 0;
    this.pending.length = 0;
    this.idle.length = 0;
    this.queue.length = 0;
  }

  /** Number of registered workers. */
  get workerCount(): number {
    return this.handles.length;
  }
}
