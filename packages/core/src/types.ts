/**
 * Core type definitions for SEEE.
 * All other packages depend on these shared interfaces.
 */

/** A 3D vertex. `id` is the index into the vertex array. */
export interface Vertex {
  id: number;
  x: number;
  y: number;
  z: number;
}

/** A triangle formed by 3 vertex ids. Carries adjacency + segmentation state. */
export interface Triangle {
  id: number;
  /** The 3 vertex ids forming the triangle (CCW). */
  vertices: [number, number, number];
  /** Unit face normal [nx, ny, nz]. */
  normal: [number, number, number];
  /** Centroid [cx, cy, cz]. */
  centroid: [number, number, number];
  /** Per-triangle axis-aligned bounding box (envelope of its 3 vertices). */
  bbox: BoundingBox;
  /** Ids of adjacent triangles (share an edge). */
  neighbors: number[];
  /** Region id assigned by RegionGrowing (-1 = unassigned). */
  regionId: number;
  /** Optional surface area. */
  area: number;
}

/** A region grown from a seed triangle. */
export interface Region {
  id: number;
  triangles: number[];
  /** Boundary triangle ids (triangles touching another region). */
  boundary: number[];
  /** Aggregated normal / dominant plane. */
  normal: [number, number, number];
  /** Region centroid. */
  centroid: [number, number, number];
  /** Total surface area. */
  area: number;
}

/** Axis-aligned bounding box. */
export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** Oriented bounding box (center + 3 orthonormal axes + half extents). */
export interface OBB {
  center: [number, number, number];
  axes: [[number, number, number], [number, number, number], [number, number, number]];
  halfExtents: [number, number, number];
}

/** An extracted spatial entity: a topologically consistent cluster of regions. */
export interface Entity {
  id: number;
  /** Region ids that compose this entity. */
  regions: number[];
  /** Triangle ids belonging to the entity. */
  triangles: number[];
  bbox: BoundingBox;
  obb: OBB;
  /** Neighbouring entity ids. */
  neighbors: number[];
  /** Semantic-ish label inferred from geometry (e.g. "wall", "ground"). */
  label: string;
  /** Triangle count. */
  triangleCount: number;
}

/** Supported input mesh formats. */
export type MeshFormat =
  | "3dtiles"
  | "osgb"
  | "obj"
  | "gltf"
  | "glb"
  | "ply"
  | "las"
  | "laz";

/** A raw decoded mesh. */
export interface RawMesh {
  format: MeshFormat;
  /** Flat positions [x,y,z, x,y,z, ...]. */
  positions: Float32Array;
  /** Flat indices [v0,v1,v2, ...]. Optional; if absent, treat as point cloud. */
  indices?: Uint32Array;
  /** Optional transform applied to the model (e.g. tile transform). */
  transform?: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
}

/** Options controlling mesh loading (mostly for 3DTiles tileset traversal). */
export interface MeshLoadOptions {
  /** Max number of tile contents to download (default: unlimited). */
  maxTiles?: number;
  /** Max triangle budget (approximate, default: unlimited). */
  maxTriangles?: number;
  /** Max tile-tree depth to traverse (default: unlimited). */
  maxDepth?: number;
  /** Progress callback invoked after each tile is decoded. */
  onProgress?: (info: { tilesLoaded: number; depth: number; geometricError: number }) => void;
}

/** Spatial-graph edge kinds. */
export type SpatialRelationType =
  | "touch"
  | "contain"
  | "adjacent"
  | "support"
  | "intersect";

/** A typed edge in the spatial graph. */
export interface SpatialEdge {
  from: number;
  to: number;
  type: SpatialRelationType;
  weight: number;
}
