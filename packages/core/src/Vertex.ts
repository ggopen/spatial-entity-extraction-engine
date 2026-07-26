import type { Vertex } from "./types.js";

/** Small helper utilities around the {@link Vertex} interface. */
export const VertexUtil = {
  /** Euclidean distance between two vertices. */
  distance(a: Vertex, b: Vertex): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  },

  /** Compute the centroid of a list of vertices. */
  centroid(vertices: Vertex[]): [number, number, number] {
    if (vertices.length === 0) return [0, 0, 0];
    let x = 0;
    let y = 0;
    let z = 0;
    for (const v of vertices) {
      x += v.x;
      y += v.y;
      z += v.z;
    }
    const n = vertices.length;
    return [x / n, y / n, z / n];
  },
} as const;
