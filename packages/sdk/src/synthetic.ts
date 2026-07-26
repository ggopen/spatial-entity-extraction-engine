import type { RawMesh } from "@seee/core";

/**
 * Generate a synthetic mesh that resembles a small architectural scene:
 *   - a flat ground patch,
 *   - a box (cubicle) sitting on the ground,
 *   - a thin wall,
 * so the Triangle → Region → Entity pipeline has clear coplanar surfaces
 * and edges to merge.
 *
 * `grid` controls triangle resolution (default 8 → ~6*grid*grid*6 triangles).
 * `offset` translates the entire scene in world space — used by scaling
 * benchmarks to tile many non-overlapping scenes across a grid so the
 * proximity-neighbour build stays O(n) instead of O(n²).
 */
export function makeSyntheticScene(grid = 8, offset: [number, number, number] = [0, 0, 0]): RawMesh {
  const positions: number[] = [];
  const indices: number[] = [];

  const addTri = (a: number[], b: number[], c: number[]) => {
    const base = positions.length / 3;
    positions.push(
      a[0] + offset[0], a[1] + offset[1], a[2] + offset[2],
      b[0] + offset[0], b[1] + offset[1], b[2] + offset[2],
      c[0] + offset[0], c[1] + offset[1], c[2] + offset[2],
    );
    indices.push(base, base + 1, base + 2);
  };
  const addQuad = (a: number[], b: number[], c: number[], d: number[]) => {
    addTri(a, b, c);
    addTri(a, c, d);
  };

  // Ground: 4x4 plane subdivided into grid x grid quads around origin.
  const size = 4;
  const half = size / 2;
  const step = size / grid;
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const x0 = -half + i * step;
      const x1 = x0 + step;
      const y0 = -half + j * step;
      const y1 = y0 + step;
      addQuad([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]);
    }
  }

  // A box (1x1x1) sitting on the ground at (-1, -1).
  const bx = -1, by = -1, bz0 = 0, bz1 = 1;
  const boxCorners = (gx: number, gy: number, gz: number) => [gx, gy, gz] as number[];
  // bottom (coplanar with ground)
  addQuad([bx, by, bz0], [bx + 1, by, bz0], [bx + 1, by + 1, bz0], [bx, by + 1, bz0]);
  // top
  addQuad([bx, by, bz1], [bx + 1, by, bz1], [bx + 1, by + 1, bz1], [bx, by + 1, bz1]);
  // sides
  addQuad([bx, by, bz0], [bx, by + 1, bz0], [bx, by + 1, bz1], [bx, by, bz1]);
  addQuad([bx + 1, by, bz0], [bx + 1, by + 1, bz0], [bx + 1, by + 1, bz1], [bx + 1, by, bz1]);
  addQuad([bx, by, bz0], [bx + 1, by, bz0], [bx + 1, by, bz1], [bx, by, bz1]);
  addQuad([bx, by + 1, bz0], [bx + 1, by + 1, bz0], [bx + 1, by + 1, bz1], [bx, by + 1, bz1]);

  // A thin wall (2x0.1x1) at (1, 0).
  const wx = 1, wy = -0.05, wz0 = 0, wz1 = 1;
  addQuad([wx, wy, wz0], [wx + 0.1, wy, wz0], [wx + 0.1, wy, wz1], [wx, wy, wz1]);
  addQuad([wx, wy + 2, wz0], [wx + 0.1, wy + 2, wz0], [wx + 0.1, wy + 2, wz1], [wx, wy + 2, wz1]);
  addQuad([wx, wy, wz0], [wx, wy + 2, wz0], [wx, wy + 2, wz1], [wx, wy, wz1]);
  addQuad([wx + 0.1, wy, wz0], [wx + 0.1, wy + 2, wz0], [wx + 0.1, wy + 2, wz1], [wx + 0.1, wy, wz1]);
  addQuad([wx, wy, wz1], [wx + 0.1, wy, wz1], [wx + 0.1, wy + 2, wz1], [wx, wy + 2, wz1]);

  void boxCorners;

  return {
    format: "glb",
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

/** Generate `count` random triangles in a unit cube (for benchmark scaling). */
export function makeRandomMesh(count: number): RawMesh {
  const positions = new Float32Array(count * 3 * 3);
  const indices = new Uint32Array(count * 3);
  for (let i = 0; i < count; i++) {
    for (let v = 0; v < 3; v++) {
      positions[(i * 3 + v) * 3] = Math.random();
      positions[(i * 3 + v) * 3 + 1] = Math.random();
      positions[(i * 3 + v) * 3 + 2] = Math.random();
    }
    indices[i * 3] = i * 3;
    indices[i * 3 + 1] = i * 3 + 1;
    indices[i * 3 + 2] = i * 3 + 2;
  }
  return { format: "glb", positions, indices };
}
