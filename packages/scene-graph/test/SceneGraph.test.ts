import { describe, it, expect } from "vitest";
import { SceneGraph } from "../src/SceneGraph.js";
import type { Entity } from "@seee/core";

function fakeEntity(id: number): Entity {
  return {
    id,
    regions: [],
    triangles: [],
    bbox: { min: [0, 0, 0], max: [1, 1, 1] },
    obb: { center: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfExtents: [1, 1, 1] },
    neighbors: [],
    label: "wall",
    triangleCount: 1,
  };
}

describe("SceneGraph", () => {
  it("starts with a root node", () => {
    const sg = new SceneGraph();
    expect(sg.size()).toBe(1);
    expect(sg.getNode(sg.root)?.label).toBe("scene");
  });

  it("adds entities under root", () => {
    const sg = new SceneGraph();
    sg.addEntity(fakeEntity(0));
    sg.addEntity(fakeEntity(1));
    expect(sg.size()).toBe(3);
    const entities = [...sg.iterEntities()];
    expect(entities.length).toBe(2);
  });

  it("addGroup and addEntity under a group", () => {
    const sg = new SceneGraph();
    const group = sg.addGroup("building");
    sg.addEntity(fakeEntity(0), group);
    sg.addEntity(fakeEntity(1), group);
    expect(sg.getNode(group)?.children.length).toBe(2);
  });

  it("remove cascades to children", () => {
    const sg = new SceneGraph();
    const group = sg.addGroup("g");
    sg.addEntity(fakeEntity(0), group);
    sg.addEntity(fakeEntity(1), group);
    sg.remove(group);
    expect(sg.size()).toBe(1); // only root
    expect([...sg.iterEntities()].length).toBe(0);
  });

  it("move reparents a node", () => {
    const sg = new SceneGraph();
    const g1 = sg.addGroup("g1");
    const g2 = sg.addGroup("g2");
    const e = sg.addEntity(fakeEntity(0), g1);
    sg.move(e, g2);
    expect(sg.getNode(g1)?.children).toEqual([]);
    expect(sg.getNode(g2)?.children).toEqual([e]);
  });

  it("move prevents cycles", () => {
    const sg = new SceneGraph();
    const g1 = sg.addGroup("g1");
    const g2 = sg.addGroup("g2", g1);
    sg.move(g1, g2); // would create cycle, should be no-op
    expect(sg.getNode(g1)?.parent).toBe(sg.root);
  });

  it("getEntityByNode resolves entity", () => {
    const sg = new SceneGraph();
    const nodeId = sg.addEntity(fakeEntity(7));
    expect(sg.getEntityByNode(nodeId)?.id).toBe(7);
    expect(sg.getEntity(7)?.id).toBe(7);
  });

  it("isDescendant detects hierarchy", () => {
    const sg = new SceneGraph();
    const g = sg.addGroup("g");
    const e = sg.addEntity(fakeEntity(0), g);
    expect(sg.isDescendant(e, sg.root)).toBe(true);
    expect(sg.isDescendant(sg.root, e)).toBe(false);
  });
});
