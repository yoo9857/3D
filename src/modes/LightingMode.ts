import * as THREE from 'three';
import type { Mode, ModeContext } from '../core/types';
import type { SharedEnv } from '../core/types';

/**
 * 빛 · 그림자 (렌더링 방정식).
 * 각 픽셀의 밝기는 표면이 받은 빛과 반사·산란의 적분으로 결정됩니다.
 * 빛의 위치·세기·주변광·그림자를 조작하며 원리를 관찰합니다.
 */
export class LightingMode implements Mode {
  readonly id = 'lighting';
  readonly title = '빛·그림자';

  private env: SharedEnv | null = null;
  private marker: THREE.Mesh | null = null;
  private knot: THREE.Mesh | null = null;
  private angle = 0.6;
  private height = 16;
  private orbit = true;

  enter(ctx: ModeContext): void {
    const { track, panel, env } = ctx;
    this.env = env;

    const specs: Array<{ g: THREE.BufferGeometry; c: number; p: [number, number, number] }> = [
      { g: new THREE.SphereGeometry(1.6, 32, 32), c: 0x5aa9ff, p: [-4, 1.6, 0] },
      { g: new THREE.TorusKnotGeometry(1.1, 0.4, 120, 16), c: 0xff7ac6, p: [0, 2, 0] },
      { g: new THREE.IcosahedronGeometry(1.6, 0), c: 0xffcf5b, p: [4, 1.6, 0] },
      { g: new THREE.CylinderGeometry(1, 1, 3, 32), c: 0x5be3a0, p: [0, 1.5, -4] },
    ];
    specs.forEach((s, i) => {
      const m = new THREE.Mesh(s.g, new THREE.MeshStandardMaterial({ color: s.c, roughness: 0.35, metalness: 0.4 }));
      m.position.set(...s.p);
      m.castShadow = true;
      m.receiveShadow = true;
      track(m);
      if (i === 1) this.knot = m;
    });

    // 빛 위치를 나타내는 발광 구
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffee88 }));
    this.marker = marker;
    track(marker);

    panel.section(
      this.title,
      '화면의 각 픽셀 색은 <b>렌더링 방정식</b>으로 정해집니다. 표면이 받은 빛과 반사·산란을 적분해서 밝기를 계산하죠. 그림자는 빛이 물체에 막혀 도달하지 못하는 영역입니다.',
      'Lₒ = Lₑ + ∫ f·Lᵢ·(n·ω) dω',
    );

    panel.toggle({ label: '빛이 원을 그리며 이동', value: true, onChange: (v) => (this.orbit = v) });
    panel.toggle({
      label: '그림자 켜기',
      value: true,
      onChange: (v) => {
        env.renderer.shadowMap.enabled = v;
        env.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh && mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((mat) => (mat.needsUpdate = true));
          }
        });
      },
    });

    panel.slider({ label: '빛 높이', min: 5, max: 25, value: this.height, step: 1, onInput: (v) => (this.height = v) });
    panel.slider({ label: '빛 세기', min: 0, max: 2.5, value: 1, onInput: (v) => (env.lights.key.intensity = v) });
    panel.slider({ label: '주변광 (전체 밝기)', min: 0, max: 1.2, value: 0.35, onInput: (v) => (env.lights.ambient.intensity = v) });
  }

  update(dt: number): void {
    if (!this.env) return;
    if (this.orbit) this.angle += dt * 0.5;
    const x = Math.cos(this.angle) * 14;
    const z = Math.sin(this.angle) * 14;
    this.env.lights.key.position.set(x, this.height, z);
    this.marker?.position.set(x, this.height, z);
    if (this.knot) {
      this.knot.rotation.y += dt * 0.4;
      this.knot.rotation.x += dt * 0.2;
    }
  }

  exit(): void {
    this.env = null;
    this.marker = null;
    this.knot = null;
  }
}
