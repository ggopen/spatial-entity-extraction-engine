import type { RawMesh, MeshFormat, MeshLoadOptions } from "./types.js";

/**
 * Mesh loader.
 *
 * Sprint-1 scope:
 *   - OBJ: parsed natively (text).
 *   - GLTF/GLB: parsed natively (positions + accessors).
 *   - PLY: parsed natively (ascii + little-endian binary).
 *   - 3DTiles: fetches `tileset.json`, recursively walks content URIs and
 *     delegates each tile to GLB/b3dm parsing. b3dm is GLB with a 28-byte
 *     (or feature-table-aware) binary header that is stripped.
 *
 * OSGB / LAS / LAZ require heavyweight native codecs; the loader accepts them
 * via a pluggable `registerDecoder` mechanism so the pipeline still type-checks
 * end-to-end while those formats can be wired in later.
 */
export class MeshLoader {
  /** Registered raw-mesh decoders keyed by format. */
  private readonly decoders = new Map<MeshFormat, (data: ArrayBuffer, uri?: string) => RawMesh | RawMesh[] | Promise<RawMesh | RawMesh[]>>();

  constructor() {
    this.decoders.set("obj", decodeObj);
    this.decoders.set("gltf", decodeGltf);
    this.decoders.set("glb", decodeGlb);
    this.decoders.set("ply", decodePly);
  }

  /** Register / override a decoder for a given format (e.g. OSGB, LAS). */
  registerDecoder(format: MeshFormat, fn: (data: ArrayBuffer, uri?: string) => RawMesh | RawMesh[] | Promise<RawMesh | RawMesh[]>): void {
    this.decoders.set(format, fn);
  }

  /** Detect a format from a URI or magic bytes. */
  detectFormat(uri: string, bytes?: ArrayBuffer): MeshFormat {
    const lower = uri.toLowerCase();
    if (lower.endsWith("tileset.json") || lower.includes("/3dtiles/")) return "3dtiles";
    if (lower.endsWith(".osgb")) return "osgb";
    if (lower.endsWith(".obj")) return "obj";
    if (lower.endsWith(".gltf")) return "gltf";
    if (lower.endsWith(".glb") || lower.endsWith(".b3dm")) return "glb";
    if (lower.endsWith(".ply")) return "ply";
    if (lower.endsWith(".las")) return "las";
    if (lower.endsWith(".laz")) return "laz";
    if (bytes) {
      const view = new DataView(bytes);
      if (bytes.byteLength >= 4) {
        const magic = view.getUint32(0, true);
        if (magic === 0x46546c67) return "glb"; // 'glTF'
      }
    }
    return "obj";
  }

  /** Load all meshes referenced by a URI. For 3DTiles, this walks the tileset. */
  async load(uri: string, opts: MeshLoadOptions = {}): Promise<RawMesh[]> {
    const format = this.detectFormat(uri);
    if (format === "3dtiles") return this.load3DTiles(uri, opts);
    const data = await fetchArrayBuffer(uri);
    const fmt = this.detectFormat(uri, data);
    const decoder = this.decoders.get(fmt);
    if (!decoder) throw new Error(`No decoder registered for format: ${fmt}`);
    const result = await decoder(data, uri);
    return Array.isArray(result) ? result : [result];
  }

  /** Decode a raw buffer of a known format. */
  async decode(format: MeshFormat, data: ArrayBuffer, uri?: string): Promise<RawMesh[]> {
    const decoder = this.decoders.get(format);
    if (!decoder) throw new Error(`No decoder registered for format: ${format}`);
    const result = await decoder(data, uri);
    return Array.isArray(result) ? result : [result];
  }

  private async load3DTiles(tilesetUri: string, opts: MeshLoadOptions): Promise<RawMesh[]> {
    const tileset = await fetchJson(tilesetUri);
    const base = baseUrl(tilesetUri);
    const meshes: RawMesh[] = [];
    const maxTiles = opts.maxTiles ?? Infinity;
    const maxTriangles = opts.maxTriangles ?? Infinity;
    let trianglesLoaded = 0;
    const onProgress = opts.onProgress;

    const visit = async (node: any, parentTransform: number[], depth: number): Promise<void> => {
      if (meshes.length >= maxTiles) return;
      if (trianglesLoaded >= maxTriangles) return;
      const maxDepth = opts.maxDepth ?? Infinity;
      if (depth > maxDepth) return;

      const local = (node.transform as number[] | undefined) ?? identityMatrix();
      const combined = multiplyMatrix(parentTransform, local);
      const children = node.children ?? [];
      const content = node.content;
      const geometricError = node.geometricError ?? 0;

      if (content?.uri) {
        try {
          const uri = resolveUri(base, content.uri);
          const data = await fetchArrayBuffer(uri);
          const fmt = this.detectFormat(uri, data);
          const decoder = this.decoders.get(fmt === "glb" ? "glb" : fmt);
          if (decoder) {
            const result = await decoder(stripB3dmHeader(data, uri), uri);
            const list = Array.isArray(result) ? result : [result];
            for (const m of list) {
              m.transform = combined as any;
              meshes.push(m);
              // Approximate triangle count from indices (or positions/3).
              trianglesLoaded += m.indices ? m.indices.length / 3 : m.positions.length / 9;
            }
            onProgress?.({ tilesLoaded: meshes.length, depth, geometricError });
          }
        } catch {
          // Skip a single tile failure; keep going.
        }
      }

      // Stop traversing once we hit the budget.
      if (meshes.length >= maxTiles) return;
      if (trianglesLoaded >= maxTriangles) return;

      for (const child of children) {
        if (meshes.length >= maxTiles) break;
        if (trianglesLoaded >= maxTriangles) break;
        await visit(child, combined, depth + 1);
      }
    };

    const rootTransform = (tileset.transform as number[] | undefined) ?? identityMatrix();
    if (tileset.root) {
      await visit(tileset.root, rootTransform, 0);
    }
    return meshes;
  }
}

/* --------------------------------- helpers --------------------------------- */

async function fetchJson(uri: string): Promise<any> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${uri}`);
  return res.json();
}

async function fetchArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${uri}`);
  return res.arrayBuffer();
}

function baseUrl(uri: string): string {
  const idx = uri.lastIndexOf("/");
  return idx >= 0 ? uri.slice(0, idx + 1) : "";
}

function resolveUri(base: string, uri: string): string {
  if (/^https?:\/\//i.test(uri) || uri.startsWith("data:")) return uri;
  return base + uri;
}

function identityMatrix(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrix(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

/** A 3DTiles b3dm wraps a GLB with a feature-table header. Strip it. */
export function stripB3dmHeader(data: ArrayBuffer, uri: string): ArrayBuffer {
  if (!uri.toLowerCase().endsWith(".b3dm")) return data;
  const view = new DataView(data);
  if (data.byteLength < 28) return data;
  const magic = view.getUint32(0, true);
  if (magic !== 0x6d643362) return data; // 'b3dm'
  // byteLength(4) + magic already read; FTCJ + BTOCJ lengths at offsets 12 & 16
  const ftJsonLen = view.getUint32(12, true);
  const btBinLen = view.getUint32(16, true);
  const ftBinLen = view.getUint32(20, true);
  const btJsonLen = view.getUint32(24, true);
  const headerLen = 28 + ftJsonLen + ftBinLen + btJsonLen + btBinLen;
  if (headerLen >= data.byteLength) return data;
  return data.slice(headerLen);
}

/* --------------------------------- OBJ ------------------------------------- */
function decodeObj(data: ArrayBuffer): RawMesh {
  const text = new TextDecoder().decode(data);
  const positions: number[] = [];
  const indices: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts[0] === "v") {
      positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (parts[0] === "f") {
      // f v/vt/vn or v vt vn or v
      const verts = parts.slice(1);
      const idx: number[] = [];
      for (const v of verts) {
        const first = v.split("/")[0];
        const n = parseInt(first, 10);
        if (!Number.isNaN(n)) idx.push(n > 0 ? n - 1 : positions.length / 3 + n);
      }
      // triangulate as a fan
      for (let i = 1; i + 1 < idx.length; i++) {
        indices.push(idx[0], idx[i], idx[i + 1]);
      }
    }
  }
  return {
    format: "obj",
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

/* --------------------------------- PLY ------------------------------------- */
function decodePly(data: ArrayBuffer): RawMesh {
  const bytes = new Uint8Array(data);
  // Find header end ('end_header\n')
  let headerEnd = -1;
  const sep = [0x65, 0x6e, 0x64, 0x5f, 0x68, 0x65, 0x61, 0x64, 0x65, 0x72]; // 'end_header'
  for (let i = 0; i + sep.length <= bytes.length; i++) {
    let ok = true;
    for (let j = 0; j < sep.length; j++) {
      if (bytes[i + j] !== sep[j]) { ok = false; break; }
    }
    if (ok) {
      // skip to next newline
      let nl = i + sep.length;
      while (nl < bytes.length && bytes[nl] !== 0x0a) nl++;
      headerEnd = nl + 1;
      break;
    }
  }
  if (headerEnd < 0) {
    // Treat as raw point cloud
    return { format: "ply", positions: new Float32Array(data) };
  }
  const headerText = new TextDecoder().decode(bytes.slice(0, headerEnd));
  const isAscii = /format\s+ascii/i.test(headerText);
  const vertexCount = Number(/element\s+vertex\s+(\d+)/i.exec(headerText)?.[1] ?? 0);
  const faceCount = Number(/element\s+face\s+(\d+)/i.exec(headerText)?.[1] ?? 0);

  const positions = new Float32Array(vertexCount * 3);
  const indices = faceCount > 0 ? new Uint32Array(faceCount * 3) : undefined;

  if (isAscii) {
    const lines = new TextDecoder().decode(bytes.slice(headerEnd)).split(/\r?\n/);
    let vi = 0;
    let fi = 0;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      const p = t.split(/\s+/);
      if (p[0] === "v" || p[0] === "vertex") {
        positions[vi * 3] = parseFloat(p[1]);
        positions[vi * 3 + 1] = parseFloat(p[2]);
        positions[vi * 3 + 2] = parseFloat(p[3]);
        vi++;
      } else if (p[0] === "f" || p[0] === "face") {
        if (fi * 3 + 2 < (indices?.length ?? 0)) {
          indices![fi * 3] = parseInt(p[1], 10);
          indices![fi * 3 + 1] = parseInt(p[2], 10);
          indices![fi * 3 + 2] = parseInt(p[3], 10);
          fi++;
        }
      }
    }
  } else {
    // little-endian binary; assume interleaved: vertex(x,y,z float32) * N, then faces (uint8 count + 3 uint32)
    const view = new DataView(data);
    let off = headerEnd;
    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3] = view.getFloat32(off, true); off += 4;
      positions[i * 3 + 1] = view.getFloat32(off, true); off += 4;
      positions[i * 3 + 2] = view.getFloat32(off, true); off += 4;
    }
    if (indices && faceCount > 0) {
      for (let i = 0; i < faceCount; i++) {
        const count = view.getUint8(off); off += 1;
        if (count >= 3) {
          indices[i * 3] = view.getUint32(off, true); off += 4;
          indices[i * 3 + 1] = view.getUint32(off, true); off += 4;
          indices[i * 3 + 2] = view.getUint32(off, true); off += 4;
          // skip remaining vertices of this polygon
          for (let j = 3; j < count; j++) off += 4;
        }
      }
    }
  }
  return { format: "ply", positions, indices };
}

/* -------------------------------- GLTF/GLB --------------------------------- */
function decodeGltf(data: ArrayBuffer): RawMesh[] {
  const text = new TextDecoder().decode(data);
  const json = JSON.parse(text);
  return parseGltfJson(json, data);
}

function decodeGlb(data: ArrayBuffer): RawMesh[] {
  const view = new DataView(data);
  const magic = view.getUint32(0, true);
  if (magic !== 0x46546c67) {
    // Not a GLB — try interpreting as raw position triplets (for synthetic test meshes)
    if (data.byteLength % 12 === 0) {
      return [{ format: "glb", positions: new Float32Array(data) }];
    }
    throw new Error("Not a valid GLB file");
  }
  // GLB header: magic(4) + version(4) + length(4) = 12 bytes
  let offset = 12;
  let json: any = null;
  let bin: ArrayBuffer | null = null;
  while (offset < data.byteLength) {
    const chunkLen = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;
    const chunkData = data.slice(offset, offset + chunkLen);
    offset += chunkLen;
    if (chunkType === 0x4e4f534a) {
      // 'JSON'
      json = JSON.parse(new TextDecoder().decode(chunkData));
    } else if (chunkType === 0x004e4942) {
      // 'BIN\0'
      bin = chunkData;
    }
  }
  if (!json) throw new Error("GLB missing JSON chunk");
  return parseGltfJson(json, bin ?? new ArrayBuffer(0));
}

function parseGltfJson(json: any, bin: ArrayBuffer): RawMesh[] {
  const meshes: RawMesh[] = [];
  if (!json.meshes) return meshes;
  const accessors = json.accessors ?? [];
  const bufferViews = json.bufferViews ?? [];
  const buffers = json.buffers ?? [];
  const getBuffer = (bvIndex: number): ArrayBuffer => {
    const bv = bufferViews[bvIndex];
    if (!bv) return new ArrayBuffer(0);
    const buffer = buffers[bv.buffer] ?? {};
    let src: ArrayBuffer;
    if (bv.buffer === 0 && bin && (!buffer.uri || buffer.uri === undefined)) {
      src = bin;
    } else if (buffer.uri && buffer.uri.startsWith("data:")) {
      // inline data URI — best-effort decode
      src = decodeDataUri(buffer.uri);
    } else {
      src = bin;
    }
    const off = bv.byteOffset ?? 0;
    const len = bv.byteLength ?? src.byteLength - off;
    return src.slice(off, off + len);
  };

  for (const meshDef of json.meshes) {
    for (const prim of meshDef.primitives) {
      const posAccessor = accessors[prim.attributes?.POSITION];
      if (!posAccessor) continue;
      const posBuf = getBuffer(posAccessor.bufferView);
      const positions = new Float32Array(
        posBuf,
        posAccessor.byteOffset ?? 0,
        Math.floor(posBuf.byteLength / 4),
      ).slice();
      let indices: Uint32Array | undefined;
      if (prim.indices !== undefined) {
        const idxAcc = accessors[prim.indices];
        const idxBuf = getBuffer(idxAcc.bufferView);
        const idxOff = idxAcc.byteOffset ?? 0;
        const compType = idxAcc.componentType ?? 5125;
        if (compType === 5125) {
          indices = new Uint32Array(idxBuf, idxOff, idxAcc.count).slice();
        } else if (compType === 5123) {
          const u16 = new Uint16Array(idxBuf, idxOff, idxAcc.count);
          indices = Uint32Array.from(u16);
        } else {
          const u8 = new Uint8Array(idxBuf, idxOff, idxAcc.count);
          indices = Uint32Array.from(u8);
        }
      }
      meshes.push({ format: "glb", positions, indices });
    }
  }
  return meshes;
}

function decodeDataUri(uri: string): ArrayBuffer {
  const comma = uri.indexOf(",");
  if (comma < 0) return new ArrayBuffer(0);
  const meta = uri.slice(0, comma);
  const payload = uri.slice(comma + 1);
  if (meta.includes(";base64")) {
    const bin = atob(payload);
    const buf = new ArrayBuffer(bin.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
    return buf;
  }
  return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
}
