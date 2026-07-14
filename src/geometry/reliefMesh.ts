import * as THREE from 'three';

export interface ReliefOptions {
  /** RGBA 픽셀, 길이 = width*height*4 */
  color: Uint8ClampedArray;
  /** 깊이(0~255, 255=가장 가까움), 길이 = width*height */
  depth: Uint8Array;
  /** 전경 마스크(0~255), 길이 = width*height */
  mask: Uint8Array;
  width: number;
  height: number;
  /** 깊이 → z 배율 */
  depthScale: number;
  /** 전경 판정 임계값(0~255) */
  alphaThreshold: number;
  /** 깊이 반전(모델에 따라 가까움/멂이 뒤집힐 때) */
  invert: boolean;
  /** Edge-preserving surface cleanup passes (0-3). */
  smoothingPasses?: number;
  /** Silhouette-derived back volume (0 keeps a flat back). */
  silhouetteBulge?: number;
}

const BACK_COLOR: [number, number, number] = [0.13, 0.15, 0.22];

/**
 * 깊이 맵을 앞면으로, 실루엣 거리장으로 부풀린 뒤판을 붙이고, 실루엣을 따라 옆벽(스커트)을
 * 세워 **닫힌(watertight) 입체 메쉬**를 만든다. 360° 어느 각도에서도 꽉 찬 3D 이며
 * OBJ/STL/GLB 로 그대로 내보낼 수 있다.
 *
 * 품질 향상:
 *  - 전경(사람) 영역의 깊이를 min~max 로 재정규화 → 부조가 뚜렷해짐
 *  - 정점을 공유하는 인덱스 지오메트리 → 노멀이 평균화되어 표면이 매끈해짐
 */
export function buildSolidRelief(opts: ReliefOptions): THREE.BufferGeometry {
  const {
    color,
    depth,
    mask,
    width: w,
    height: h,
    depthScale,
    alphaThreshold,
    invert,
    smoothingPasses = 1,
    silhouetteBulge = 0.65,
  } = opts;

  const cell = 20 / Math.max(w, h);
  const ox = (-w * cell) / 2;
  const oy = (h * cell) / 2;
  const backBase = -Math.max(0.45, depthScale * 0.1);

  const idx = (x: number, y: number): number => y * w + x;
  const isFg = (x: number, y: number): boolean => mask[idx(x, y)] >= alphaThreshold;

  // Identity Volume: 경계를 넘지 않는 범위에서 국소 깊이 노이즈를 완화(엣지 보존 스무딩)
  let filteredDepth = new Float32Array(depth.length);
  for (let i = 0; i < depth.length; i++) filteredDepth[i] = depth[i] / 255;

  // 디스파이크: 3x3 메디안으로 고립된 아웃라이어(화살처럼 치솟는 픽셀) 제거
  {
    const nb: number[] = [];
    const med = new Float32Array(filteredDepth);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!isFg(x, y)) continue;
        nb.length = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || !isFg(nx, ny)) continue;
            nb.push(filteredDepth[idx(nx, ny)]);
          }
        nb.sort((a, b) => a - b);
        med[idx(x, y)] = nb[nb.length >> 1];
      }
    filteredDepth = med;
  }

  for (let pass = 0; pass < Math.max(0, Math.min(3, smoothingPasses)); pass++) {
    const next = new Float32Array(filteredDepth);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        if (!isFg(x, y)) continue;
        const center = filteredDepth[idx(x, y)];
        let sum = center;
        let count = 1;
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (!isFg(nx, ny)) continue;
          const value = filteredDepth[idx(nx, ny)];
          if (Math.abs(value - center) < 0.12) {
            sum += value;
            count++;
          }
        }
        next[idx(x, y)] = sum / count;
      }
    filteredDepth = next;
  }

  // 전경 깊이를 백분위(2%~98%)로 재정규화 → 남은 극단값이 스케일을 왜곡하지 않음
  const fgValues: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (isFg(x, y)) fgValues.push(filteredDepth[idx(x, y)]);
    }
  fgValues.sort((a, b) => a - b);
  const dMin = fgValues.length ? fgValues[Math.floor(fgValues.length * 0.02)] : 0;
  const dMax = fgValues.length ? fgValues[Math.floor(fgValues.length * 0.98)] : 1;
  const dRange = Math.max(1e-4, dMax - dMin);

  // 실루엣 거리장(두 번 스캔): 평평한 판 대신 가장자리에서 안쪽으로 갈수록 부푸는 뒤판
  const edgeDistance = new Float32Array(w * h);
  for (let i = 0; i < edgeDistance.length; i++) edgeDistance[i] = isFg(i % w, Math.floor(i / w)) ? 9999 : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (!edgeDistance[i]) continue;
      edgeDistance[i] = Math.min(edgeDistance[i], x ? edgeDistance[idx(x - 1, y)] + 1 : 1, y ? edgeDistance[idx(x, y - 1)] + 1 : 1);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = idx(x, y);
      if (!edgeDistance[i]) continue;
      edgeDistance[i] = Math.min(edgeDistance[i], x < w - 1 ? edgeDistance[idx(x + 1, y)] + 1 : 1, y < h - 1 ? edgeDistance[idx(x, y + 1)] + 1 : 1);
    }

  const frontZ = (x: number, y: number): number => {
    let d = (filteredDepth[idx(x, y)] - dMin) / dRange; // 전경 정규화
    d = d < 0 ? 0 : d > 1 ? 1 : d; // 백분위 밖은 클램프 → 스파이크 방지
    if (invert) d = 1 - d;
    return d * depthScale;
  };

  const worldX = (x: number): number => ox + x * cell;
  const worldY = (y: number): number => oy - y * cell;

  const frontPos = (x: number, y: number): [number, number, number] => [worldX(x), worldY(y), frontZ(x, y)];
  const backPos = (x: number, y: number): [number, number, number] => {
    const normalized = Math.min(1, edgeDistance[idx(x, y)] / 14);
    return [worldX(x), worldY(y), backBase - normalized * depthScale * Math.max(0, silhouetteBulge) * 0.36];
  };

  // 픽셀 색은 sRGB → 선형색으로 변환(변환 안 하면 색이 하얗게 날아감)
  const tmpColor = new THREE.Color();
  const rgb = (x: number, y: number): [number, number, number] => {
    const i = idx(x, y) * 4;
    tmpColor.setRGB(color[i] / 255, color[i + 1] / 255, color[i + 2] / 255, THREE.SRGBColorSpace);
    return [tmpColor.r, tmpColor.g, tmpColor.b];
  };

  // ---- 인덱스 공유 지오메트리(정점 재사용 → 매끈한 노멀) ----
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let vcount = 0;
  const frontIndex = new Int32Array(w * h).fill(-1);
  const backIndex = new Int32Array(w * h).fill(-1);

  const addVertex = (p: [number, number, number], c: [number, number, number]): number => {
    positions.push(p[0], p[1], p[2]);
    colors.push(c[0], c[1], c[2]);
    return vcount++;
  };
  const frontV = (x: number, y: number): number => {
    const k = idx(x, y);
    if (frontIndex[k] < 0) frontIndex[k] = addVertex(frontPos(x, y), rgb(x, y));
    return frontIndex[k];
  };
  const backV = (x: number, y: number): number => {
    const k = idx(x, y);
    if (backIndex[k] < 0) backIndex[k] = addVertex(backPos(x, y), BACK_COLOR);
    return backIndex[k];
  };
  const face = (a: number, b: number, c: number): void => {
    indices.push(a, b, c);
  };

  const cellSolid = (cx: number, cy: number): boolean => {
    if (cx < 0 || cy < 0 || cx >= w - 1 || cy >= h - 1) return false;
    return isFg(cx, cy) && isFg(cx + 1, cy) && isFg(cx + 1, cy + 1) && isFg(cx, cy + 1);
  };

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      if (!cellSolid(x, y)) continue;

      // 앞면
      const a = frontV(x, y);
      const b = frontV(x + 1, y);
      const c = frontV(x + 1, y + 1);
      const d = frontV(x, y + 1);
      face(a, c, b);
      face(a, d, c);

      // 뒤판(반대 방향)
      const ab = backV(x, y);
      const bb = backV(x + 1, y);
      const cb = backV(x + 1, y + 1);
      const db = backV(x, y + 1);
      face(ab, bb, cb);
      face(ab, cb, db);

      // 옆벽(스커트): 이웃 셀이 비었으면 실루엣 경계 → 앞↔뒤 연결
      if (!cellSolid(x, y - 1)) {
        face(a, b, bb);
        face(a, bb, ab);
      }
      if (!cellSolid(x, y + 1)) {
        face(d, db, cb);
        face(d, cb, c);
      }
      if (!cellSolid(x - 1, y)) {
        face(a, ab, db);
        face(a, db, d);
      }
      if (!cellSolid(x + 1, y)) {
        face(b, c, cb);
        face(b, cb, bb);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (positions.length > 0) geometry.center(); // 원점 기준 정렬 → 회전축 중심 맞춤
  return geometry;
}
