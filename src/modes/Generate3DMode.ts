import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Mode, ModeContext } from '../core/types';
import { generate3D } from '../vision/generate3d';
import { VisionClient } from '../vision/VisionClient';
import type { ReconstructionResult } from '../vision/types';
import { buildSolidRelief } from '../geometry/reliefMesh';
import { exportGLB, exportOBJ, exportSTL } from '../utils/exporters';
import { showError } from '../utils/errors';

const LS_ENDPOINT = 'gen3d.endpoint';
const LS_KEY = 'gen3d.apiKey';
const TARGET_SIZE = 12;

type Method = 'ai' | 'server';

/**
 * Full 3D.
 *  - 방식 'ai'     : 브라우저에서 Depth Anything(깊이)+MODNet(배경제거)로 실제 깊이 기반 입체 생성(CPU)
 *  - 방식 'server' : 이미지를 생성 서버로 보내 GLB 수신(학습된 모델/GPU)
 *  - GLB/GLTF 파일 직접 열기도 지원. 결과는 360° 뷰 + OBJ/STL/GLB 내보내기.
 */
export class Generate3DMode implements Mode {
  readonly id = 'generate3d';
  readonly title = 'Full 3D (AI)';

  private container: THREE.Group | null = null;
  private loaded: THREE.Object3D | null = null;
  private readonly loader = new GLTFLoader();

  private vision: VisionClient | null = null;
  private aiMaterial: THREE.MeshStandardMaterial | null = null;
  private lastAI: ReconstructionResult | null = null;
  private lastColor: Uint8ClampedArray | null = null;

  // Prefer the real reconstruction backend when it is available.  The browser
  // depth worker remains useful as an offline/instant preview, but it cannot
  // hallucinate unseen surfaces and therefore should not be the default for a
  // mode labelled “Full 3D”.
  private method: Method = 'server';
  private endpoint = '';
  private apiKey = '';
  private busy = false;

  private depthScale = 7;
  private invert = false;
  private readonly workRes = 200;

  private statusEl: { set: (t: string) => void } | null = null;
  private exports: { setEnabledAll: (v: boolean) => void } | null = null;

  enter(ctx: ModeContext): void {
    const { track, panel, env, onExit } = ctx;
    env.controls.target.set(0, 3, 0);
    env.controls.autoRotate = false;
    env.controls.autoRotateSpeed = 1.4;

    this.container = new THREE.Group();
    track(this.container);

    // 이 모드 전용 부드러운 보조광(반구광): 스캔 색이 어둡게 묻히지 않도록 균일하게 밝힘.
    // 컨테이너에 넣어 모드 종료 시 함께 제거되고 다른 모드엔 영향 없다.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x404652, 0.7);
    this.container.add(hemi);
    // SSS preview lighting: a key/fill/rim rig prevents dark textured GLBs
    // from being mistaken for missing color or geometry.
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 8, 7);
    key.castShadow = true;
    this.container.add(key);
    const fill = new THREE.DirectionalLight(0x9bbcff, 1.0);
    fill.position.set(-6, 3, 4);
    this.container.add(fill);
    const rim = new THREE.DirectionalLight(0xffc6a5, 1.1);
    rim.position.set(0, 6, -8);
    this.container.add(rim);

    this.vision = new VisionClient();
    onExit(() => this.vision?.dispose());

    const savedEndpoint = localStorage.getItem(LS_ENDPOINT);
    // Migrate endpoints saved by older builds so Full 3D uses the local
    // Identity3D pipeline instead of silently falling back to plain TripoSR.
    this.endpoint = savedEndpoint
      ? (savedEndpoint.includes('mode=')
        ? (savedEndpoint.includes('mc=') ? savedEndpoint : `${savedEndpoint}&mc=384`)
        : `${savedEndpoint}${savedEndpoint.includes('?') ? '&' : '?'}mode=identity&mc=384`)
      : 'http://localhost:8000/generate?mode=identity&mc=384';
    localStorage.setItem(LS_ENDPOINT, this.endpoint);
    this.apiKey = localStorage.getItem(LS_KEY) ?? '';

    panel.section(
      this.title,
      '사진을 3D 로 만듭니다. <b>AI 깊이(CPU)</b> = 브라우저에서 실제 깊이를 추정해 얼굴/몸을 세움(배경 자동 제거). <b>서버</b> = 학습된 모델(GPU/클라우드) 호출. 결과는 360° 뷰 + OBJ/STL/GLB 저장.',
    );

    panel.buttonGroup({
      buttons: [
        { id: 'ai', label: '🧠 AI 깊이(CPU)' },
        { id: 'server', label: '☁ 서버' },
      ],
      active: this.method,
      onSelect: (id) => (this.method = id as Method),
    });

    panel.uploadButton({
      label: '📁 사진 선택 → 3D 생성',
      accept: 'image/*',
      onFile: (file) => this.onImage(file),
    });

    panel.uploadButton({
      label: '📦 GLB/GLTF 파일 직접 열기',
      accept: '.glb,.gltf,model/gltf-binary,model/gltf+json',
      onFile: (file) => this.loadModelFile(file),
    });

    this.statusEl = panel.status('방식을 고르고 사진을 올리세요. (AI 깊이는 최초 1회 모델 다운로드)');

    panel.slider({
      label: '깊이 강도 (AI)',
      min: 1,
      max: 15,
      value: this.depthScale,
      step: 0.5,
      onInput: (v) => {
        this.depthScale = v;
        this.rebuildAI();
      },
    });

    panel.toggle({
      label: '깊이 반전 (AI)',
      value: this.invert,
      onChange: (v) => {
        this.invert = v;
        this.rebuildAI();
      },
    });

    panel.toggle({ label: '자동 회전 (360°)', value: false, onChange: (v) => (env.controls.autoRotate = v) });

    // 서버 방식용 설정
    panel.textInput({
      label: '생성 서버 URL (서버 방식)',
      placeholder: 'http://localhost:8000/generate?mode=identity&mc=384',
      value: this.endpoint,
      onChange: (v) => {
        this.endpoint = v;
        localStorage.setItem(LS_ENDPOINT, v);
      },
    });
    panel.textInput({
      label: 'API 키 (선택)',
      placeholder: 'Bearer 토큰',
      value: this.apiKey,
      password: true,
      onChange: (v) => {
        this.apiKey = v;
        localStorage.setItem(LS_KEY, v);
      },
    });

    this.exports = panel.actions([
      { id: 'glb', label: 'GLB', onClick: () => this.doExport('glb') },
      { id: 'obj', label: 'OBJ', onClick: () => this.doExport('obj') },
      { id: 'stl', label: 'STL', onClick: () => this.doExport('stl') },
    ]);
    this.exports.setEnabledAll(false);

    panel.hint(
      'AI 깊이: 밝기가 아니라 실제 거리로 세워 얼굴이 정확합니다(CPU, 수초). 서버: server-node(로컬 CPU) 또는 GPU 모델. 깊이 강도·반전은 AI 결과에 즉시 반영됩니다.',
    );
  }

  private onImage(file: File): void {
    if (!file.type.startsWith('image/')) {
      showError('이미지 파일이 아닙니다', `선택한 형식: ${file.type || '알 수 없음'}`);
      return;
    }
    if (this.method === 'ai') this.runAI(file);
    else this.runServer(file);
  }

  // ---------- AI 깊이(브라우저 CPU) ----------
  private runAI(file: File): void {
    if (this.busy || !this.vision) {
      this.statusEl?.set('처리 중입니다…');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, this.workRes / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      if (!cx) {
        showError('캔버스 초기화 실패', '브라우저가 2D 캔버스를 지원하지 않습니다.');
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
      this.busy = true;
      this.exports?.setEnabledAll(false);
      this.vision!
        .reconstruct(color, w, h, true, (m) => this.statusEl?.set(`⏳ ${m}`))
        .then((result) => {
          this.lastAI = result;
          this.rebuildAI();
          const extra = result.notes.length ? ` · ⚠️ ${result.notes.join(' / ')}` : '';
          this.statusEl?.set(`✅ AI 깊이 완료 (${result.width}×${result.height})${extra}`);
        })
        .catch((err: unknown) => {
          showError('AI 깊이 생성 실패', err instanceof Error ? err.message : String(err));
          this.statusEl?.set('❌ 실패 — 콘솔 확인');
        })
        .finally(() => {
          this.busy = false;
        });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showError('이미지를 불러오지 못했습니다', '파일 손상 또는 미지원 형식일 수 있습니다.');
    };
    img.src = url;
  }

  private rebuildAI(): void {
    if (!this.lastAI || !this.lastColor) return;
    const geometry = buildSolidRelief({
      color: this.lastColor,
      depth: this.lastAI.depth,
      mask: this.lastAI.mask,
      width: this.lastAI.width,
      height: this.lastAI.height,
      depthScale: this.depthScale,
      alphaThreshold: 128,
      invert: this.invert,
      smoothingPasses: 1,
      silhouetteBulge: 0.65,
    });
    if (geometry.getAttribute('position').count === 0) {
      this.statusEl?.set('⚠️ 전경(사람)을 찾지 못했습니다. 다른 사진을 시도하세요.');
      return;
    }
    if (!this.aiMaterial) {
      this.aiMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide });
    }
    this.replaceModel(new THREE.Mesh(geometry, this.aiMaterial));
  }

  // ---------- 서버(학습된 모델/GPU) ----------
  private runServer(file: File): void {
    if (!this.endpoint) {
      showError('생성 서버 URL 이 필요합니다', '패널의 "생성 서버 URL" 을 입력하거나 AI 깊이 방식을 쓰세요.');
      return;
    }
    if (this.busy) {
      this.statusEl?.set('처리 중입니다…');
      return;
    }
    this.busy = true;
    this.exports?.setEnabledAll(false);
    generate3D(file, {
      endpoint: this.endpoint,
      apiKey: this.apiKey || undefined,
      onProgress: (m) => this.statusEl?.set(`⏳ ${m}`),
    })
      .then((buffer) => this.parseAndShow(buffer))
      .then(() => this.statusEl?.set('✅ 서버 생성 완료'))
      .catch((err: unknown) => {
        showError('서버 3D 생성 실패', err instanceof Error ? err.message : String(err));
        this.statusEl?.set('❌ 실패 — 서버 URL/응답 확인');
      })
      .finally(() => {
        this.busy = false;
      });
  }

  private loadModelFile(file: File): void {
    this.statusEl?.set('GLB/GLTF 읽는 중…');
    file
      .arrayBuffer()
      .then((buf) => this.parseAndShow(buf))
      .then(() => this.statusEl?.set(`✅ 로드 완료: ${file.name}`))
      .catch((err: unknown) => {
        showError('모델 파일을 열 수 없습니다', err instanceof Error ? err.message : String(err));
        this.statusEl?.set('❌ 로드 실패');
      });
  }

  private parseAndShow(buffer: ArrayBuffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.loader.parse(
        buffer,
        '',
        (gltf) => {
          try {
            this.replaceModel(gltf.scene);
            resolve();
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        },
        (err) => reject(err instanceof Error ? err : new Error(String((err as ErrorEvent)?.message ?? err))),
      );
    });
  }

  private replaceModel(object: THREE.Object3D): void {
    if (!this.container) return;
    if (this.loaded) {
      this.container.remove(this.loaded);
      disposeTree(this.loaded, this.aiMaterial);
      this.loaded = null;
    }

    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        // TripoSR/marching-cubes 메시는 면 winding 이 일부 뒤집혀 단면 재질이면
        // "내부가 비쳐 보임". 양면 렌더링으로 관통 현상을 없앤다.
        const colorAttr = m.geometry?.getAttribute('color') as THREE.BufferAttribute | undefined;
        if (colorAttr) convertColorAttrSRGBToLinear(colorAttr);
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) {
          mat.side = THREE.DoubleSide;
          const sm = mat as THREE.MeshStandardMaterial;
          // Embedded image textures are the authoritative appearance source.
          // Applying COLOR_0 on top of them can multiply colors to black or
          // produce quantized rainbow noise, so only use vertex colors when a
          // material has no texture map.
          if (sm.map) {
            sm.vertexColors = false;
            if (sm.color) sm.color.setRGB(1, 1, 1);
            sm.needsUpdate = true;
          } else if (colorAttr) {
            // trimesh COLOR_0 이 재질에 자동 연결 안 되는 경우가 있어 회색으로 보임 → 강제로 켠다.
            sm.vertexColors = true;
            if (sm.color) sm.color.setRGB(1, 1, 1); // baseColor 흰색 → 정점색 그대로 표현
            // 스캔 색을 충실히: 금속기 제거, 거칠게(하이라이트로 물빠지는 것 방지).
            if ('metalness' in sm) sm.metalness = 0;
            if ('roughness' in sm) sm.roughness = 0.9;
            sm.needsUpdate = true;
          }
        }
        // 노멀이 없으면 각지거나 뚫려 보임 → 없을 때만 계산.
        if (m.geometry && !m.geometry.getAttribute('normal')) m.geometry.computeVertexNormals();
      }
    });

    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = TARGET_SIZE / maxDim;

    const wrapper = new THREE.Group();
    object.position.sub(center);
    wrapper.add(object);
    wrapper.scale.setScalar(scale);
    wrapper.position.y = (size.y * scale) / 2 + 0.05;

    this.container.add(wrapper);
    this.loaded = wrapper;
    this.exports?.setEnabledAll(true);
  }

  private doExport(kind: 'glb' | 'obj' | 'stl'): void {
    if (!this.loaded) return;
    if (kind === 'glb') exportGLB(this.loaded, 'model.glb');
    else if (kind === 'obj') exportOBJ(this.loaded, 'model.obj');
    else exportSTL(this.loaded, 'model.stl');
  }

  exit(): void {
    if (this.loaded) disposeTree(this.loaded, this.aiMaterial);
    this.aiMaterial?.dispose();
    this.container = null;
    this.loaded = null;
    this.vision = null;
    this.aiMaterial = null;
    this.lastAI = null;
    this.lastColor = null;
    this.statusEl = null;
    this.exports = null;
    this.busy = false;
  }
}

/**
 * TripoSR 정점색은 입력 사진의 sRGB 값을 재현한 것인데, glTF COLOR_0 은 규약상 선형색으로
 * 해석돼 그대로 조명에 곱해지면 물빠지고 실제 색과 어긋난다(그리고 어둡게 보임).
 * relief 경로(reliefMesh.ts)와 동일하게 sRGB→선형 변환을 해줘야 색이 정확히 맞는다.
 */
function convertColorAttrSRGBToLinear(attr: THREE.BufferAttribute): void {
  const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const arr = attr.array as ArrayLike<number> & { [i: number]: number };
  const itemSize = attr.itemSize; // 3(RGB) 또는 4(RGBA)
  const count = attr.count;
  const mutable = arr as unknown as { [i: number]: number };
  for (let i = 0; i < count; i++) {
    const base = i * itemSize;
    mutable[base] = srgbToLinear(arr[base]);
    mutable[base + 1] = srgbToLinear(arr[base + 1]);
    mutable[base + 2] = srgbToLinear(arr[base + 2]);
    // 알파(있으면)는 그대로 둔다.
  }
  attr.needsUpdate = true;
}

/** 공유 재질(aiMaterial)은 제외하고 geometry/기타 재질만 해제 */
function disposeTree(obj: THREE.Object3D, keepMaterial: THREE.Material | null): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (mat) {
      const list = Array.isArray(mat) ? mat : [mat];
      list.forEach((m) => {
        if (m !== keepMaterial) m.dispose();
      });
    }
  });
}
