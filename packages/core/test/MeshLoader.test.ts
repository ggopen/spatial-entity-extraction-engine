import { describe, it, expect } from "vitest";
import { MeshLoader, stripB3dmHeader } from "../src/MeshLoader.js";

describe("MeshLoader", () => {
  it("detects formats from URIs", () => {
    const loader = new MeshLoader();
    expect(loader.detectFormat("https://x/tileset.json")).toBe("3dtiles");
    // A `.b3dm` under a /3dtiles/ path directory must NOT be misdetected as 3dtiles.
    expect(loader.detectFormat("https://data.mars3d.cn/3dtiles/qx-simiao/Data/Tile_X/Tile_X.b3dm")).toBe("glb");
    expect(loader.detectFormat("a/b/c.glb")).toBe("glb");
    expect(loader.detectFormat("a/b/c.b3dm")).toBe("glb");
    expect(loader.detectFormat("a.obj")).toBe("obj");
    expect(loader.detectFormat("a.gltf")).toBe("gltf");
    expect(loader.detectFormat("a.ply")).toBe("ply");
    expect(loader.detectFormat("a.osgb")).toBe("osgb");
    expect(loader.detectFormat("a.las")).toBe("las");
    expect(loader.detectFormat("a.laz")).toBe("laz");
  });

  it("detects formats from magic bytes", () => {
    const loader = new MeshLoader();
    // 'glTF' magic 0x46546c67 → glb.
    const glbBytes = new ArrayBuffer(12);
    new DataView(glbBytes).setUint32(0, 0x46546c67, true);
    expect(loader.detectFormat("unknown.bin", glbBytes)).toBe("glb");
    // 'b3dm' magic 0x6d643362 → glb (header is stripped at decode time).
    const b3dmBytes = new ArrayBuffer(28);
    new DataView(b3dmBytes).setUint32(0, 0x6d643362, true);
    expect(loader.detectFormat("unknown.bin", b3dmBytes)).toBe("glb");
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

  it("loads 3DTiles with nested (external) tilesets via fetch", async () => {
    // Build a synthetic tile tree:
    //   root tileset.json   (1.0 spec: content.uri)
    //     └── root.content.uri = "nested.json"     (external tileset)
    //           └── nested.root.content.url = "leaf.obj"  (0.0 spec: content.url)
    // Verifies both the 1.0 `uri` and 0.0 `url` fields are honoured.
    const rootTileset = {
      asset: { version: "1.0" },
      root: {
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        geometricError: 100,
        content: { uri: "nested.json" },
        children: [],
      },
    };
    const nestedTileset = {
      asset: { version: "0.0" },
      root: {
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1],
        geometricError: 1,
        content: { url: "leaf.obj" },
        children: [],
      },
    };
    const obj = `v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`;

    // Stub the global `fetch` so the loader can resolve the synthetic tree.
    const originalFetch = globalThis.fetch;
    const files: Record<string, string> = {
      "https://x/tileset.json": JSON.stringify(rootTileset),
      "https://x/nested.json": JSON.stringify(nestedTileset),
      "https://x/leaf.obj": obj,
    };
    globalThis.fetch = ((input: any) => {
      const url = typeof input === "string" ? input : String(input);
      const body = files[url];
      if (body === undefined) return Promise.resolve(new Response("", { status: 404 }));
      const isJson = url.endsWith(".json");
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": isJson ? "application/json" : "application/octet-stream" },
        }),
      );
    }) as any;

    try {
      const loader = new MeshLoader();
      const meshes = await loader.load("https://x/tileset.json", { maxTiles: 8 });
      // 1 mesh (the leaf OBJ) should be returned.
      expect(meshes.length).toBe(1);
      // The leaf mesh must inherit the nested root transform (translate X by 100).
      expect(meshes[0].transform).toBeDefined();
      // Transform is column-major; translation lives in indices 12,13,14.
      expect((meshes[0].transform as number[])[12]).toBe(100);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
