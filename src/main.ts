import './styles/main.css';

import { SceneManager } from './core/SceneManager';
import { ModeManager } from './core/ModeManager';
import { Panel } from './ui/Panel';
import { Tabs } from './ui/Tabs';
import { installGlobalErrorHandlers, isWebGLAvailable, showError } from './utils/errors';

import { TransformMode } from './modes/TransformMode';
import { BezierMode } from './modes/BezierMode';
import { LightingMode } from './modes/LightingMode';
import { FluidMode } from './modes/FluidMode';
import { ImageMode } from './modes/ImageMode';
import { PersonMode } from './modes/PersonMode';
import { CharacterMode } from './modes/CharacterMode';
import { Generate3DMode } from './modes/Generate3DMode';

function requireEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`필수 DOM 요소를 찾을 수 없습니다: #${id}`);
  return el;
}

function main(): void {
  installGlobalErrorHandlers();

  if (!isWebGLAvailable()) {
    showError(
      'WebGL을 사용할 수 없습니다',
      '이 브라우저 또는 기기에서 3D 그래픽(WebGL)이 비활성화되어 있습니다. 최신 크롬/엣지/파이어폭스에서 열거나, 하드웨어 가속을 켜 주세요.',
    );
    return;
  }

  const appEl = requireEl('app');
  const tabsEl = requireEl('tabs');
  const panelEl = requireEl('panel');
  const loadingEl = requireEl('loading');

  const sceneManager = new SceneManager(appEl);
  const panel = new Panel(panelEl);
  const tabs = new Tabs(tabsEl);
  const modeManager = new ModeManager(sceneManager, panel, tabs);

  // 모드 등록 (탭 순서와 동일)
  modeManager
    .register(new TransformMode())
    .register(new BezierMode())
    .register(new LightingMode())
    .register(new FluidMode())
    .register(new ImageMode())
    .register(new PersonMode())
    .register(new CharacterMode())
    .register(new Generate3DMode());

  sceneManager.onFrame((dt, elapsed) => modeManager.update(dt, elapsed));

  // 첫 모드 진입 후 렌더 시작
  modeManager.switchTo('transform');
  loadingEl.style.display = 'none';
  sceneManager.start();
}

main();
