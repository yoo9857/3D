'use strict';

const { buildGLB } = require('./glb');

/** sRGB(0~255) → 선형(0~1). glTF COLOR_0 은 선형색이어야 색이 정확히 나온다. */
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * 전경 마스크 계산.
 * - 이미지에 알파가 있으면 알파로 판정
 * - 없으면(불투명 배경) 테두리에서 색이 비슷한 영역을 flood-fill 로 '배경'으로 제거
 *   → 흰색/단색 배경이 판처럼 남는 문제 해결
 */
function computeForegroundMask(R, G, B, A, W, H, thr) {
  const N = W * H;
  const at = (x, y) => y * W + x;

  let hasAlpha = false;
  for (let k = 0; k < N; k++) {
    if (A[k] < 250) {
      hasAlpha = true;
      break;
    }
  }

  const fg = new Uint8Array(N);
  if (hasAlpha) {
    for (let k = 0; k < N; k++) fg[k] = A[k] >= 128 ? 1 : 0;
    return fg;
  }

  const bg = new Uint8Array(N);
  const stack = [];
  const seed = (x, y) => {
    const k = at(x, y);
    if (!bg[k]) {
      bg[k] = 1;
      stack.push(x, y);
    }
  };
  for (let x = 0; x < W; x++) {
    seed(x, 0);
    seed(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    seed(0, y);
    seed(W - 1, y);
  }
  const close = (k1, k2) => Math.abs(R[k1] - R[k2]) + Math.abs(G[k1] - G[k2]) + Math.abs(B[k1] - B[k2]) < thr;

  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    const k = at(x, y);
    const nbrs = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nx, ny] of nbrs) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nk = at(nx, ny);
      if (bg[nk]) continue;
      if (close(nk, k)) {
        bg[nk] = 1;
        stack.push(nx, ny);
      }
    }
  }
  let fgCount = 0;
  for (let k = 0; k < N; k++) {
    fg[k] = bg[k] ? 0 : 1;
    if (fg[k]) fgCount++;
  }
  // 안전장치: 배경 제거가 85% 이상을 지웠으면(실사 그라데이션에서 과다 확산) 취소하고 전체 유지
  if (fgCount < N * 0.15) {
    for (let k = 0; k < N; k++) fg[k] = 1;
  }
  return fg;
}

/**
 * Jimp bitmap({ data: RGBA Buffer, width, height }) → 닫힌 부조 GLB (CPU 전용).
 * 배경 제거 + 밝기 블러 + 완만한 깊이 + 부드러운 노멀.
 */
function buildReliefGLB(bitmap, opts = {}) {
  const { data, width, height } = bitmap;
  const target = opts.resolution || 220; // 밀도↑
  const depthScale = opts.depthScale != null ? opts.depthScale : 0.3;
  const bilateralPasses = opts.bilateralPasses != null ? opts.bilateralPasses : 2;
  const bgThreshold = opts.bgThreshold != null ? opts.bgThreshold : 100;

  const step = Math.max(1, Math.ceil(Math.max(width, height) / target));
  const W = Math.floor((width - 1) / step) + 1;
  const H = Math.floor((height - 1) / step) + 1;
  const cell = 2 / Math.max(W, H);
  const ox = (-(W - 1) * cell) / 2;
  const oy = ((H - 1) * cell) / 2;
  const backZ = -Math.max(0.25, depthScale * 0.7);

  const gc = W * H;
  const R = new Float32Array(gc);
  const G = new Float32Array(gc);
  const B = new Float32Array(gc);
  const A = new Float32Array(gc);
  const L = new Float32Array(gc);

  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      const px = Math.min(width - 1, gx * step);
      const py = Math.min(height - 1, gy * step);
      const i = (py * width + px) * 4;
      const k = gy * W + gx;
      R[k] = data[i];
      G[k] = data[i + 1];
      B[k] = data[i + 2];
      A[k] = data[i + 3];
      L[k] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    }
  }

  const at = (x, y) => y * W + x;
  const fgMask = computeForegroundMask(R, G, B, A, W, H, bgThreshold);
  const isFg = (x, y) => fgMask[at(x, y)] === 1;

  // 엣지 보존(양방향, bilateral) 스무딩 → 얼굴 윤곽은 살리고 노이즈만 제거
  let Lb = L.slice();
  for (let pass = 0; pass < bilateralPasses; pass++) {
    Lb = bilateral(Lb, isFg, W, H, 2, 2.0, 0.12);
  }

  // 다중스케일 디테일: 부드러운 형상(Lb) + 원본 고주파(L-Lb)를 약하게 복원 → 텍스처 살림
  const detailAmount = opts.detail != null ? opts.detail : 0.35;
  for (let k = 0; k < gc; k++) Lb[k] = Lb[k] + (L[k] - Lb[k]) * detailAmount;

  let lMin = 1;
  let lMax = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!isFg(x, y)) continue;
      const v = Lb[at(x, y)];
      if (v < lMin) lMin = v;
      if (v > lMax) lMax = v;
    }
  const lRange = Math.max(1e-4, lMax - lMin);
  const frontZ = (x, y) => ((Lb[at(x, y)] - lMin) / lRange) * depthScale;

  const positions = [];
  const colors = [];
  const frontIndex = new Int32Array(gc).fill(-1);
  const backIndex = new Int32Array(gc).fill(-1);
  let vcount = 0;
  const addVertex = (X, Y, Z, r, g, b) => {
    positions.push(X, Y, Z);
    colors.push(r, g, b);
    return vcount++;
  };
  const frontV = (x, y) => {
    const k = at(x, y);
    if (frontIndex[k] < 0) {
      frontIndex[k] = addVertex(ox + x * cell, oy - y * cell, frontZ(x, y), srgbToLinear(R[k]), srgbToLinear(G[k]), srgbToLinear(B[k]));
    }
    return frontIndex[k];
  };
  const backV = (x, y) => {
    const k = at(x, y);
    if (backIndex[k] < 0) {
      backIndex[k] = addVertex(ox + x * cell, oy - y * cell, backZ, 0.13, 0.15, 0.22);
    }
    return backIndex[k];
  };

  const cellSolid = (x, y) => {
    if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return false;
    return isFg(x, y) && isFg(x + 1, y) && isFg(x + 1, y + 1) && isFg(x, y + 1);
  };

  const indices = [];
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      if (!cellSolid(x, y)) continue;
      const a = frontV(x, y);
      const b = frontV(x + 1, y);
      const c = frontV(x + 1, y + 1);
      const d = frontV(x, y + 1);
      indices.push(a, c, b, a, d, c);

      const ab = backV(x, y);
      const bb = backV(x + 1, y);
      const cb = backV(x + 1, y + 1);
      const db = backV(x, y + 1);
      indices.push(ab, bb, cb, ab, cb, db);

      if (!cellSolid(x, y - 1)) indices.push(a, b, bb, a, bb, ab);
      if (!cellSolid(x, y + 1)) indices.push(d, db, cb, d, cb, c);
      if (!cellSolid(x - 1, y)) indices.push(a, ab, db, a, db, d);
      if (!cellSolid(x + 1, y)) indices.push(b, c, cb, b, cb, bb);
    }
  }

  const positionArray = new Float32Array(positions);
  const colorArray = new Float32Array(colors);
  const indexArray = new Uint32Array(indices);
  const normals = computeSmoothNormals(positionArray, indexArray);
  return buildGLB(positionArray, colorArray, indexArray, normals);
}

/**
 * 양방향 필터(bilateral): 공간 거리 + 값 차이 가중 평균.
 * 밝기 경계(윤곽)를 보존하면서 노이즈만 완화한다.
 */
function bilateral(L, isFg, W, H, radius, sigmaS, sigmaR) {
  const out = L.slice();
  const s2 = 2 * sigmaS * sigmaS;
  const r2 = 2 * sigmaR * sigmaR;
  const at = (x, y) => y * W + x;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isFg(x, y)) continue;
      const center = L[at(x, y)];
      let sum = 0;
      let wsum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !isFg(nx, ny)) continue;
          const val = L[at(nx, ny)];
          const dr = val - center;
          const w = Math.exp(-(dx * dx + dy * dy) / s2 - (dr * dr) / r2);
          sum += w * val;
          wsum += w;
        }
      }
      if (wsum > 0) out[at(x, y)] = sum / wsum;
    }
  }
  return out;
}

/** 인접 삼각형 면 법선을 정점에 누적·정규화 → 부드러운 셰이딩 */
function computeSmoothNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3;
    const ib = indices[t + 1] * 3;
    const ic = indices[t + 2] * 3;
    const e1x = positions[ib] - positions[ia];
    const e1y = positions[ib + 1] - positions[ia + 1];
    const e1z = positions[ib + 2] - positions[ia + 2];
    const e2x = positions[ic] - positions[ia];
    const e2y = positions[ic + 1] - positions[ia + 1];
    const e2z = positions[ic + 2] - positions[ia + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const base of [ia, ib, ic]) {
      normals[base] += nx;
      normals[base + 1] += ny;
      normals[base + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return normals;
}

module.exports = { buildReliefGLB };
