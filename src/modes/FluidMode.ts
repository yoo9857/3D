import * as THREE from 'three';
import type { Mode, ModeContext } from '../core/types';

type FluidKind = 'water' | 'smoke';

/**
 * 물 · 연기 (유체 시뮬레이션).
 * 실제 유체는 나비에–스토크스 방정식으로 기술되지만, 실시간 표현을 위해
 * 물결은 파동 합성, 연기는 상승+난류 파티클로 근사합니다.
 */
export class FluidMode implements Mode {
  readonly id = 'fluid';
  readonly title = '물·연기';

  private kind: FluidKind = 'water';

  // 물
  private water: THREE.Mesh | null = null;
  private waterGeo: THREE.PlaneGeometry | null = null;
  private waterBase: Float32Array | null = null;

  // 연기
  private smoke: THREE.Points | null = null;
  private smokeSeed: Float32Array | null = null;
  private readonly smokeCount = 1400;

  // 파라미터
  private amp = 0.8;
  private speed = 1.0;
  private choppy = 1.0;

  enter(ctx: ModeContext): void {
    const { track, panel, env } = ctx;

    // ----- 물 표면 -----
    const seg = 80;
    const size = 40;
    const waterGeo = new THREE.PlaneGeometry(size, size, seg, seg);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(
      waterGeo,
      new THREE.MeshStandardMaterial({
        color: 0x2a7fff,
        roughness: 0.15,
        metalness: 0.6,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    water.receiveShadow = true;
    water.position.y = 1;
    this.water = water;
    this.waterGeo = waterGeo;
    this.waterBase = (waterGeo.attributes.position.array as Float32Array).slice();
    track(water);

    // ----- 연기 파티클 -----
    const smokeGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(this.smokeCount * 3);
    const seed = new Float32Array(this.smokeCount);
    for (let i = 0; i < this.smokeCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 2;
      positions[i * 3 + 1] = Math.random() * 14;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 2;
      seed[i] = Math.random() * Math.PI * 2;
    }
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const smoke = new THREE.Points(
      smokeGeo,
      new THREE.PointsMaterial({
        color: 0xbcd0ff,
        size: 0.55,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.smoke = smoke;
    this.smokeSeed = seed;
    // 연기는 필요할 때만 씬에 추가하되, 정리를 위해 track 등록
    track(smoke);

    panel.section(
      this.title,
      '유체의 움직임은 <b>나비에–스토크스 방정식</b>으로 기술됩니다. 속도장의 시간 변화를 매 프레임 적분해 물결과 소용돌이를 만듭니다. (여기선 실시간용 근사 파동/난류 모델을 사용)',
      '∂u/∂t + (u·∇)u = −∇p/ρ + ν∇²u + f',
    );

    const setKind = (kind: FluidKind): void => {
      this.kind = kind;
      if (this.water) this.water.visible = kind === 'water';
      if (this.smoke) this.smoke.visible = kind === 'smoke';
    };

    panel.buttonGroup({
      buttons: [
        { id: 'water', label: '💧 물결' },
        { id: 'smoke', label: '💨 연기' },
      ],
      active: 'water',
      onSelect: (id) => setKind(id as FluidKind),
    });

    panel.slider({ label: '파동 높이 / 상승력', min: 0.1, max: 2, value: this.amp, onInput: (v) => (this.amp = v) });
    panel.slider({ label: '흐름 속도', min: 0.2, max: 3, value: this.speed, onInput: (v) => (this.speed = v) });
    panel.slider({ label: '거칠기 / 난류', min: 0.2, max: 2.5, value: this.choppy, onInput: (v) => (this.choppy = v) });

    setKind('water');
    env.controls.target.set(0, 1, 0);
  }

  update(dt: number, elapsed: number): void {
    if (this.kind === 'water') {
      this.updateWater(elapsed);
    } else {
      this.updateSmoke(dt, elapsed);
    }
  }

  private updateWater(elapsed: number): void {
    const geo = this.waterGeo;
    const base = this.waterBase;
    if (!geo || !base) return;

    const arr = geo.attributes.position.array as Float32Array;
    const t = elapsed * this.speed;
    for (let i = 0; i < arr.length; i += 3) {
      const x = base[i];
      const z = base[i + 2];
      let y = Math.sin(x * 0.3 + t) * 0.5 + Math.cos(z * 0.35 + t * 0.8) * 0.5;
      y += Math.sin((x + z) * 0.5 * this.choppy + t * 1.3) * 0.3;
      y += Math.sin(Math.sqrt(x * x + z * z) * 0.6 - t * 1.5) * 0.25 * this.choppy;
      arr[i + 1] = y * this.amp;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }

  private updateSmoke(dt: number, elapsed: number): void {
    const smoke = this.smoke;
    const seed = this.smokeSeed;
    if (!smoke || !seed) return;

    const p = (smoke.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const t = elapsed * this.speed;
    for (let i = 0; i < this.smokeCount; i++) {
      const yi = i * 3 + 1;
      p[yi] += dt * this.amp * 1.5;
      const s = seed[i];
      p[i * 3] += Math.sin(t * 0.8 + s + p[yi] * 0.3) * dt * this.choppy;
      p[i * 3 + 2] += Math.cos(t * 0.7 + s * 1.3 + p[yi] * 0.3) * dt * this.choppy;
      if (p[yi] > 14) {
        p[i * 3] = (Math.random() - 0.5) * 2;
        p[yi] = 0;
        p[i * 3 + 2] = (Math.random() - 0.5) * 2;
      }
    }
    smoke.geometry.attributes.position.needsUpdate = true;
  }

  exit(): void {
    this.water = null;
    this.waterGeo = null;
    this.waterBase = null;
    this.smoke = null;
    this.smokeSeed = null;
  }
}
