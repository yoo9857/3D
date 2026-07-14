import * as THREE from 'three';
import type { Mode, ModeContext } from '../core/types';

/**
 * 베지에 곡선 애니메이션.
 * 매개변수 t(0→1)를 3차 베지에 방정식에 넣어 부드러운 경로를 만들고,
 * 물체가 그 위를 따라 움직입니다. 제어점 높이를 바꾸면 곡선이 변합니다.
 */
export class BezierMode implements Mode {
  readonly id = 'bezier';
  readonly title = '베지에 곡선';

  private curve: THREE.CubicBezierCurve3 | null = null;
  private ball: THREE.Mesh | null = null;
  private readout: { set: (t: string) => void } | null = null;
  private speed = 0.25;
  private t = 0;

  enter(ctx: ModeContext): void {
    const { track, panel } = ctx;

    const P = [
      new THREE.Vector3(-8, 0.5, -4),
      new THREE.Vector3(-3, 7, 4),
      new THREE.Vector3(4, 7, -4),
      new THREE.Vector3(8, 0.5, 4),
    ];
    const curve = new THREE.CubicBezierCurve3(P[0], P[1], P[2], P[3]);
    this.curve = curve;

    // 곡선을 관(tube)으로 렌더 — 제어점 변경 시 재생성
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x5aa9ff, emissive: 0x1a4a80, roughness: 0.3 });
    let tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.12, 8, false), tubeMat);
    tube.castShadow = true;
    track(tube);

    const rebuildTube = (): void => {
      tube.geometry.dispose();
      tube.geometry = new THREE.TubeGeometry(curve, 120, 0.12, 8, false);
    };

    // 제어점 구
    const cpColors = [0x5be3a0, 0xff7ac6, 0xffcf5b, 0x5be3a0];
    const cps = P.map((p, i) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 20, 20),
        new THREE.MeshStandardMaterial({ color: cpColors[i], emissive: cpColors[i], emissiveIntensity: 0.3 }),
      );
      m.position.copy(p);
      m.castShadow = true;
      track(m);
      return m;
    });

    // 제어 다각형(점선)
    const polyGeo = new THREE.BufferGeometry().setFromPoints(P);
    const poly = new THREE.Line(polyGeo, new THREE.LineDashedMaterial({ color: 0x556080, dashSize: 0.4, gapSize: 0.25 }));
    poly.computeLineDistances();
    track(poly);

    // 곡선을 따라 움직이는 물체
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0xff7ac6, emissive: 0xff2f9e, emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.3 }),
    );
    ball.castShadow = true;
    this.ball = ball;
    track(ball);

    panel.section(
      this.title,
      '직선으로는 자연스러운 움직임을 못 만듭니다. <b>매개변수 t(0→1)</b>를 곡선 방정식에 넣으면 부드러운 경로가 나옵니다. 초록=시작/끝점, 분홍·노랑=제어점입니다.',
      'B(t) = (1−t)³P₀ + 3(1−t)²t·P₁<br>&nbsp;&nbsp;&nbsp;&nbsp;+ 3(1−t)t²·P₂ + t³P₃',
    );

    panel.slider({ label: '속도', min: 0.05, max: 1, value: this.speed, onInput: (v) => (this.speed = v) });

    const updateControlPoint = (index: 1 | 2, y: number): void => {
      P[index].y = y;
      cps[index].position.y = y;
      // curve.v1 / curve.v2 는 P[1] / P[2] 와 같은 참조지만 명시적으로 갱신
      if (index === 1) curve.v1.y = y;
      else curve.v2.y = y;
      polyGeo.setFromPoints(P);
      poly.computeLineDistances();
      rebuildTube();
    };

    panel.slider({ label: '제어점 1 높이', min: -2, max: 10, value: 7, onInput: (v) => updateControlPoint(1, v) });
    panel.slider({ label: '제어점 2 높이', min: -2, max: 10, value: 7, onInput: (v) => updateControlPoint(2, v) });

    this.readout = panel.readout('진행 t', '0.00');
    this.t = 0;
  }

  update(dt: number): void {
    if (!this.curve || !this.ball) return;
    this.t = (this.t + dt * this.speed) % 1;
    this.curve.getPoint(this.t, this.ball.position);
    this.readout?.set(this.t.toFixed(2));
  }

  exit(): void {
    this.curve = null;
    this.ball = null;
    this.readout = null;
  }
}
