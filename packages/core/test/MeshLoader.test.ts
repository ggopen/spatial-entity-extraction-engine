import { describe, it, expect } from "vitest";
import { MeshLoader, stripB3dmHeader } from "../src/MeshLoader.js";

describe("MeshLoader", () => {
  it("detects formats from URIs", () => {
    const loader = new MeshLoader();
    expect(loader.detectFormat("https://x/tileset.json")).toBe("3dtiles");
    expect(loader.detectFormat("a/b/c.glb")).toBe("glb");
    expect(loader.detectFormat("a/b/c.b3dm")).toBe("glb");
    expect(loader.detectFormat("a.obj")).toBe("obj");
    expect(loader.detectFormat("a.gltf")).toBe("gltf");
    expect(loader.detectFormat("a.ply")).toBe("ply");
    expect(loader.detectFormat("a.osgb")).toBe("osgb");
    expect(loader.detectFormat("a.las")).toBe("las");
    expect(loader.detectFormat("a.laz")).toBe("laz");
  });

  it("decodes an OBJ buffer", async () => {
    const obj = `# test
v 0 0 0
v 1 0 0
v 0 1 0
v 1 1 0
f 1 2 3
f 2 4 3
`;
    const buf = new TextEncoder().encode(obj).buffer;
    const loader = new MeshLoader();
    const meshes = await loader.decode("obj", buf, "test.obj");
    expect(meshes.length).toBe(1);
    expect(meshes[0].positions.length).toBe(12); // 4 verts
    expect(meshes[0].indices!.length).toBe(6); // 2 tris
  });

  it("decodes an OBJ with face fan (quad)", async () => {
    const obj = `v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
`;
    const buf = new TextEncoder().encode(obj).buffer;
    const loader = new MeshLoader();
    const meshes = await loader.decode("obj", buf);
    expect(meshes[0].indices!.length).toBe(6); // 2 tris from the quad
  });

  it("decodes an ascii PLY", async () => {
    const ply = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2
`;
    const buf = new TextEncoder().encode(ply).buffer;
    const loader = new MeshLoader();
    const meshes = await loader.decode("ply", buf);
    expect(meshes[0].positions.length).toBe(9);
    expect(meshes[0].indices!.length).toBe(3);
  });

  it("stripB3dmHeader leaves non-b3dm data untouched", () => {
    const data = new ArrayBuffer(32);
    const out = stripB3dmHeader(data, "foo.glb");
    expect(out.byteLength).toBe(32);
  });

  it("registerDecoder allows overriding formats", async () => {
    const loader = new MeshLoader();
    loader.registerDecoder("osgb", () => ({ format: "osgb", positions: new Float32Array([0, 0, 0]) }));
    const meshes = await loader.decode("osgb", new ArrayBuffer(0), "x.osgb");
    expect(meshes[0].format).toBe("osgb");
  });
});
