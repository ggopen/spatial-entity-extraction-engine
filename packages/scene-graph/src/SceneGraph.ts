import type { Entity } from "@seee/core";

export interface SceneNode {
  id: number;
  entityId: number;
  children: number[];
  parent?: number;
  /** Optional transform of this node (relative to parent). */
  label?: string;
}

/**
 * Scene Graph.
 *
 * A hierarchical wrapper over the flat {@link Entity} list. The root node
 * represents the whole scene; entities are leaf nodes; internal nodes can
 * represent groups (e.g. "building", "terrain"). The graph supports
 * incremental add/remove/move of nodes.
 */
export class SceneGraph {
  private readonly nodes = new Map<number, SceneNode>();
  private readonly entities = new Map<number, Entity>();
  private nextId = 0;
  readonly root: number;

  constructor() {
    this.root = this.nextId++;
    this.nodes.set(this.root, {
      id: this.root,
      entityId: -1,
      children: [],
      label: "scene",
    });
  }

  /** Add an entity as a child of `parent` (default: root). Returns its node id. */
  addEntity(entity: Entity, parent = this.root, label?: string): number {
    const id = this.nextId++;
    const node: SceneNode = { id, entityId: entity.id, children: [], parent, label: label ?? entity.label };
    this.nodes.set(id, node);
    this.entities.set(entity.id, entity);
    const p = this.nodes.get(parent)!;
    p.children.push(id);
    return id;
  }

  /** Add an internal grouping node. */
  addGroup(label: string, parent = this.root): number {
    const id = this.nextId++;
    const node: SceneNode = { id, entityId: -1, children: [], parent, label };
    this.nodes.set(id, node);
    this.nodes.get(parent)!.children.push(id);
    return id;
  }

  /** Remove a node (and recursively its children). */
  remove(id: number): void {
    const node = this.nodes.get(id);
    if (!node) return;
    for (const c of [...node.children]) this.remove(c);
    if (node.parent !== undefined) {
      const p = this.nodes.get(node.parent);
      if (p) p.children = p.children.filter((c) => c !== id);
    }
    if (node.entityId >= 0) this.entities.delete(node.entityId);
    this.nodes.delete(id);
  }

  /** Move a node under a new parent. */
  move(id: number, newParent: number): void {
    const node = this.nodes.get(id);
    if (!node || id === this.root) return;
    if (newParent === id) return;
    if (this.isDescendant(newParent, id)) return; // would create a cycle
    if (node.parent !== undefined) {
      const p = this.nodes.get(node.parent);
      if (p) p.children = p.children.filter((c) => c !== id);
    }
    node.parent = newParent;
    this.nodes.get(newParent)!.children.push(id);
  }

  /** Get a node by id. */
  getNode(id: number): SceneNode | undefined {
    return this.nodes.get(id);
  }

  /** Get the entity associated with a node (if any). */
  getEntityByNode(nodeId: number): Entity | undefined {
    const node = this.nodes.get(nodeId);
    if (!node || node.entityId < 0) return undefined;
    return this.entities.get(node.entityId);
  }

  /** Get entity by entity id. */
  getEntity(entityId: number): Entity | undefined {
    return this.entities.get(entityId);
  }

  /** All entity leaf nodes (depth-first). */
  *iterEntities(): Iterable<Entity> {
    const stack: number[] = [this.root];
    while (stack.length > 0) {
      const id = stack.pop()!;
      const node = this.nodes.get(id);
      if (!node) continue;
      if (node.entityId >= 0) {
        const e = this.entities.get(node.entityId);
        if (e) yield e;
      }
      // Push children in reverse so left-to-right DFS order is preserved.
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }

  /** Is `candidate` a descendant of `ancestor`? */
  isDescendant(candidate: number, ancestor: number): boolean {
    const walk = (id: number): boolean => {
      const node = this.nodes.get(id);
      if (!node) return false;
      if (node.id === candidate) return true;
      return node.children.some(walk);
    };
    return walk(ancestor);
  }

  /** Total node count. */
  size(): number {
    return this.nodes.size;
  }
}
