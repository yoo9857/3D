import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Mode, ModeContext } from '../core/types';
import { VisionClient } from '../vision/VisionClient';
import { generate3D } from '../vision/generate3d';
import type { ReconstructionResult } from '../vision/types';
import { buildSolidRelief } from '../geometry/reliefMesh';
import { exportGLB, exportOBJ, exportSTL } from '../utils/exporters';
import { showError } from '../utils/errors';

/**
 * AI 인물 3D.
 * 사진 → (배경 제거 + 깊이 추정) → 닫힌 입체 메쉬 → 360° 완전 3D.
 * 결과를 OBJ/STL/GLB 로 내보낼 수 있습니다.
 */
export class PersonMode implements Mode {
  readonly id = 'person';
  readonly title = 'AI 인물 3D';

  private vision: VisionClient | null = null;
  private container: THREE.Group | null = null;
  private mesh: THREE.Mesh | null = null;
  private serverObject: THREE.Object3D | null = null;
  private serverMode = false;
  private serverEndpoint = 'http://localhost:8000/generate?mode=identity&mc=384';
  private material: THREE.MeshStandardMaterial | null = null;

  private lastImage: HTMLImageElement | null = null;
  private lastFile: Blob | null = null;
  private lastColor: Uint8ClampedArray | null = null;
  private lastResult: ReconstructionResult | null = null;

  private depthScale = 6;
  private resolution = 192;
  private removeBackground = true;
  private invert = false;
  private busy = false;

  private statusEl: { set: (t: string) => void } | null = null;
  private exports: { setEnabledAll: (v: boolean) => void } | null = null;
  private depthCanvas: HTMLCanvasElement | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private alphaThreshold = 128;
  private smoothingPasses = 1;
  private silhouetteBulge = 0.65;

  enter(ctx: ModeContext): void {
    const { track, panel, env, onExit } = ctx;

    env.ground.visible = false;
    env.grid.visible = false;
    env.controls.target.set(0, 0, 0);
    env.controls.autoRotate = true;
    env.controls.autoRotateSpeed = 1.6;

    this.vision = new VisionClient();
    onExit(() => this.vision?.dispose());

    this.container = new THREE.Group();
    track(this.container);

    panel.buttonGroup({
      buttons: [
        { id: 'depth', label: 'AI 깊이(브라우저)' },
        { id: 'server', label: 'Full 3D 서버' },
      ],
      active: this.serverMode ? 'server' : 'depth',
      onSelect: (id) => {
        this.serverMode = id === 'server';
        this.statusEl?.set(this.serverMode ? 'Full 3D 서버 모드: 사진을 다시 선택하세요.' : '브라우저 깊이 모드: 사진을 다시 선택하세요.');
      },
    });

    panel.section(
      this.title,
      '사진에서 <b>AI가 깊이(거리)를 추정</b>하고 <b>배경을 제거</b>해, 사람을 실제 입체로 세웁니다. 앞·뒤·옆이 모두 닫힌 3D 메쉬라 360° 어디서 봐도 입체이며, <b>OBJ/STL/GLB</b> 로 내보낼 수 있습니다.',
    );

    panel.uploadButton({
      label: '📁 인물 사진 선택 (PNG/JPG)',
      accept: 'image/*',
      onFile: (file) => this.loadFile(file),
    });

    this.statusEl = panel.status('사진을 올리면 AI가 3D로 재구성합니다. (최초 1회 모델 다운로드에 시간이 걸립니다)');

    // 진단용 미리보기: 깊이 맵 + 사람 마스크
    const previewRow = document.createElement('div');
    previewRow.className = 'preview-row';
    const makePreview = (caption: string): HTMLCanvasElement => {
      const box = document.createElement('div');
      box.className = 'preview-box';
      const cap = document.createElement('div');
      cap.className = 'preview-cap';
      cap.textContent = caption;
      const canvas = document.createElement('canvas');
      canvas.className = 'preview';
      box.append(cap, canvas);
      previewRow.appendChild(box);
      return canvas;
    };
    this.depthCanvas = makePreview('깊이(밝을수록 가까움)');
    this.maskCanvas = makePreview('사람 마스크(흰색=사람)');
    panel.element(previewRow);

    panel.toggle({
      label: '자동 회전 (360° 미리보기)',
      value: true,
      onChange: (v) => (env.controls.autoRotate = v),
    });

    panel.toggle({
      label: '배경 제거 (사람만 남기기)',
      value: this.removeBackground,
      onChange: (v) => {
        this.removeBackground = v;
        this.reprocess();
      },
    });

    panel.slider({
      label: '깊이 강도',
      min: 1,
      max: 15,
      value: this.depthScale,
      step: 0.5,
      onInput: (v) => {
        this.depthScale = v;
        this.rebuildMesh(); // AI 재실행 없이 메쉬만 갱신 (가벼움)
      },
    });

    panel.toggle({
      label: '깊이 반전 (앞뒤가 뒤집혔을 때)',
      value: this.invert,
      onChange: (v) => {
        this.invert = v;
        this.rebuildMesh();
      },
    });

    panel.slider({
      label: '마스크 임계값 (사람/배경 경계)',
      min: 20,
      max: 240,
      value: this.alphaThreshold,
      step: 1,
      format: (v) => String(Math.round(v)),
      onInput: (v) => {
        this.alphaThreshold = Math.round(v);
        this.rebuildMesh();
        this.drawPreviews();
      },
    });

    panel.slider({
      label: '해상도(정밀도)',
      min: 96,
      max: 256,
      value: this.resolution,
      step: 8,
      format: (v) => String(Math.round(v)),
      onInput: (v) => {
        this.resolution = Math.round(v);
      },
    });

    panel.slider({
      label: 'Identity surface cleanup',
      min: 0,
      max: 3,
      value: this.smoothingPasses,
      step: 1,
      format: (v) => String(Math.round(v)),
      onInput: (v) => {
        this.smoothingPasses = Math.round(v);
        this.rebuildMesh();
      },
    });

    panel.slider({
      label: 'Identity silhouette volume',
      min: 0,
      max: 1.5,
      value: this.silhouetteBulge,
      step: 0.05,
      onInput: (v) => {
        this.silhouetteBulge = v;
        this.rebuildMesh();
      },
    });

    this.exports = panel.actions([
      { id: 'glb', label: 'GLB', onClick: () => this.doExport('glb') },
      { id: 'obj', label: 'OBJ', onClick: () => this.doExport('obj') },
      { id: 'stl', label: 'STL', onClick: () => this.doExport('stl') },
    ]);
    this.exports.setEnabledAll(false);

    panel.hint(
      '깊이 강도·반전은 AI 재실행 없이 즉시 반영됩니다. 해상도를 바꾼 뒤에는 사진을 다시 올리거나 배경 토글을 눌러 재계산하세요. GLB는 색상까지, OBJ/STL은 형상만 저장합니다(STL은 3D 프린팅용).',
    );
  }

  private loadFile(file: File): void {
    if (!file.type.startsWith('image/')) {
      showError('이미지 파일이 아닙니다', `선택한 형식: ${file.type || '알 수 없음'}`);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      this.lastImage = img;
      this.lastFile = file;
      this.reprocess();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showError('이미지를 불러오지 못했습니다', '파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.');
    };
    img.src = url;
  }

  /** 원본 이미지를 작업 해상도로 읽어 AI 파이프라인 실행 */
  private reprocess(): void {
    if (!this.lastImage || !this.vision) return;
    if (this.busy) {
      this.statusEl?.set('아직 처리 중입니다. 잠시만 기다려 주세요…');
      return;
    }

    const img = this.lastImage;
    const scale = Math.min(1, this.resolution / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    if (!cx) {
      showError('캔버스를 초기화할 수 없습니다', '브라우저가 2D 캔버스를 지원하지 않습니다.');
      return;
    }
    cx.drawImage(img, 0, 0, w, h);

    let color: Uint8ClampedArray;
    try {
      color = cx.getImageData(0, 0, w, h).data;
    } catch (err) {
      showError('픽셀을 읽을 수 없습니다', err instanceof Error ? err.message : String(err));
      return;
    }
    this.lastColor = color;

    if (this.serverMode && this.lastFile) {
      this.runServer(this.lastFile);
      return;
    }
    // Switching back to the browser depth path must not leave the previous
    // server GLB in the scene (otherwise exports contain two characters).
    if (this.serverObject) {
      this.container?.remove(this.serverObject);
      this.serverObject.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          const material = node.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      this.serverObject = null;
    }

    this.busy = true;
    this.exports?.setEnabledAll(false);
    this.statusEl?.set('AI 처리 시작…');

    this.vision
      .reconstruct(color, w, h, this.removeBackground, (phase) => this.statusEl?.set(`⏳ ${phase}`))
      .then((result) => {
        this.lastResult = result;
        this.rebuildMesh();
        this.drawPreviews();
        const extra = result.notes.length ? ` · ⚠️ ${result.notes.join(' / ')}` : '';
        this.statusEl?.set(`✅ 완료 (${result.width}×${result.height})${extra}`);
        this.exports?.setEnabledAll(true);
      })
      .catch((err: unknown) => {
        showError('AI 3D 재구성 실패', err instanceof Error ? err.message : String(err));
        this.statusEl?.set('❌ 실패했습니다. 콘솔을 확인하세요.');
      })
      .finally(() => {
        this.busy = false;
      });
  }

  /** 단일 깊이맵 대신 TripoSR(또는 서버가 연결한 최신 모델)의 완전한 GLB를 사용한다. */
  private runServer(image: Blob): void {
    if (this.busy || !this.container) return;
    this.busy = true;
    this.exports?.setEnabledAll(false);
    generate3D(image, { endpoint: this.serverEndpoint, onProgress: (m) => this.statusEl?.set(m) })
      .then((buffer) => new Promise<THREE.Object3D>((resolve, reject) => {
        new GLTFLoader().parse(buffer, '', (gltf) => resolve(gltf.scene), reject);
      }))
      .then((object) => {
        if (this.serverObject) this.container?.remove(this.serverObject);
        if (this.mesh) { this.container?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
        object.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
        this.serverObject = object;
        this.container?.add(object);
        this.exports?.setEnabledAll(true);
        this.statusEl?.set('Full 3D 서버 생성 완료');
      })
      .catch((err: unknown) => showError('Full 3D 서버 생성 실패', err instanceof Error ? err.message : String(err)))
      .finally(() => { this.busy = false; });
  }

  /** 기존 깊이·마스크로 메쉬만 다시 생성(AI 재실행 없음) */
  private rebuildMesh(): void {
    if (!this.lastResult || !this.lastColor || !this.container) return;

    const geometry = buildSolidRelief({
      color: this.lastColor,
      depth: this.lastResult.depth,
      mask: this.lastResult.mask,
      width: this.lastResult.width,
      height: this.lastResult.height,
      depthScale: this.depthScale,
      alphaThreshold: this.alphaThreshold,
      invert: this.invert,
      smoothingPasses: this.smoothingPasses,
      silhouetteBulge: this.silhouetteBulge,
    });

    if (geometry.getAttribute('position').count === 0) {
      this.statusEl?.set('⚠️ 전경(사람)을 찾지 못했습니다. 배경 제거를 끄거나 다른 사진을 사용해 보세요.');
    }

    if (!this.material) {
      this.material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.7,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
    }

    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geometry;
    } else {
      this.mesh = new THREE.Mesh(geometry, this.material);
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = true;
      this.container.add(this.mesh);
    }
  }

  /** 깊이 맵과 마스크(임계값 반영)를 썸네일로 그려 진단을 돕는다 */
  private drawPreviews(): void {
    const result = this.lastResult;
    if (!result || !this.depthCanvas || !this.maskCanvas) return;
    const { depth, mask, width: w, height: h } = result;

    const draw = (canvas: HTMLCanvasElement, render: (i: number) => [number, number, number]): void => {
      canvas.width = w;
      canvas.height = h;
      const cx = canvas.getContext('2d');
      if (!cx) return;
      const img = cx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const [r, g, b] = render(i);
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
    };

    draw(this.depthCanvas, (i) => [depth[i], depth[i], depth[i]]);
    // 마스크: 임계값 이상은 초록(사람), 미만은 어두움 → 경계 확인 용이
    draw(this.maskCanvas, (i) => (mask[i] >= this.alphaThreshold ? [90, 227, 160] : [20, 24, 40]));
  }

  private doExport(kind: 'glb' | 'obj' | 'stl'): void {
    const object = this.serverObject ?? this.mesh;
    if (!object) return;
    if (kind === 'glb') exportGLB(object, 'person-3d.glb');
    else if (kind === 'obj') exportOBJ(object, 'person-3d.obj');
    else exportSTL(object, 'person-3d.stl');
  }

  exit(): void {
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.vision = null;
    this.container = null;
    this.mesh = null;
    this.serverObject = null;
    this.material = null;
    this.lastImage = null;
    this.lastFile = null;
    this.lastColor = null;
    this.lastResult = null;
    this.statusEl = null;
    this.exports = null;
    this.depthCanvas = null;
    this.maskCanvas = null;
    this.busy = false;
  }
}
