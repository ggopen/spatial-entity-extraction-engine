import type { Triangle } from "@seee/core";

/**
 * Triangle adjacency graph.
 *
 * Two triangles are neighbours iff they share an edge (two common vertices).
 * The graph is built by hashing each directed edge of every triangle into a
 * `Map<edgeKey, triangleId[]>` — an O(n) construction that keeps memory low.
 *
 * Optionally, an approximate neighbour relation can be added when triangles
 * are close in space (useful for non-watertight scans). This is governed by
 * `proximityTolerance` — when 0 (default) only true edge neighbours are used.
 */
export class TriangleGraph {
  /** Indexed triangle array. */
  readonly triangles: Triangle[];
  /** `adjacency[i]` is the list of neighbour triangle ids of triangle `i`. */
  private readonly adjacency: number[][];
  /** `adjSet[i]` mirrors `adjacency[i]` as a Set for O(1) `hasEdge` lookups. */
  private readonly adjSet: Set<number>[];

  constructor(triangles: Triangle[] = []) {
    this.triangles = triangles;
    this.adjacency = new Array(triangles.length);
    this.adjSet = new Array(triangles.length);
    for (let i = 0; i < triangles.length; i++) {
      this.adjacency[i] = [];
      this.adjSet[i] = new Set();
    }
  }

  /**
   * Build neighbour lists in place. The supplied triangles' `neighbors` arrays
   * are populated; this object's own adjacency list is also synced.
   */
  build(triangles: Triangle[]): void {
    this.triangles.length = 0;
    this.adjacency.length = 0;
    this.adjSet.length = 0;
    for (const t of triangles) {
      this.triangles.push(t);
      this.adjacency.push([]);
      this.adjSet.push(new Set());
      t.neighbors = [];
    }

    // edgeKey = sorted (min,max) vertex id pair encoded as a string.
    const edgeMap = new Map<string, number[]>();
    for (let i = 0; i < triangles.length; i++) {
      const v = triangles[i].vertices;
      const edges: [number, number][] = [
        [v[0], v[1]],
        [v[1], v[2]],
        [v[2], v[0]],
      ];
      for (const [a, b] of edges) {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        let list = edgeMap.get(key);
        if (!list) { list = []; edgeMap.set(key, list); }
        list.push(i);
      }
    }

    for (const list of edgeMap.values()) {
      if (list.length < 2) continue;
      // Every pair of triangles sharing this edge become neighbours.
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          this.addEdge(list[i], list[j]);
        }
      }
    }
  }

  /** Add a one-directional neighbour relationship (caller ensures uniqueness). */
  addEdge(a: number, b: number): void {
    const la = this.adjacency[a] ?? (this.adjacency[a] = []);
    const lb = this.adjacency[b] ?? (this.adjacency[b] = []);
    const sa = this.adjSet[a] ?? (this.adjSet[a] = new Set());
    const sb = this.adjSet[b] ?? (this.adjSet[b] = new Set());
    if (!sa.has(b)) {
      la.push(b);
      sa.add(b);
      this.triangles[a].neighbors.push(b);
    }
    if (!sb.has(a)) {
      lb.push(a);
      sb.add(a);
      this.triangles[b].neighbors.push(a);
    }
  }

  /** Get neighbour triangle ids of a given triangle. */
  getNeighborIds(id: number): number[] {
    return this.adjacency[id] ?? [];
  }

  /** Get neighbour Triangle objects of a given triangle. */
  getNeighbors(id: number): Triangle[] {
    return (this.adjacency[id] ?? []).map((n) => this.triangles[n]);
  }

  /** Degree (# of neighbours) of a triangle. */
  degree(id: number): number {
    return (this.adjacency[id] ?? []).length;
  }

  /** Number of triangles in the graph. */
  size(): number {
    return this.triangles.length;
  }

  /** Iterate over all triangles. */
  *iterTriangles(): Iterable<Triangle> {
    for (const t of this.triangles) yield t;
  }

  /**
   * Add proximity-based neighbour edges for triangles whose centroids are
   * within `tolerance`. Used for non-watertight meshes (real-world scans)
   * where edge-sharing alone yields isolated triangles.
   *
   * Uses a uniform grid for O(n) expected time.
   */
  addProximityNeighbours(tolerance: number): number {
    if (tolerance <= 0 || this.triangles.length === 0) return 0;
    const grid = new Map<string, number[]>();
    const cell = tolerance;
    const key = (x: number, y: number, z: number) =>
      `${Math.floor(x / cell)}_${Math.floor(y / cell)}_${Math.floor(z / cell)}`;

    const idx = (cx: number, cy: number, cz: number) => {
      const k = key(cx, cy, cz);
      let l = grid.get(k);
      if (!l) { l = []; grid.set(k, l); }
      return l;
    };

    for (let i = 0; i < this.triangles.length; i++) {
      const c = this.triangles[i].centroid;
      idx(c[0], c[1], c[2]).push(i);
    }

    let added = 0;
    for (let i = 0; i < this.triangles.length; i++) {
      const c = this.triangles[i].centroid;
      const gx = Math.floor(c[0] / cell);
      const gy = Math.floor(c[1] / cell);
      const gz = Math.floor(c[2] / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const list = grid.get(`${gx + dx}_${gy + dy}_${gz + dz}`);
            if (!list) continue;
            for (const j of list) {
              if (j <= i) continue;
              if (this.hasEdge(i, j)) continue;
              const oc = this.triangles[j].centroid;
              const dist = Math.hypot(c[0] - oc[0], c[1] - oc[1], c[2] - oc[2]);
              if (dist <= tolerance) {
                this.addEdge(i, j);
                added++;
              }
            }
          }
        }
      }
    }
    return added;
  }

  /** Does an edge exist between a and b? O(1) via Set lookup. */
  hasEdge(a: number, b: number): boolean {
    return (this.adjSet[a] ?? new Set<number>()).has(b);
  }
}
