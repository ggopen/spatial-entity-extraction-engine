import type { Region, Triangle } from "@seee/core";

export type TraversalAlgorithm = "bfs" | "dfs" | "union-find";

/** Connected-component finder over a region adjacency graph. */
export class ConnectedComponent {
  /** Find connected components of regions.
   *
   * Two regions are connected iff they share at least one triangle-edge neighbour
   * (i.e. a triangle of region A is a neighbour of a triangle of region B).
   */
  find(regions: Region[], triangles: Triangle[], algorithm: TraversalAlgorithm = "union-find"): Region[][] {
    if (regions.length === 0) return [];
    const adj = buildRegionAdjacency(regions, triangles);
    if (algorithm === "union-find") {
      return this.unionFind(regions.length, adj, regions);
    }
    return this.search(regions.length, adj, algorithm, regions);
  }

  private search(n: number, adj: number[][], algo: TraversalAlgorithm, regions: Region[]): Region[][] {
    const visited = new Array<boolean>(n).fill(false);
    const comps: Region[][] = [];
    for (let s = 0; s < n; s++) {
      if (visited[s]) continue;
      const comp: Region[] = [];
      if (algo === "bfs") {
        const queue = [s];
        visited[s] = true;
        while (queue.length) {
          const u = queue.shift()!;
          comp.push(regions[u]);
          for (const v of adj[u]) if (!visited[v]) { visited[v] = true; queue.push(v); }
        }
      } else {
        const stack = [s];
        visited[s] = true;
        while (stack.length) {
          const u = stack.pop()!;
          comp.push(regions[u]);
          for (const v of adj[u]) if (!visited[v]) { visited[v] = true; stack.push(v); }
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  private unionFind(n: number, adj: number[][], regions: Region[]): Region[][] {
    const parent = new Array<number>(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (let u = 0; u < n; u++) {
      for (const v of adj[u]) {
        if (v > u) union(u, v);
      }
    }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      let g = groups.get(r);
      if (!g) { g = []; groups.set(r, g); }
      g.push(i);
    }
    return [...groups.values()].map((c) => c.map((i) => regions[i]));
  }
}

/** Build region-to-region adjacency from triangle neighbours. */
export function buildRegionAdjacency(regions: Region[], triangles: Triangle[]): number[][] {
  const adj: number[][] = regions.map(() => []);
  const seen = new Set<string>();
  for (const r of regions) {
    for (const tid of r.triangles) {
      const t = triangles[tid];
      for (const nbId of t.neighbors) {
        const other = triangles[nbId].regionId;
        if (other >= 0 && other !== r.id) {
          const key = r.id < other ? `${r.id}_${other}` : `${other}_${r.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          adj[r.id].push(other);
          adj[other].push(r.id);
        }
      }
    }
  }
  return adj;
}
