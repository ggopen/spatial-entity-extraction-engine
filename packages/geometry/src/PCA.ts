import type { Triangle, Vertex } from "@seee/core";

export interface PCA3 {
  /** Center of mass. */
  center: [number, number, number];
  /** Eigenvectors (rows), sorted by descending eigenvalue. */
  axes: [[number, number, number], [number, number, number], [number, number, number]];
  /** Eigenvalues, descending. */
  eigenvalues: [number, number, number];
}

/**
 * Principal Component Analysis on the centroid cloud of a set of triangles.
 * Uses the classic Jacobi rotation on the 3x3 symmetric covariance matrix —
 * no external linear-algebra dependency required.
 */
export function pcaFromTriangles(triangles: Triangle[]): PCA3 {
  if (triangles.length === 0) {
    return identity();
  }
  let cx = 0, cy = 0, cz = 0;
  for (const t of triangles) {
    cx += t.centroid[0];
    cy += t.centroid[1];
    cz += t.centroid[2];
  }
  const n = triangles.length;
  cx /= n; cy /= n; cz /= n;

  let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
  for (const t of triangles) {
    const dx = t.centroid[0] - cx;
    const dy = t.centroid[1] - cy;
    const dz = t.centroid[2] - cz;
    cxx += dx * dx;
    cyy += dy * dy;
    czz += dz * dz;
    cxy += dx * dy;
    cxz += dx * dz;
    cyz += dy * dz;
  }
  cxx /= n; cyy /= n; czz /= n;
  cxy /= n; cxz /= n; cyz /= n;

  const { eigenvalues, eigenvectors } = jacobi(cxx, cyy, czz, cxy, cxz, cyz);
  return {
    center: [cx, cy, cz],
    axes: eigenvectors,
    eigenvalues,
  };
}

/** PCA on raw vertices. */
export function pcaFromVertices(vertices: Vertex[]): PCA3 {
  if (vertices.length === 0) return identity();
  let cx = 0, cy = 0, cz = 0;
  for (const v of vertices) { cx += v.x; cy += v.y; cz += v.z; }
  const n = vertices.length;
  cx /= n; cy /= n; cz /= n;
  let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;
  for (const v of vertices) {
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
    cxx += dx * dx; cyy += dy * dy; czz += dz * dz;
    cxy += dx * dy; cxz += dx * dz; cyz += dy * dz;
  }
  cxx /= n; cyy /= n; czz /= n; cxy /= n; cxz /= n; cyz /= n;
  const { eigenvalues, eigenvectors } = jacobi(cxx, cyy, czz, cxy, cxz, cyz);
  return { center: [cx, cy, cz], axes: eigenvectors, eigenvalues };
}

function identity(): PCA3 {
  return {
    center: [0, 0, 0],
    axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    eigenvalues: [0, 0, 0],
  };
}

/**
 * Jacobi eigenvalue solver for a 3x3 symmetric matrix given by its 6 unique
 * entries. Returns eigenvalues (descending) and corresponding eigenvectors
 * (as rows of a 3x3 matrix).
 */
function jacobi(
  cxx: number, cyy: number, czz: number,
  cxy: number, cxz: number, cyz: number,
): { eigenvalues: [number, number, number]; eigenvectors: [[number, number, number], [number, number, number], [number, number, number]] } {
  // Work on a flat symmetric matrix M[row*3+col].
  const m = [cxx, cxy, cxz, cxy, cyy, cyz, cxz, cyz, czz];
  // Eigenvector accumulator V (identity).
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  const maxIter = 60;
  for (let iter = 0; iter < maxIter; iter++) {
    // Find largest absolute off-diagonal entry.
    let p = 0, q = 1, maxOff = Math.abs(m[1]);
    const off02 = Math.abs(m[2]);
    const off12 = Math.abs(m[5]);
    if (off02 > maxOff) { p = 0; q = 2; maxOff = off02; }
    if (off12 > maxOff) { p = 1; q = 2; maxOff = off12; }
    if (maxOff < 1e-12) break;

    const app = m[p * 3 + p];
    const aqq = m[q * 3 + q];
    const apq = m[p * 3 + q];

    const phi = app === aqq ? Math.PI / 4 : 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

    // Update the (p,q) 2x2 block of M.
    m[p * 3 + p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    m[q * 3 + q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    m[p * 3 + q] = 0;
    m[q * 3 + p] = 0;

    for (let i = 0; i < 3; i++) {
      if (i !== p && i !== q) {
        const mip = m[i * 3 + p];
        const miq = m[i * 3 + q];
        m[i * 3 + p] = c * mip - s * miq;
        m[p * 3 + i] = m[i * 3 + p];
        m[i * 3 + q] = s * mip + c * miq;
        m[q * 3 + i] = m[i * 3 + q];
      }
    }

    // Update eigenvector matrix V (post-multiply by rotation).
    for (let i = 0; i < 3; i++) {
      const vip = v[i * 3 + p];
      const viq = v[i * 3 + q];
      v[i * 3 + p] = c * vip - s * viq;
      v[i * 3 + q] = s * vip + c * viq;
    }
  }

  const eig = [m[0], m[4], m[8]];
  const order = [0, 1, 2].sort((a, b) => eig[b] - eig[a]);
  const eigenvalues: [number, number, number] = [eig[order[0]], eig[order[1]], eig[order[2]]];
  const eigenvectors: [[number, number, number], [number, number, number], [number, number, number]] = [
    [v[order[0]], v[3 + order[0]], v[6 + order[0]]],
    [v[order[1]], v[3 + order[1]], v[6 + order[1]]],
    [v[order[2]], v[3 + order[2]], v[6 + order[2]]],
  ];
  return { eigenvalues, eigenvectors };
}
