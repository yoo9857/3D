import * as THREE from 'three';
import type { Mode, ModeContext } from '../core/types';
import { DEG2RAD } from '../utils/math';

/**
 * 행렬 · 벡터 변환.
 * 정점(벡터)에 4×4 변환 행렬을 곱해 이동·회전·크기변환을 표현하고,
 * 그 행렬을 실시간 숫자로 보여줍니다.
 */
export class TransformMode implements Mode {
  readonly id = 'transform';
  readonly title = '행렬·벡터 변환';

  private cube: THREE.Mesh | null = null;

  enter(ctx: ModeContext): void {
    const { track, panel } = ctx;

    const materials = [0x5aa9ff, 0xff7ac6, 0x7d5bff, 0x5be3a0, 0xffcf5b, 0xff6b6b].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.2 }),
    );
    const cube = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), materials);
    cube.castShadow = true;
    cube.position.y = 2;
    cube.matrixAutoUpdate = false; // 직접 행렬을 조립해 표시
    this.cube = cube;
    track(cube);

    // 원본 위치를 나타내는 반투명 와이어프레임
    const ghost = new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, 3),
      new THREE.MeshBasicMaterial({ color: 0x5aa9ff, wireframe: true, transparent: true, opacity: 0.15 }),
    );
    ghost.position.y = 2;
    track(ghost);

    const axes = new THREE.AxesHelper(6);
    axes.position.y = 0.02;
    track(axes);

    const state = { tx: 0, ty: 2, tz: 0, rx: 0, ry: 0, rz: 0, s: 1 };

    panel.section(
      this.title,
      '3D의 모든 점(정점)은 <b>벡터</b>입니다. 4×4 <b>변환 행렬</b>을 벡터에 곱하면 이동·회전·크기변환이 한 번에 계산됩니다. 슬라이더를 움직이면 아래 행렬이 실시간으로 바뀝니다.',
      'v′ = M · v<br>(M = 이동 × 회전 × 크기)',
    );

    const matDisplay = { set: (_: string) => {} };

    const apply = (): void => {
      const c = this.cube;
      if (!c) return;
      c.position.set(state.tx, state.ty, state.tz);
      c.rotation.set(state.rx * DEG2RAD, state.ry * DEG2RAD, state.rz * DEG2RAD);
      c.scale.setScalar(state.s);
      c.updateMatrix();

      // three.js 행렬은 열 우선(column-major). 사람이 읽는 행 우선으로 재배열.
      const e = c.matrix.elements;
      let text = '';
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          const v = e[col * 4 + row];
          text += (v >= 0 ? ' ' : '') + v.toFixed(2) + '  ';
        }
        text += '\n';
      }
      matDisplay.set(text);
    };

    panel.slider({ label: '이동 X', min: -8, max: 8, value: 0, onInput: (v) => ((state.tx = v), apply()) });
    panel.slider({ label: '이동 Y', min: 0, max: 8, value: 2, onInput: (v) => ((state.ty = v), apply()) });
    panel.slider({ label: '이동 Z', min: -8, max: 8, value: 0, onInput: (v) => ((state.tz = v), apply()) });
    panel.slider({ label: '회전 X', min: 0, max: 360, value: 0, step: 1, format: (v) => `${v}°`, onInput: (v) => ((state.rx = v), apply()) });
    panel.slider({ label: '회전 Y', min: 0, max: 360, value: 0, step: 1, format: (v) => `${v}°`, onInput: (v) => ((state.ry = v), apply()) });
    panel.slider({ label: '회전 Z', min: 0, max: 360, value: 0, step: 1, format: (v) => `${v}°`, onInput: (v) => ((state.rz = v), apply()) });
    panel.slider({ label: '크기', min: 0.3, max: 2.5, value: 1, onInput: (v) => ((state.s = v), apply()) });

    Object.assign(matDisplay, panel.matrix('현재 변환 행렬 M'));
    apply();
  }

  exit(): void {
    this.cube = null;
  }
}
