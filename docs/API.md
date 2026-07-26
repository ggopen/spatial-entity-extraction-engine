# SEEE API reference

Public TypeScript API for `@seee/sdk` and the underlying packages.

> All examples assume `import { SEEE } from "@seee/sdk";`

---

## `class SEEE`

Top-level orchestrator. Reentrant per-instance — create a new `SEEE()` for each
scene you want to process.

### constructor

```typescript
new SEEE(opts?: SEEEOpts)
```

`SEEEOpts`:

| field             | type                                  | default     | description |
| ----------------- | ------------------------------------- | ----------- | ----------- |
| `regionOptions`   | `Partial<RegionGrowingOptions>`        | see §Region | Region-growing thresholds |
| `topologyOptions` | `Partial<TopologyMergeOptions>`       | see §Topology | Topology-merge rules |
| `chunkSize`       | `number`                              | `200_000`   | Max triangles per worker chunk |
| `cacheCapacity`   | `number`                              | `64`        | LRU capacity (per cache: triangles / regions / entities / graphs) |
| `workerPool`      | `SegmentationWorkerPool`              | `undefined` | Optional worker pool for parallel chunk processing |

---

### Pipeline methods

#### `load(uri, opts?): Promise<void>`

Fetch + decode a mesh from a URI. Supports:

- `*.json` ending in `tileset.json` → 3DTiles (recursive tile-tree walk)
- `*.b3dm` → b3dm (GLB header stripped, then GLB decoder)
- `*.glb`, `*.gltf` → GLB / GLTF
- `*.obj` → OBJ (text, fan-triangulated)
- `*.ply` → PLY (ascii + little-endian binary)

OSGB / LAS / LAZ require a custom decoder registered via `engine.registerDecoder(format, fn)`.

`MeshLoadOptions`:

| field        | type                                                          | default     | description |
| ------------ | ------------------------------------------------------------- | ----------- | ----------- |
| `maxTiles`   | `number`                                                      | `Infinity`  | Stop after this many tile contents |
| `maxTriangles` | `number`                                                    | `Infinity`  | Stop once this many triangles have been ingested |
| `maxDepth`   | `number`                                                     | `Infinity`  | Stop traversing tile tree past this depth |
| `onProgress` | `(info: { tilesLoaded, depth, geometricError }) => void`     | `undefined` | Called after each tile is decoded |

#### `setMeshes(meshes: RawMesh[]): void`

Skip the network — pass decoded meshes directly (used by tests & benchmarks).

#### `extract(): Promise<Entity[]>`

Run the full Triangle → Region → Entity → Graph pipeline. Idempotent for the
same loaded meshes; re-running rebuilds the scene & spatial graphs.

---

### Query methods

#### `getEntities(): Entity[]`
All extracted entities (post-merge).

#### `getEntity(id): Entity | undefined`
Entity by id (uses LRU cache).

#### `getTriangles(): Triangle[]`
All ingested triangles.

#### `getVertices(): Vertex[]`
All ingested vertices.

#### `getSceneGraph(): SceneGraph`
The hierarchical scene graph.

#### `getSpatialGraph(): SpatialGraph`
The topology (touch / contain / adjacent / support / intersect) graph.

#### `query(opts?): SpatialEdge[]`
```typescript
engine.query({ type: "support" });      // all support edges
engine.query({ nodeId: 12 });           // all edges involving entity 12
engine.query({ type: "touch", nodeId: 7 }); // touch-edges involving entity 7
```

---

### Cesium integration

#### `attach(viewer: CesiumLike): void`
Bind a Cesium `Viewer` for highlight/pick/flyTo support.

#### `highlight(entityId: number): void`
Add a 3D box primitive at the entity's bbox in the attached viewer.

#### `clearHighlight(): void`
Remove all highlight primitives.

#### `pick(position: [number, number, number]): Entity | undefined`
Brute-force bbox pick — returns the entity whose AABB contains `position`.

#### `flyTo(entityId: number): void`
Animate the Cesium camera to the entity's bbox center.

#### `incrementalUpdate(changedTriangleIds: Set<number>): Promise<Entity[]>`
Re-extract the full scene (MVP contract — finer-grained incremental update is
a future-work item).

---

## Core types

### `Vertex`
```typescript
interface Vertex { id: number; x: number; y: number; z: number; }
```

### `Triangle`
```typescript
interface Triangle {
  id: number;
  vertices: [number, number, number];
  normal: [number, number, number];
  centroid: [number, number, number];
  bbox: BoundingBox;
  neighbors: number[];
  regionId: number;      // -1 = unassigned
  area: number;
}
```

### `Region`
```typescript
interface Region {
  id: number;
  triangles: number[];
  boundary: number[];     // triangle ids touching another region
  normal: [number, number, number];
  centroid: [number, number, number];
  area: number;
}
```

### `Entity`
```typescript
interface Entity {
  id: number;
  regions: number[];      // region ids that compose this entity
  triangles: number[];    // triangle ids belonging to the entity
  bbox: BoundingBox;
  obb: OBB;
  neighbors: number[];    // neighbouring entity ids
  label: string;          // "wall" | "ground" | "roof" | "ceiling" | "object"
  triangleCount: number;
}
```

### `BoundingBox`, `OBB`
```typescript
interface BoundingBox { min: [number, number, number]; max: [number, number, number]; }
interface OBB {
  center: [number, number, number];
  axes: [[number,number,number], [number,number,number], [number,number,number]];
  halfExtents: [number, number, number];
}
```

### `SpatialEdge`
```typescript
type SpatialRelationType = "touch" | "contain" | "adjacent" | "support" | "intersect";
interface SpatialEdge {
  from: number; to: number;
  type: SpatialRelationType;
  weight: number;
}
```

---

## Pipeline components

Each pipeline stage is exported as a standalone class so it can be unit-tested
or composed independently.

### `TriangleGraph` (`@seee/graph`)

```typescript
class TriangleGraph {
  constructor(triangles?: Triangle[]);
  build(triangles: Triangle[]): void;          // edge-hash adjacency build, O(n)
  addEdge(a: number, b: number): void;          // manual neighbour addition
  addProximityNeighbours(tolerance: number): number;  // spatial-hash proximity
  hasEdge(a: number, b: number): boolean;       // O(1)
  getNeighbors(id: number): Triangle[];
  getNeighborIds(id: number): number[];
  degree(id: number): number;
  size(): number;
  iterTriangles(): Iterable<Triangle>;
}
```

### `RegionGrowing` (`@seee/segmentation`)

```typescript
class RegionGrowing {
  constructor(opts?: RegionGrowingOptions);
  execute(graph: TriangleGraph): Region[];
}
```

`RegionGrowingOptions`:

| field          | type   | default | description |
| -------------- | ------ | ------- | ----------- |
| `maxAngle`     | number | 15      | Max angle (deg) between adjacent triangle normals for region growth |
| `maxDistance`  | number | 0.5     | Centroid distance for proximity neighbours (also feeds TriangleGraph) |
| `maxCurvature` | number | 0.35    | Per-triangle curvature cap |
| `minRegionSize` | number | 3       | Regions smaller than this are merged into neighbours |

### `ConnectedComponent` (`@seee/segmentation`)

```typescript
class ConnectedComponent {
  find(regions: Region[], triangles: Triangle[], algorithm?: "bfs" | "dfs" | "union-find"): Region[][];
}
```
Returns an array of connected-components, each a list of region ids.

### `TopologyMerge` (`@seee/topology`)

```typescript
class TopologyMerge {
  constructor(opts?: TopologyMergeOptions);
  execute(regions: Region[], triangles: Triangle[]): Entity[];
}
```

`TopologyMergeOptions`:

| field           | type    | default | description |
| --------------- | ------- | ------- | ----------- |
| `minTouchArea`  | number  | 2       | Min shared triangle count for two regions to merge |
| `minBoundary`   | number  | 1       | Min shared boundary length for merge |
| `enableSupport` | boolean | true    | Enable vertical-support heuristic |
| `supportGap`    | number  | 1.0     | Max vertical gap for support relationship |
| `maxMergeAngle` | number  | 25      | Max angle (deg) between region normals for merge |

### `SpatialGraph` (`@seee/topology`)

```typescript
class SpatialGraph {
  addNode(id: number): void;
  addEdge(from: number, to: number, type: SpatialRelationType, weight?: number): void;
  query(opts?: { type?: SpatialRelationType; nodeId?: number }): SpatialEdge[];
}
```

### `TopologyAnalyzer` (`@seee/topology`)

```typescript
class TopologyAnalyzer {
  analyze(entities: Entity[]): void;     // populates the internal SpatialGraph
  getGraph(): SpatialGraph;
  supporters(entityId: number): number[]; // entities directly below
  supported(entityId: number): number[];  // entities directly above
  contained(entityId: number): number[];  // entities contained within
}
```

### `SceneGraph` (`@seee/scene-graph`)

```typescript
interface SceneNode {
  id: number;
  entityId: number;
  children: number[];
  parent?: number;
}

class SceneGraph {
  readonly root: number;
  addEntity(entity: Entity): number;       // adds a node under root, returns node id
  getNode(id: number): SceneNode | undefined;
  remove(id: number): void;
  query(predicate: (n: SceneNode) => boolean): SceneNode[];
  size(): number;
}
```

### `SegmentationWorkerPool` (`@seee/workers`)

```typescript
interface WorkerHandle {
  postMessage(msg: SegmentationWorkerRequest): void;
  onMessage(cb: (msg: SegmentationWorkerResponse) => void): void;
  terminate(): void;
}

class SegmentationWorkerPool {
  addWorker(w: WorkerHandle): void;
  run(req: SegmentationWorkerRequest): Promise<SegmentationWorkerResponse>;
  get workerCount(): number;
  terminate(): void;
}
```

In Node, use `worker_threads` directly; in the browser, wrap a `Worker` with
the `WorkerHandle` adapter.

---

## Caching

`LRUCache<K, V>` (`@seee/sdk`) — simple O(1) doubly-linked-list + Map LRU.
The `SEEE` instance maintains four caches:

- `triangleCache` — keyed by chunk index → triangles
- `regionCache` — keyed by chunk index → regions
- `entityCache` — keyed by entity id → Entity
- `graphCache` — keyed by chunk index → TriangleGraph

Default capacity is 64 entries per cache (override with `cacheCapacity`).

---

## Error handling

- `load()` throws on HTTP errors, malformed JSON, or unknown formats.
- `extract()` throws if no mesh has been loaded.
- Per-tile failures inside `load3DTiles` are silently skipped so a single
  broken tile doesn't abort the whole scene load.
- The `registerDecoder` mechanism allows extending formats without modifying
  the core loader.
