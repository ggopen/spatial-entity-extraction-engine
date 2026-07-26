import type { Triangle, Vertex, RawMesh, BoundingBox } from "./types.js";

/** Cross product of two 3D vectors. */
export function cross(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): [number, number, number] {
  return [
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx,
  ];
}

/** Dot product. */
export function dot(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  return ax * bx + ay * by + az * bz;
}

/** Normalize a 3D vector in place; returns the (possibly zero) length. */
export function normalize(v: [number, number, number]): number {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len > 1e-12) {
    v[0] /= len;
    v[1] /= len;
    v[2] /= len;
  }
  return len;
}

/**
 * Build a Triangle (with normal, centroid, area) from 3 vertices.
 * The triangle's `neighbors` and `regionId` are left empty / -1.
 */
export function makeTriangle(
  id: number,
  a: Vertex,
  b: Vertex,
  c: Vertex,
): Triangle {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const cr = cross(ux, uy, uz, vx, vy, vz);
  const area = 0.5 * Math.hypot(cr[0], cr[1], cr[2]);
  const normal: [number, number, number] = [cr[0], cr[1], cr[2]];
  normalize(normal);
  const bbox: BoundingBox = {
    min: [Math.min(a.x, b.x, c.x), Math.min(a.y, b.y, c.y), Math.min(a.z, b.z, c.z)],
    max: [Math.max(a.x, b.x, c.x), Math.max(a.y, b.y, c.y), Math.max(a.z, b.z, c.z)],
  };
  return {
    id,
    vertices: [a.id, b.id, c.id],
    normal,
    centroid: [(a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3],
    bbox,
    neighbors: [],
    regionId: -1,
    area,
  };
}

/**
 * Convert a {@link RawMesh} into arrays of {@link Vertex} and {@link Triangle}.
 * If the mesh has no indices, the positions are treated as a triangle list.
 */
export function buildVerticesAndTriangles(
  mesh: RawMesh,
): { vertices: Vertex[]; triangles: Triangle[] } {
  const pos = mesh.positions;
  const vertexCount = pos.length / 3;
  const vertices: Vertex[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    vertices[i] = { id: i, x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2] };
  }

  const triangles: Triangle[] = [];
  let triId = 0;

  const applyTransform = (v: Vertex): Vertex => {
    if (!mesh.transform) return v;
    const m = mesh.transform;
    return {
      id: v.id,
      x: m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12],
      y: m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13],
      z: m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14],
    };
  };

  const buildOne = (i0: number, i1: number, i2: number) => {
    const a = applyTransform(vertices[i0]);
    const b = applyTransform(vertices[i1]);
    const c = applyTransform(vertices[i2]);
    triangles.push(makeTriangle(triId++, a, b, c));
  };

  if (mesh.indices && mesh.indices.length >= 3) {
    const idx = mesh.indices;
    for (let i = 0; i + 2 < idx.length; i += 3) {
      buildOne(idx[i], idx[i + 1], idx[i + 2]);
    }
  } else {
    for (let i = 0; i + 2 < vertexCount; i += 3) {
      buildOne(i, i + 1, i + 2);
    }
  }
  return { vertices, triangles };
}

/** Angle (in degrees) between two unit normals. Always in [0, 180]. */
export function angleBetween(
  n1: [number, number, number],
  n2: [number, number, number],
): number {
  const d = Math.abs(dot(n1[0], n1[1], n1[2], n2[0], n2[1], n2[2]));
  const clamped = Math.max(-1, Math.min(1, d));
  return (Math.acos(clamped) * 180) / Math.PI;
}
