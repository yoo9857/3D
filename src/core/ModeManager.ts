import type * as THREE from 'three';
import type { Mode, ModeContext } from './types';
import type { SceneManager } from './SceneManager';
import type { Panel } from '../ui/Panel';
import type { Tabs } from '../ui/Tabs';
import { disposeObject } from '../utils/dispose';
import { showError } from '../utils/errors';

/**
 * 모드 등록·전환·정리를 담당.
 * 각 모드가 track()/onExit() 으로 등록한 리소스를 전환 시 자동 해제하여
 * 메모리 누수 없이 안전하게 오갈 수 있습니다.
 */
export class ModeManager {
  private readonly modes = new Map<string, Mode>();
  private active: Mode | null = null;

  // 현재 모드가 등록한 정리 대상
  private tracked: THREE.Object3D[] = [];
  private cleanups: Array<() => void> = [];

  constructor(
    private readonly sceneManager: SceneManager,
    private readonly panel: Panel,
    private readonly tabs: Tabs,
  ) {}

  register(mode: Mode): this {
    this.modes.set(mode.id, mode);
    this.tabs.add(mode.id, mode.title, () => this.switchTo(mode.id));
    return this;
  }

  get activeId(): string | null {
    return this.active?.id ?? null;
  }

  /** 활성 모드로 매 프레임 전달 */
  update(dt: number, elapsed: number): void {
    this.active?.update?.(dt, elapsed);
  }

  switchTo(id: string): void {
    const mode = this.modes.get(id);
    if (!mode || this.active?.id === id) return;

    this.teardownActive();

    const { scene } = this.sceneManager.env;
    const ctx: ModeContext = {
      env: this.sceneManager.env,
      panel: this.panel,
      track: (obj) => {
        scene.add(obj);
        this.tracked.push(obj);
        return obj;
      },
      onExit: (fn) => {
        this.cleanups.push(fn);
      },
    };

    try {
      this.sceneManager.resetEnv();
      this.panel.clear();
      mode.enter(ctx);
      this.active = mode;
      this.tabs.setActive(id);
    } catch (err) {
      showError(`'${mode.title}' 모드를 여는 중 오류가 발생했습니다`, err instanceof Error ? err.stack ?? err.message : String(err));
      this.teardownActive();
    }
  }

  private teardownActive(): void {
    // 1) 모드 자체 exit
    try {
      this.active?.exit?.();
    } catch (err) {
      console.error('[Math3D] 모드 exit 오류', err);
    }
    // 2) 등록된 정리 콜백
    for (const fn of this.cleanups) {
      try {
        fn();
      } catch (err) {
        console.error('[Math3D] cleanup 오류', err);
      }
    }
    // 3) 추적 객체 제거 + GPU 해제
    const { scene } = this.sceneManager.env;
    for (const obj of this.tracked) {
      scene.remove(obj);
      disposeObject(obj);
    }
    this.tracked = [];
    this.cleanups = [];
    this.active = null;
  }
}
