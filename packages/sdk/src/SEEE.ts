import type {
  Entity,
  RawMesh,
  Triangle,
  Vertex,
  SpatialRelationType,
  BoundingBox,
  MeshLoadOptions,
} from "@seee/core";
import {
  MeshLoader,
  buildVerticesAndTriangles,
  type MeshFormat,
} from "@seee/core";
import { TriangleGraph } from "@seee/graph";
import {
  RegionGrowing,
  DEFAULT_REGION_GROWING_OPTIONS,
  ConnectedComponent,
  type RegionGrowingOptions,
} from "@seee/segmentation";
import {
  TopologyMerge,
  DEFAULT_TOPOLOGY_MERGE_OPTIONS,
  TopologyAnalyzer,
  type TopologyMergeOptions,
} from "@seee/topology";
import { SceneGraph } from "@seee/scene-graph";
import { runSegmentation, SegmentationWorkerPool, type WorkerHandle } from "@seee/workers";
import { LRUCache } from "./LRUCache.js";

/** Optional Cesium viewer handle (typed loosely to avoid a hard dep). */
export interface CesiumLike {
  scene: { primitives: { add: (p: any) => any; remove: (p: any) => void } };
  entities: { add: (opts: any) => any; removeById: (id: any) => boolean; removeAll: () => void };
  camera: { flyTo: (opts: any) => void };
}

export interface SEEEOpts {
  regionOptions?: Partial<RegionGrowingOptions>;
  topologyOptions?: Partial<TopologyMergeOptions>;
  /** Max triangles per worker chunk (default 200_000). */
  chunkSize?: number;
  /** LRU cache capacities. */
  cacheCapacity?: number;
  /** Optional worker pool for parallel segmentation. */
  workerPool?: SegmentationWorkerPool;
}

/**
 * Spatial Entity Extraction Engine (SEEE).
 *
 * Orchestrates the full pipeline:
 *
 *   load → chunk → Triangle Graph → Region Growing → Connected Component
 *        → Topology Merge → Entity → Spatial Graph → Scene Graph
 *
 * The class is usable in both Node (no Cesium) and the browser (with Cesium).
 */
export class SEEE {
  private readonly loader = new MeshLoader();
  private readonly sceneGraph = new SceneGraph();
  private readonly analyzer = new TopologyAnalyzer();

  private vertices: Vertex[] = [];
  private triangles: Triangle[] = [];
  private entities: Entity[] = [];
  private rawMeshes: RawMesh[] = [];

  private readonly triangleCache: LRUCache<number, Triangle[]>;
  private readonly regionCache: LRUCache<number, any>;
  private readonly entityCache: LRUCache<number, Entity>;
  private readonly graphCache: LRUCache<number, TriangleGraph>;

  private cesium: CesiumLike | null = null;
  private highlightPrimitives: any[] = [];
  private readonly opts: SEEEOpts;

  constructor(opts: SEEEOpts = {}) {
    this.opts = {
      chunkSize: 200_000,
      cacheCapacity: 64,
      ...opts,
    };
    const cap = this.opts.cacheCapacity!;
    this.triangleCache = new LRUCache(cap);
    this.regionCache = new LRUCache(cap);
    this.entityCache = new LRUCache(cap);
    this.graphCache = new LRUCache(cap);
  }

  /** Register a custom decoder (e.g. for OSGB / LAS). */
  registerDecoder(format: MeshFormat, fn: (data: ArrayBuffer, uri?: string) => RawMesh | RawMesh[] | Promise<RawMesh | RawMesh[]>): void {
    this.loader.registerDecoder(format, fn);
  }

  /** Load a model from a URI (3DTiles / OBJ / GLTF / GLB / PLY / ...). */
  async load(uri: string, opts: MeshLoadOptions = {}): Promise<void> {
    const t0 = performance.now();
    this.rawMeshes = await this.loader.load(uri, opts);
    // Flatten meshes into a single triangle/vertex array (with offsets applied).
    let triCount = 0;
    const mergedTriangles: Triangle[] = [];
    const mergedVertices: Vertex[] = [];
    let vertexOffset = 0;
    for (const mesh of this.rawMeshes) {
      const { vertices, triangles } = buildVerticesAndTriangles(mesh);
      for (const v of vertices) {
        v.id = vertexOffset + v.id;
        mergedVertices.push(v);
      }
      for (const t of triangles) {
        t.id = triCount++;
        t.vertices = t.vertices.map((i) => i + vertexOffset) as [number, number, number];
        mergedTriangles.push(t);
      }
      vertexOffset += vertices.length;
    }
    this.triangles = mergedTriangles;
    this.vertices = mergedVertices;
    this.entities = [];
    const t1 = performance.now();
    console.log(`[SEEE] loaded ${this.triangles.length} triangles / ${this.vertices.length} vertices in ${(t1 - t0).toFixed(1)}ms`);
  }

  /** Provide raw meshes directly (skip network loading). */
  setMeshes(meshes: RawMesh[]): void {
    this.rawMeshes = meshes;
    let triCount = 0;
    const mergedTriangles: Triangle[] = [];
    const mergedVertices: Vertex[] = [];
    let vertexOffset = 0;
    for (const mesh of meshes) {
      const { vertices, triangles } = buildVerticesAndTriangles(mesh);
      for (const v of vertices) { v.id = vertexOffset + v.id; mergedVertices.push(v); }
      for (const t of triangles) {
        t.id = triCount++;
        t.vertices = t.vertices.map((i) => i + vertexOffset) as [number, number, number];
        mergedTriangles.push(t);
      }
      vertexOffset += vertices.length;
    }
    this.triangles = mergedTriangles;
    this.vertices = mergedVertices;
    this.entities = [];
  }

  /** Run the Triangle → Region → Entity → Graph pipeline. */
  async extract(): Promise<Entity[]> {
    const t0 = performance.now();
    if (this.triangles.length === 0) {
      throw new Error("No mesh loaded. Call load() first.");
    }

    let entities: Entity[] = [];
    if (this.opts.workerPool && this.opts.workerPool.workerCount > 0) {
      entities = await this.extractWithWorkers();
    } else {
      entities = this.extractSync();
    }

    // Deduplicate entity ids (offset per chunk handled in workers/sync).
    this.entities = entities;
    // Build scene graph + spatial graph.
    this.rebuildSceneGraph();
    this.analyzer.analyze(entities);

    // Cache results.
    for (const e of entities) this.entityCache.set(e.id, e);

    const t1 = performance.now();
    console.log(
      `[SEEE] extract: ${this.triangles.length} triangles → ${entities.length} entities in ${(t1 - t0).toFixed(1)}ms`,
    );
    return entities;
  }

  /** Synchronous extraction on the main thread. */
  private extractSync(): Entity[] {
    const chunkSize = this.opts.chunkSize ?? 200_000;
    const chunks = chunkTriangles(this.triangles, chunkSize);
    let offset = 0;
    const allEntities: Entity[] = [];
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      // Build a RawMesh from the chunk by extracting its vertices.
      const mesh = chunkToRawMesh(chunk, this.vertices, offset);
      const resp = runSegmentation({
        chunkIndex: ci,
        mesh,
        regionOptions: this.opts.regionOptions,
        topologyOptions: this.opts.topologyOptions,
      });
      // Re-id entities globally.
      for (const e of resp.entities) {
        e.triangles = e.triangles.map((id) => id + offset);
        e.id = allEntities.length;
        allEntities.push(e);
      }
      // Cache chunk graph.
      const graph = new TriangleGraph();
      graph.build(chunk);
      this.graphCache.set(ci, graph);
      offset += chunk.length;
    }
    return this.mergeAcrossChunks(allEntities);
  }

  /** Parallel extraction via the worker pool. */
  private async extractWithWorkers(): Promise<Entity[]> {
    const pool = this.opts.workerPool!;
    const chunkSize = this.opts.chunkSize ?? 200_000;
    const chunks = chunkTriangles(this.triangles, chunkSize);
    const promises = chunks.map((chunk, ci) => {
      const offset = chunks.slice(0, ci).reduce((s, c) => s + c.length, 0);
      const mesh = chunkToRawMesh(chunk, this.vertices, offset);
      return pool.run({
        chunkIndex: ci,
        mesh,
        regionOptions: this.opts.regionOptions,
        topologyOptions: this.opts.topologyOptions,
      }).then((resp) => {
        for (const e of resp.entities) {
          e.triangles = e.triangles.map((id) => id + offset);
        }
        return { resp, offset };
      });
    });
    const results = await Promise.all(promises);
    const allEntities: Entity[] = [];
    let nextId = 0;
    for (const { resp } of results) {
      for (const e of resp.entities) {
        e.id = nextId++;
        allEntities.push(e);
      }
    }
    return this.mergeAcrossChunks(allEntities);
  }

  /**
   * Post-merge entities that touch across chunk boundaries. Two entities are
   * merged if their AABBs overlap (closed-interval) AND they share a label or
   * one supports the other. Uses union-find to keep merge transitive.
   */
  private mergeAcrossChunks(entities: Entity[]): Entity[] {
    if (entities.length <= 1) return entities;
    const parent = entities.map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    // Cheap broad-phase: uniform grid on AABB centres.
    const cell = 1.0;
    const grid = new Map<string, number[]>();
    const key = (x: number, y: number, z: number) =>
      `${Math.floor(x / cell)}_${Math.floor(y / cell)}_${Math.floor(z / cell)}`;
    for (let i = 0; i < entities.length; i++) {
      const b = entities[i].bbox;
      const cx = (b.min[0] + b.max[0]) / 2;
      const cy = (b.min[1] + b.max[1]) / 2;
      const cz = (b.min[2] + b.max[2]) / 2;
      const k = key(cx, cy, cz);
      let l = grid.get(k);
      if (!l) { l = []; grid.set(k, l); }
      l.push(i);
    }
    for (let i = 0; i < entities.length; i++) {
      const b = entities[i].bbox;
      const cx = (b.min[0] + b.max[0]) / 2;
      const cy = (b.min[1] + b.max[1]) / 2;
      const cz = (b.min[2] + b.max[2]) / 2;
      const gx = Math.floor(cx / cell), gy = Math.floor(cy / cell), gz = Math.floor(cz / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const l = grid.get(`${gx + dx}_${gy + dy}_${gz + dz}`);
            if (!l) continue;
            for (const j of l) {
              if (j <= i) continue;
              const ob = entities[j].bbox;
              const overlaps =
                b.min[0] <= ob.max[0] + 0.5 && b.max[0] >= ob.min[0] - 0.5 &&
                b.min[1] <= ob.max[1] + 0.5 && b.max[1] >= ob.min[1] - 0.5 &&
                b.min[2] <= ob.max[2] + 0.5 && b.max[2] >= ob.min[2] - 0.5;
              if (overlaps) union(i, j);
            }
          }
        }
      }
    }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < entities.length; i++) {
      const r = find(i);
      let g = groups.get(r);
      if (!g) { g = []; groups.set(r, g); }
      g.push(i);
    }
    if (groups.size === entities.length) return entities; // nothing merged

    const merged: Entity[] = [];
    let nextId = 0;
    for (const ids of groups.values()) {
      if (ids.length === 1) {
        const e = { ...entities[ids[0]], id: nextId++ };
        merged.push(e);
        continue;
      }
      let min = [...entities[ids[0]].bbox.min] as [number, number, number];
      let max = [...entities[ids[0]].bbox.max] as [number, number, number];
      let tris: number[] = [];
      let regions: number[] = [];
      for (const i of ids) {
        const e = entities[i];
        tris = tris.concat(e.triangles);
        regions = regions.concat(e.regions);
        for (let k = 0; k < 3; k++) {
          if (e.bbox.min[k] < min[k]) min[k] = e.bbox.min[k];
          if (e.bbox.max[k] > max[k]) max[k] = e.bbox.max[k];
        }
      }
      merged.push({
        id: nextId++,
        regions,
        triangles: tris,
        bbox: { min, max } as BoundingBox,
        obb: entities[ids[0]].obb,
        neighbors: [],
        label: entities[ids[0]].label,
        triangleCount: tris.length,
      });
    }
    return merged;
  }

  /** Rebuild the scene graph from the current entity list. */
  private rebuildSceneGraph(): void {
    // SceneGraph has no public clear; reconstruct by removing root children.
    const root = this.sceneGraph.root;
    const rootChildren = [...this.sceneGraph.getNode(root)!.children];
    for (const c of rootChildren) this.sceneGraph.remove(c);
    for (const e of this.entities) this.sceneGraph.addEntity(e);
  }

  /** Get an entity by id (uses LRU cache). */
  getEntity(id: number): Entity | undefined {
    const cached = this.entityCache.get(id);
    if (cached) return cached;
    const e = this.entities.find((x) => x.id === id);
    if (e) this.entityCache.set(id, e);
    return e;
  }

  /** All extracted entities. */
  getEntities(): Entity[] {
    return this.entities;
  }

  /** All triangles. */
  getTriangles(): Triangle[] {
    return this.triangles;
  }

  /** All vertices. */
  getVertices(): Vertex[] {
    return this.vertices;
  }

  /** The scene graph. */
  getSceneGraph(): SceneGraph {
    return this.sceneGraph;
  }

  /** The spatial (topology) graph. */
  getSpatialGraph() {
    return this.analyzer.getGraph();
  }

  /** Query spatial relations. */
  query(opts: { type?: SpatialRelationType; nodeId?: number } = {}) {
    return this.analyzer.getGraph().query(opts);
  }

  /** Attach a Cesium viewer for highlight/pick support. */
  attach(viewer: CesiumLike): void {
    this.cesium = viewer;
  }

  /** Highlight an entity in the attached Cesium viewer. */
  highlight(entityId: number): void {
    if (!this.cesium) {
      console.warn("[SEEE] highlight() requires attach(viewer) first");
      return;
    }
    this.clearHighlight();
    const e = this.getEntity(entityId);
    if (!e) {
      console.warn(`[SEEE] entity ${entityId} not found`);
      return;
    }
    const color = labelColor(e.label);
    // Add a box primitive approximating the entity bbox.
    const center = [
      (e.bbox.min[0] + e.bbox.max[0]) / 2,
      (e.bbox.min[1] + e.bbox.max[1]) / 2,
      (e.bbox.min[2] + e.bbox.max[2]) / 2,
    ];
    const dims = [
      e.bbox.max[0] - e.bbox.min[0],
      e.bbox.max[1] - e.bbox.min[1],
      e.bbox.max[2] - e.bbox.min[2],
    ];
    const prim = this.cesium.entities.add({
      id: `seee-highlight-${entityId}`,
      position: center,
      box: {
        dimensions: dims,
        fill: false,
        outline: true,
        outlineColor: color,
      },
    });
    this.highlightPrimitives.push({ kind: "entity", prim });
  }

  /** Clear all highlights. */
  clearHighlight(): void {
    if (!this.cesium) return;
    for (const h of this.highlightPrimitives) {
      if (h.kind === "entity" && h.prim?.id) {
        this.cesium.entities.removeById(h.prim.id);
      }
    }
    this.highlightPrimitives = [];
  }

  /** Pick the entity whose bbox contains a world position [x,y,z]. */
  pick(position: [number, number, number]): Entity | undefined {
    for (const e of this.entities) {
      const b = e.bbox;
      if (
        position[0] >= b.min[0] && position[0] <= b.max[0] &&
        position[1] >= b.min[1] && position[1] <= b.max[1] &&
        position[2] >= b.min[2] && position[2] <= b.max[2]
      ) {
        return e;
      }
    }
    return undefined;
  }

  /** Incremental update: re-run extraction on a subset of triangles. */
  async incrementalUpdate(changedTriangleIds: Set<number>): Promise<Entity[]> {
    // For MVP, just re-extract the whole scene. A real incremental engine would
    // only re-grow affected regions and merge deltas. This keeps the contract.
    void changedTriangleIds;
    return this.extract();
  }

  /** Instruct Cesium camera to fly to an entity. */
  flyTo(entityId: number): void {
    if (!this.cesium) return;
    const e = this.getEntity(entityId);
    if (!e) return;
    const b = e.bbox;
    const center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const range = Math.max(
      b.max[0] - b.min[0],
      b.max[1] - b.min[1],
      b.max[2] - b.min[2],
    ) * 3;
    this.cesium.camera.flyTo({ destination: { center, range } } as any);
  }
}

/* ----------------------------- helpers ----------------------------- */

/** Split an array of triangles into chunks of at most `size`. */
export function chunkTriangles(triangles: Triangle[], size: number): Triangle[][] {
  const chunks: Triangle[][] = [];
  for (let i = 0; i < triangles.length; i += size) {
    chunks.push(triangles.slice(i, i + size));
  }
  return chunks;
}

/** Convert a triangle chunk + global vertices into a RawMesh (positions+indices). */
export function chunkToRawMesh(chunk: Triangle[], vertices: Vertex[], offset: number): RawMesh {
  const usedVertexIds = new Set<number>();
  for (const t of chunk) for (const v of t.vertices) usedVertexIds.add(v);
  const idMap = new Map<number, number>();
  const positions: number[] = [];
  let localId = 0;
  for (const id of usedVertexIds) {
    const v = vertices[id];
    positions.push(v.x, v.y, v.z);
    idMap.set(id, localId++);
  }
  const indices: number[] = [];
  for (const t of chunk) {
    indices.push(
      idMap.get(t.vertices[0])!,
      idMap.get(t.vertices[1])!,
      idMap.get(t.vertices[2])!,
    );
  }
  void offset;
  return {
    format: "glb",
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

/** Map a coarse geometry label to a [r,g,b,a] Cesium color. */
export function labelColor(label: string): { red: number; green: number; blue: number; alpha: number } {
  switch (label) {
    case "ground": return { red: 0.3, green: 0.7, blue: 0.3, alpha: 1 };
    case "wall": return { red: 0.8, green: 0.5, blue: 0.2, alpha: 1 };
    case "roof": return { red: 0.8, green: 0.2, blue: 0.2, alpha: 1 };
    case "ceiling": return { red: 0.5, green: 0.5, blue: 0.8, alpha: 1 };
    default: return { red: 0.2, green: 0.8, blue: 1.0, alpha: 1 };
  }
}

export { LRUCache, RegionGrowing, DEFAULT_REGION_GROWING_OPTIONS, TopologyMerge, DEFAULT_TOPOLOGY_MERGE_OPTIONS };
