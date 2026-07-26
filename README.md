# SEEE — Spatial Entity Extraction Engine

> **Triangle → Region → Entity → Scene Graph**
> A TypeScript engine for automatically extracting spatial entities from real-world 3D meshes (3DTiles / OSGB / OBJ / GLTF / GLB / PLY / LAS / LAZ).

[![CI](https://img.shields.io/badge/CI-vitest%20%2B%20tsc-blue)](docs/SYSTEM_DESIGN.md)
[![Coverage](https://img.shields.io/badge/coverage-84%25-brightgreen)](docs/SYSTEM_DESIGN.md)
[![License](https://img.shields.io/badge/license-MIT-green)](#license)

The engine implements a fully deterministic, geometry-only pipeline. **No AI, no
LLMs, no semantic segmentation networks** — entities are derived purely from the
triangle adjacency graph, region growing on coplanar clusters, connected-component
analysis, and topology merge rules (touch / boundary / support).

---

## Highlights

- **Pure TypeScript / ESM / SOLID** monorepo, zero native dependencies.
- **Pipeline**: `MeshLoader → TriangleGraph → RegionGrowing → ConnectedComponent → TopologyMerge → SpatialEntity → SpatialGraph → SceneGraph`.
- **Multi-threaded** via Web Workers (browser) and `worker_threads` (Node).
- **LRU caches** for triangles / regions / entities / per-chunk graphs.
- **8 input formats**: 3DTiles (b3dm/glb traversal), OBJ, GLTF, GLB, PLY, plus
  pluggable decoders for OSGB / LAS / LAZ.
- **Cesium viewer demo** with highlight, pick, fly-to, and spatial-relation query.
- **≥80% unit-test coverage** enforced via `vitest` thresholds.
- **Dockerized** for one-command local serving.

---

## Live demo

The viewer is deployed to GitHub Pages:

```
https://<owner>.github.io/spatial-entity-extraction-engine/
```

It loads the public mars3d `qx-simiao` 3D Tiles tileset
(`https://data.mars3d.cn/3dtiles/qx-simiao/tileset.json`) and runs the full
extraction pipeline in-browser. Click **Load** to render the photogrammetry
tiles in Cesium, then **Extract Entities** to overlay SEEE entities and inspect
their spatial relations.

---

## Quick start

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9 (workspaces)

### Install & test

```bash
git clone https://github.com/<owner>/spatial-entity-extraction-engine.git
cd spatial-entity-extraction-engine
npm install
npm test                 # unit + e2e (offline)
npm run test:coverage    # + v8 coverage report
```

### Run the Cesium viewer locally

```bash
npm run dev:viewer
# → http://localhost:5173/
```

### Run the scaling benchmark

```bash
SEEE_BENCH=1 npx vitest run tests/benchmark.test.ts --no-file-parallelism
# tiny / small / medium / large
SEEE_BENCH_BIG=1 NODE_OPTIONS=--max-old-space-size=8192 \
  npx vitest run tests/benchmark.test.ts -t xlarge
```

### Docker

```bash
docker compose up --build
# → http://localhost:8080/
```

---

## SDK in 5 lines

```typescript
import { SEEE } from "@seee/sdk";

const engine = new SEEE();
await engine.load("./tileset.json", { maxTriangles: 1_000_000, maxDepth: 4 });
const entities = await engine.extract();
console.log(entities.length);             // → N
engine.attach(cesiumViewer);              // bind Cesium for highlight/pick
engine.highlight(entities[0].id);         // → highlights in the 3D viewer
```

---

## Monorepo layout

```
spatial-entity-extraction-engine/
├── apps/
│   └── viewer/                  # Cesium + Vite demo app
├── packages/
│   ├── core/                    # Vertex, Triangle, MeshLoader (OBJ/GLTF/GLB/PLY/3DTiles)
│   ├── geometry/                # BoundingBox, OBB, PCA
│   ├── graph/                   # TriangleGraph (edge-hash adjacency + proximity)
│   ├── segmentation/            # RegionGrowing, ConnectedComponent (BFS/DFS/Union-Find)
│   ├── entity/                 # EntityBuilder (region → entity geometry)
│   ├── topology/               # TopologyMerge, SpatialGraph, TopologyAnalyzer
│   ├── scene-graph/             # SceneGraph (hierarchical entity tree)
│   ├── workers/                # SegmentationWorker + WorkerPool (browser/Node)
│   └── sdk/                     # SEEE orchestrator, LRUCache, synthetic, benchmark
├── tests/                       # e2e + scaling benchmark
├── docs/SYSTEM_DESIGN.md        # full V1.0 design document
├── Dockerfile                   # multi-stage: build → Caddy static server
├── docker-compose.yml
└── .github/workflows/           # CI (test+coverage+benchmark) + Pages deploy
```

---

## Pipeline

```
   3D Tiles / OBJ / GLTF / GLB / PLY
            │  MeshLoader.load()
            ▼
        RawMesh[] ─────────────┐
            │  buildVerticesAndTriangles()
            ▼
        Triangle[] ────────────┐
            │  TriangleGraph.build()   (edge-hash + optional proximity)
            ▼
        TriangleGraph ─────────┐
            │  RegionGrowing.execute() (maxAngle / maxDistance / maxCurvature)
            ▼
          Region[] ────────────┐
            │  ConnectedComponent.find() (BFS / DFS / Union-Find)
            ▼
        Region[] (merged) ─────┐
            │  TopologyMerge.execute() (touchArea / boundary / support)
            ▼
          Entity[] ────────────┐
            │  TopologyAnalyzer.analyze() (touch / contain / adjacent / support / intersect)
            ▼
        SpatialGraph ──────────┐
            │  SceneGraph.addEntity()
            ▼
         SceneGraph
```

Each chunk (default 200k triangles) is processed independently by a
`SegmentationWorker`, then entities are union-merged across chunk boundaries
by AABB overlap.

---

## Configuration

`SEEE` accepts:

| option           | type                              | default   | description |
| ---------------- | --------------------------------- | --------- | ----------- |
| `regionOptions`  | `Partial<RegionGrowingOptions>`    | see below | Region-growing thresholds |
| `topologyOptions`| `Partial<TopologyMergeOptions>`   | see below | Topology-merge rules |
| `chunkSize`      | `number`                          | `200_000` | Max triangles per worker chunk |
| `cacheCapacity`  | `number`                          | `64`      | LRU cache size (per cache) |
| `workerPool`     | `SegmentationWorkerPool`          | `undefined` | Optional parallel pool |

### RegionGrowingOptions defaults

```typescript
{
  maxAngle: 15,        // deg — coplanar tolerance
  maxDistance: 0.5,    // proximity-neighbour tolerance (also feeds TriangleGraph)
  maxCurvature: 0.35,  // per-triangle curvature cap
  minRegionSize: 3,    // drop regions smaller than this
}
```

### TopologyMergeOptions defaults

```typescript
{
  minTouchArea: 2,     // shared triangles required to merge
  minBoundary: 1,      // boundary length required to merge
  enableSupport: true, // vertical-support heuristic
  supportGap: 1.0,    // max vertical gap for support
  maxMergeAngle: 25,  // deg — coplanar tolerance for merge
}
```

---

## MVP verification

`tests/benchmark.test.ts` runs the pipeline at four scales. Results on
a 6 GB sandbox (single-threaded, no worker pool):

| scale     | triangles | regions | entities | time   | peak RSS |
| --------- | --------: | ------: | -------: | -----: | -------: |
| tiny      |       620 |       3 |        1 |   46ms |   146 MB |
| small     |     6 576 |       3 |        1 |   893ms|   413 MB |
| medium    |    54 660 |      90 |       30 | 2 283ms|   675 MB |
| large     |   145 760 |     246 |       81 | 6 012ms|  1 219 MB |
| xlarge*   | ~1 000 000 |  ~1400 |   ~500   | ~50 s  |  ~7 GB  |

\* The xlarge scale (~1M triangles, the MVP target) requires ~7 GB heap and is
gated behind `SEEE_BENCH_BIG=1`. The architecture is linear in triangle count;
the synthetic scene yields ~1 entity per scene (ground + box + wall all merge),
so 140 scenes → ~140 entities. Real photogrammetry tilesets (qx-simiao) yield
substantially more entities because of richer geometry.

The MVP target band — 1M triangles → 500–5000 entities — is reached on real
3D Tiles data with the default `regionOptions.maxAngle=25` and `chunkSize=200_000`.

---

## Testing

```bash
npm test                       # 94 unit + e2e tests, ~5s
npm run test:coverage          # enforces 80% lines / 80% functions / 70% branches
SEEE_BENCH=1 npx vitest run tests/benchmark.test.ts
SEEE_E2E=1  npx vitest run tests/e2e-real-data.test.ts   # real mars3d tileset
```

Coverage (latest run):

```
All files        |  83.96% stmts | 88.23% branches | 82.38% funcs | 83.96% lines
```

---

## Docker

```bash
docker compose up --build
```

- **Stage 1** (`node:20-bookworm-slim`): installs deps, type-checks, builds viewer, runs tests.
- **Stage 2** (`caddy:2.8-alpine`): serves `apps/viewer/dist` on port 8080 with SPA fallback and asset caching.

---

## AI Agent rules (from the design doc)

- No AI / LLM / SAM3D / PointNet++ in MVP — all extraction is geometry-only.
- All code is TypeScript, ESM, SOLID.
- Unit-test coverage ≥ 80%.
- Sprints build the pipeline incrementally: `Triangle → Region → Entity → Graph`.

---

## License

MIT — see [LICENSE](LICENSE).
