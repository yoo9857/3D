import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SharedEnv } from './types';

/** 조명/카메라 기본값 — 모드 전환 시 이 값으로 리셋됩니다. */
const DEFAULTS = {
  cameraPos: new THREE.Vector3(8, 7, 12),
  target: new THREE.Vector3(0, 2, 0),
  ambient: 0.5,
  keyIntensity: 1.0,
  keyPos: new THREE.Vector3(10, 16, 8),
} as const;

type FrameCallback = (dt: number, elapsed: number) => void;

/**
 * 3D 무대 전체를 소유하는 클래스.
 * 씬·카메라·렌더러·컨트롤·공용 조명·바닥/그리드를 만들고
 * 렌더 루프와 리사이즈를 관리합니다.
 */
export class SceneManager {
  readonly env: SharedEnv;

  private readonly clock = new THREE.Clock();
  private frameCallback: FrameCallback | null = null;
  private running = false;
  private readonly onResize: () => void;

  constructor(container: HTMLElement) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f1a);
    scene.fog = new THREE.Fog(0x0b0f1a, 30, 90);

    const camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      500,
    );
    camera.position.copy(DEFAULTS.cameraPos);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.copy(DEFAULTS.target);

    // ----- 공용 조명 -----
    const ambient = new THREE.AmbientLight(0xffffff, DEFAULTS.ambient);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, DEFAULTS.keyIntensity);
    key.position.copy(DEFAULTS.keyPos);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 60;
    key.shadow.camera.left = -25;
    key.shadow.camera.right = 25;
    key.shadow.camera.top = 25;
    key.shadow.camera.bottom = -25;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
    fill.position.set(-8, 5, -10);
    scene.add(fill);

    // ----- 바닥 + 그리드 -----
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0x141a2b, roughness: 0.95, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(80, 40, 0x2a3550, 0x1a2338);
    scene.add(grid);

    this.env = {
      scene,
      camera,
      renderer,
      controls,
      lights: { ambient, key, fill },
      ground,
      grid,
    };

    this.onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', this.onResize);
  }

  /** 매 프레임 실행할 콜백(활성 모드의 update)을 등록 */
  onFrame(cb: FrameCallback): void {
    this.frameCallback = cb;
  }

  /** 모드 전환 시 조명·카메라·바닥을 기본 상태로 되돌립니다. */
  resetEnv(): void {
    const { lights, ground, grid, renderer, controls } = this.env;
    lights.ambient.intensity = DEFAULTS.ambient;
    lights.key.intensity = DEFAULTS.keyIntensity;
    lights.key.position.copy(DEFAULTS.keyPos);
    ground.visible = true;
    grid.visible = true;
    renderer.shadowMap.enabled = true;
    controls.target.copy(DEFAULTS.target);
    controls.autoRotate = false;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();

    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05); // 탭 비활성 후 튐 방지
      const elapsed = this.clock.elapsedTime;
      this.frameCallback?.(dt, elapsed);
      this.env.controls.update();
      this.env.renderer.render(this.env.scene, this.env.camera);
    };
    loop();
  }

  dispose(): void {
    this.running = false;
    window.removeEventListener('resize', this.onResize);
    this.env.controls.dispose();
    this.env.renderer.dispose();
  }
}
