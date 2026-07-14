import * as THREE from 'three';
import type { Mode, ModeContext } from '../core/types';
import { luminance } from '../utils/math';
import { showError, guard } from '../utils/errors';

type Style = 'column' | 'point';

interface PixelData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * 2D 이미지 → 3D.
 * 업로드한 이미지의 모든 픽셀을 읽어 (x, y) 위치에 배치하고,
 * 밝기를 높이(z)로 바꿔 입체로 세웁니다. 원래 색상은 그대로 유지됩니다.
 */
export class ImageMode implements Mode {
  readonly id = 'image';
  readonly title = '2D → 3D 이미지';

  private container: THREE.Group | null = null;
  private lastImage: HTMLImageElement | null = null;

  private style: Style = 'column';
  private depth = 4;
  private resolution = 96;

  /** 현재 메쉬의 높이만 다시 계산(전체 재생성 없이) */
  private applyHeights: (() => void) | null = null;

  enter(ctx: ModeContext): void {
    const { track, panel, env } = ctx;

    // 이 모드에선 바닥/그리드가 방해되므로 숨김 (exit 시 resetEnv 가 복구)
    env.ground.visible = false;
    env.grid.visible = false;
    env.controls.target.set(0, 0, 0);

    const container = new THREE.Group();
    this.container = container;
    track(container);

    panel.section(
      this.title,
      '사진의 <b>모든 픽셀</b>을 읽어 (x, y) 위치에 배치하고, <b>밝기</b>만큼 <b>두께(부피)</b>를 준 기둥으로 세웁니다. 각 기둥은 앞뒤로 뻗은 실제 부피를 가지므로 <b>360° 어느 각도에서도 입체</b>로 보입니다. 원래 색상은 그대로 유지됩니다.',
    );

    panel.uploadButton({
      label: '📁 이미지 파일 선택 (PNG/JPG)',
      accept: 'image/*',
      onFile: (file) => this.loadFile(file),
    });

    panel.buttonGroup({
      buttons: [
        { id: 'column', label: '🧱 입체(기둥)' },
        { id: 'point', label: '✨ 포인트' },
      ],
      active: 'column',
      onSelect: (id) => {
        this.style = id as Style;
        this.rebuild();
      },
    });

    // 회전시켜 입체감을 바로 확인할 수 있도록 자동 회전 제공
    env.controls.autoRotate = true;
    env.controls.autoRotateSpeed = 1.8;
    panel.toggle({
      label: '자동 회전 (360° 미리보기)',
      value: true,
      onChange: (v) => (env.controls.autoRotate = v),
    });

    panel.slider({
      label: '높이 강조 (밝기→깊이)',
      min: 0,
      max: 12,
      value: this.depth,
      step: 0.1,
      onInput: (v) => {
        this.depth = v;
        // 높이만 갱신 (가벼움). 없으면 전체 재생성.
        if (this.applyHeights) this.applyHeights();
        else this.rebuild();
      },
    });

    panel.slider({
      label: '해상도',
      min: 32,
      max: 160,
      value: this.resolution,
      step: 1,
      format: (v) => String(Math.round(v)),
      onInput: (v) => {
        this.resolution = Math.round(v);
        this.rebuild();
      },
    });

    panel.hint(
      '‘입체(기둥)’은 픽셀을 부피 있는 막대로 세워 360° 어느 각도에서도 꽉 찬 3D로 보입니다. ‘포인트’는 가벼운 점 표현입니다. 높이 강조를 0으로 두면 원본에 가까운 얇은 판이 됩니다. 해상도가 높을수록 정밀하지만 무거워집니다.',
    );

    // 시작 시 데모용 그라디언트 이미지 표시
    this.loadDemoImage();
  }

  /** 파일 → 이미지 로드 (에러 처리 포함) */
  private loadFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      showError('이미지 파일이 아닙니다', `선택한 파일 형식: ${file.type || '알 수 없음'}`);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      this.lastImage = img;
      this.rebuild();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showError('이미지를 불러오지 못했습니다', '파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.');
    };
    img.src = url;
  }

  private loadDemoImage(): void {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const cx = cv.getContext('2d');
    if (!cx) return;
    const grad = cx.createLinearGradient(0, 0, 64, 64);
    grad.addColorStop(0, '#5aa9ff');
    grad.addColorStop(0.5, '#ff7ac6');
    grad.addColorStop(1, '#ffcf5b');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, 64, 64);
    cx.fillStyle = '#0b0f1a';
    cx.font = 'bold 22px sans-serif';
    cx.textAlign = 'center';
    cx.fillText('3D', 32, 40);

    const img = new Image();
    img.onload = () => {
      this.lastImage = img;
      this.rebuild();
    };
    img.src = cv.toDataURL();
  }

  /** 이미지를 지정 해상도로 축소해 픽셀 데이터를 읽음 */
  private readPixels(img: HTMLImageElement): PixelData | null {
    const max = this.resolution;
    const scale = Math.min(max / img.width, max / img.height, 1);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    if (!cx) {
      showError('캔버스를 초기화할 수 없습니다', '브라우저가 2D 캔버스를 지원하지 않습니다.');
      return null;
    }
    cx.drawImage(img, 0, 0, w, h);
    try {
      const { data } = cx.getImageData(0, 0, w, h);
      return { data, width: w, height: h };
    } catch (err) {
      // 교차 출처(CORS) 이미지 등에서 발생 가능
      showError('픽셀을 읽을 수 없습니다', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /** 현재 이미지·설정으로 3D 표현을 새로 생성 */
  private rebuild(): void {
    if (!this.lastImage || !this.container) return;
    guard('이미지 3D 변환', () => {
      this.clearContainer();
      this.applyHeights = null;

      const px = this.readPixels(this.lastImage!);
      if (!px) return;

      if (this.style === 'column') {
        this.buildColumns(px);
      } else {
        this.buildPoints(px);
      }
    });
  }

  private clearContainer(): void {
    const c = this.container;
    if (!c) return;
    for (const child of [...c.children]) {
      c.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose());
    }
  }

  /**
   * 각 픽셀을 z축으로 뻗은 '기둥'으로 만든다.
   * 밝기가 곧 기둥의 두께(부피)이며, z=0 을 기준으로 앞뒤 대칭으로 뻗어
   * 정면·측면·후면 어느 각도에서도 꽉 찬 입체로 보인다.
   */
  private buildColumns(px: PixelData): void {
    const { data, width: w, height: h } = px;
    const cell = 20 / Math.max(w, h); // 전체 폭 ~20 유지
    const ox = (-w * cell) / 2;
    const oy = (h * cell) / 2;

    // 단위 깊이(z=1) 박스를 픽셀마다 z로 스케일해 기둥을 만든다.
    const geo = new THREE.BoxGeometry(cell * 0.96, cell * 0.96, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 });
    const inst = new THREE.InstancedMesh(geo, mat, w * h);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.position.z = 0;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    const applyHeights = (): void => {
      // 두께가 0이 되어 구멍이 생기지 않도록 최소 두께를 보장
      const minThick = cell * 0.6;
      let idx = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = data[i] / 255;
          const g = data[i + 1] / 255;
          const b = data[i + 2] / 255;
          const a = data[i + 3] / 255;
          const lum = luminance(r, g, b);
          const thickness = minThick + lum * this.depth;
          dummy.position.set(ox + x * cell, oy - y * cell, 0); // z=0 중심 → 앞뒤 대칭
          dummy.scale.set(1, 1, a < 0.1 ? 0.001 : thickness); // 투명 픽셀은 사실상 숨김
          dummy.updateMatrix();
          inst.setMatrixAt(idx, dummy.matrix);
          inst.setColorAt(idx, color.setRGB(r, g, b));
          idx++;
        }
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    };

    applyHeights();
    this.applyHeights = applyHeights;
    this.container!.add(inst);
  }

  private buildPoints(px: PixelData): void {
    const { data, width: w, height: h } = px;
    const cell = 20 / Math.max(w, h);
    const ox = (-w * cell) / 2;
    const oy = (h * cell) / 2;

    const count = w * h;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const applyHeights = (): void => {
      let k = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = data[i] / 255;
          const g = data[i + 1] / 255;
          const b = data[i + 2] / 255;
          const lum = luminance(r, g, b);
          positions[k] = ox + x * cell;
          positions[k + 1] = oy - y * cell;
          positions[k + 2] = lum * this.depth - this.depth / 2;
          colors[k] = r;
          colors[k + 1] = g;
          colors[k + 2] = b;
          k += 3;
        }
      }
      geo.attributes.position.needsUpdate = true;
    };

    applyHeights();
    this.applyHeights = applyHeights;

    const mat = new THREE.PointsMaterial({ size: cell * 1.3, vertexColors: true, sizeAttenuation: true });
    this.container!.add(new THREE.Points(geo, mat));
  }

  exit(): void {
    this.container = null;
    this.lastImage = null;
    this.applyHeights = null;
  }
}
