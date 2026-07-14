import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Panel } from '../ui/Panel';

/**
 * 모든 모드가 공유하는 3D 환경.
 * SceneManager 가 생성/소유하며, 모드 전환 시 기본값으로 리셋됩니다.
 */
export interface SharedEnv {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  lights: {
    ambient: THREE.AmbientLight;
    key: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
  };
  ground: THREE.Mesh;
  grid: THREE.GridHelper;
}

/**
 * 각 모드가 enter() 시점에 전달받는 컨텍스트.
 * track()/onExit() 으로 리소스를 등록하면 모드 종료 시 자동 정리됩니다.
 */
export interface ModeContext {
  env: SharedEnv;
  panel: Panel;
  /** 씬에 추가하고, 모드 종료 시 자동으로 제거·해제할 객체를 등록 */
  track: <T extends THREE.Object3D>(obj: T) => T;
  /** 모드 종료 시 실행할 정리 콜백을 등록 */
  onExit: (fn: () => void) => void;
}

/**
 * 하나의 데모(행렬 변환, 베지에 곡선 등)를 나타내는 인터페이스.
 * 모드는 상태를 필드로 보관하고 생명주기 메서드로 동작합니다.
 */
export interface Mode {
  readonly id: string;
  readonly title: string;
  /** 모드 진입: 객체 생성 및 패널 구성 */
  enter(ctx: ModeContext): void;
  /** 매 프레임 호출(선택). dt=프레임 간격(초), elapsed=경과 시간(초) */
  update?(dt: number, elapsed: number): void;
  /** 모드 종료(선택). track/onExit 로 등록하지 않은 추가 정리에 사용 */
  exit?(): void;
}
