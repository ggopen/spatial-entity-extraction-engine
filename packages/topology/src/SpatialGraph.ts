import type { Entity, SpatialEdge, SpatialRelationType } from "@seee/core";
import { bboxIntersects } from "@seee/geometry";

/**
 * Typed spatial-relation graph over entities.
 *
 * Supports edge kinds: touch, contain, adjacent, support, intersect.
 * `touch` edges are derived from neighbour regions; the rest are computed
 * lazily on `query()` from entity bboxes.
 */
export class SpatialGraph {
  private readonly nodes = new Map<number, Entity>();
  private readonly edges: SpatialEdge[] = [];
  private readonly byType = new Map<SpatialRelationType, SpatialEdge[]>();
  private readonly adjacency = new Map<number, Set<number>>();

  addNode(entity: Entity): void {
    this.nodes.set(entity.id, entity);
    if (!this.adjacency.has(entity.id)) this.adjacency.set(entity.id, new Set());
  }

  addEdge(from: number, to: number, type: SpatialRelationType, weight = 1): void {
    const edge: SpatialEdge = { from, to, type, weight };
    this.edges.push(edge);
    let list = this.byType.get(type);
    if (!list) { list = []; this.byType.set(type, list); }
    list.push(edge);
    const a = this.adjacency.get(from) ?? new Set<number>();
    a.add(to); this.adjacency.set(from, a);
    const b = this.adjacency.get(to) ?? new Set<number>();
    b.add(from); this.adjacency.set(to, b);
  }

  /** Compute all relations between entities (touch + spatial). */
  buildFromEntities(entities: Entity[]): void {
    this.nodes.clear();
    this.edges.length = 0;
    this.byType.clear();
    this.adjacency.clear();
    for (const e of entities) this.addNode(e);

    // touch edges (from pre-computed neighbours).
    for (const e of entities) {
      for (const n of e.neighbors) {
        if (n > e.id) this.addEdge(e.id, n, "touch");
      }
    }

    // spatial relations from bboxes.
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const a = entities[i];
        const b = entities[j];
        const overlaps = bboxIntersects(a.bbox, b.bbox);
        if (overlaps) this.addEdge(a.id, b.id, "intersect", 0.5);
        if (contains(a.bbox, b.bbox)) this.addEdge(a.id, b.id, "contain", 1);
        else if (contains(b.bbox, a.bbox)) this.addEdge(b.id, a.id, "contain", 1);
        if (isAdjacent(a.bbox, b.bbox)) this.addEdge(a.id, b.id, "adjacent", 0.7);
        // support is directed: check both `a on b` and `b on a`.
        if (supports(a, b)) this.addEdge(b.id, a.id, "support", 0.8);
        else if (supports(b, a)) this.addEdge(a.id, b.id, "support", 0.8);
      }
    }
  }

  /** Query edges of a given type (and optionally a node). */
  query(opts: { type?: SpatialRelationType; nodeId?: number } = {}): SpatialEdge[] {
    let pool: SpatialEdge[];
    if (opts.type) {
      pool = this.byType.get(opts.type) ?? [];
    } else {
      pool = this.edges;
    }
    if (opts.nodeId === undefined) return pool;
    return pool.filter((e) => e.from === opts.nodeId || e.to === opts.nodeId);
  }

  /** Get an entity node by id. */
  getNode(id: number): Entity | undefined {
    return this.nodes.get(id);
  }

  /** All nodes. */
  getNodes(): Entity[] {
    return [...this.nodes.values()];
  }

  /** All edges. */
  getEdges(): SpatialEdge[] {
    return this.edges;
  }

  /** Number of nodes. */
  nodeCount(): number {
    return this.nodes.size;
  }

  /** Number of edges. */
  edgeCount(): number {
    return this.edges.length;
  }

  /** Direct neighbours of a node (any relation). */
  neighbors(id: number): number[] {
    return [...(this.adjacency.get(id) ?? [])];
  }
}

/** Is bbox `a` containing bbox `b`? */
function contains(a: { min: number[]; max: number[] }, b: { min: number[]; max: number[] }): boolean {
  return (
    a.min[0] <= b.min[0] && a.max[0] >= b.max[0] &&
    a.min[1] <= b.min[1] && a.max[1] >= b.max[1] &&
    a.min[2] <= b.min[2] && a.max[2] >= b.max[2]
  );
}

/** Are two bboxes "adjacent" (small gap in one of X/Y, overlap in the other + Z)? */
function isAdjacent(a: { min: number[]; max: number[] }, b: { min: number[]; max: number[] }): boolean {
  const gapX = Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0]);
  const gapY = Math.max(a.min[1] - b.max[1], b.min[1] - a.max[1]);
  const overlapsZ = a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
  const xClose = gapX >= -0.1 && gapX <= 0.5; // small gap or tiny overlap in X
  const yClose = gapY >= -0.1 && gapY <= 0.5;
  return overlapsZ && ((xClose && gapY <= 0) || (yClose && gapX <= 0));
}

/** Does entity `b` support entity `a` (a sits on top of b)? */
function supports(a: Entity, b: Entity): boolean {
  const gap = a.bbox.min[2] - b.bbox.max[2];
  if (gap < -0.5 || gap > 1.5) return false;
  const overlapsX = a.bbox.min[0] <= b.bbox.max[0] && a.bbox.max[0] >= b.bbox.min[0];
  const overlapsY = a.bbox.min[1] <= b.bbox.max[1] && a.bbox.max[1] >= b.bbox.min[1];
  return overlapsX && overlapsY;
}
