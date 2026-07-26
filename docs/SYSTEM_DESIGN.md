# Spatial Entity Extraction Engine (SEEE) — System Design v1.0

## 1. Goal

Build an engine that automatically extracts **Spatial Entities** from real-world
3D meshes (3DTiles, OSGB, OBJ, GLTF, PLY, LAS, LAZ).

```
Input  ──► 3DTiles / OSGB / OBJ / GLTF / PLY / LAS / LAZ
Output ──► Scene
            ├── Entity-00001
            ├── Entity-00002
            └── Entity-N
```

MVP: 1,000,000 triangles ──► 500~5000 entities.

Requirements: spatial continuity, topological consistency, incremental update,
multi-threaded, visualizable.

## 2. Tech Stack

- Core: TypeScript (ESM)
- Visualization: Cesium + Three.js
- Geometry: three-mesh-bvh
- Backend: Node.js
- Performance: Worker Threads
- Optional: Rust / WASM

## 3. Pipeline

```
Mesh Loader → Triangle Graph → Region Growing → Connected Component
          → Topology Merge → Spatial Entity → Spatial Graph → Scene Graph
```

## 4. Monorepo Layout

```
spatial-entity-extraction-engine
├── apps/viewer                 (Cesium demo)
├── packages/
│   ├── core        Vertex, Triangle, MeshLoader
│   ├── geometry    BoundingBox, OBB, PCA
│   ├── graph       TriangleGraph
│   ├── segmentation RegionGrowing, ConnectedComponent
│   ├── entity      Entity, EntityBuilder
│   ├── topology    TopologyAnalyzer, TopologyMerge, SpatialGraph
│   ├── scene-graph SceneGraph
│   ├── workers     SegmentationWorker
│   └── sdk         SEEE (orchestrator)
├── docs
└── tests
```

## 5. Core Data Structures

See `packages/core/src/types.ts`. Triangle carries `neighbors[]` and an
optional `regionId`. Region aggregates `triangles[]` + `boundary[]`. Entity
aggregates `regions[]` + `bbox` + `obb` + `neighbors[]`.

## 6. Sprint Plan

| Sprint | Deliverable                                  |
|--------|----------------------------------------------|
| 1      | Mesh Loader, Vertex, Triangle               |
| 2      | Triangle Graph + Neighbor query             |
| 3      | Region Growing                              |
| 4      | Connected Component (BFS/DFS/Union-Find)    |
| 5      | Topology Merge                              |
| 6      | Spatial Entity                              |
| 7      | Scene Graph                                 |
| 8      | Cesium Viewer + Workers                     |

## 7. Constraints for AI Agents

1. No direct AI / ML models.
2. MVP forbids GPT / SAM3D / PointNet++.
3. All extraction must be based on Triangle Graph + Region Growing + Topology Merge.
4. All code: TypeScript, ESM, SOLID.
5. Unit-test coverage > 80%.

## 8. Final Goal

```
3D Tiles → 100M Triangle → 50000 Region → 5000 Entity → Scene Graph
```
