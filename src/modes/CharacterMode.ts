import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Mode, ModeContext } from '../core/types';

type AnimName = 'idle' | 'walk' | 'wave';

interface BoneDef {
  name: string;
  parent: number;
  offset: [number, number, number];
}

/**
 * 뼈대(스켈레톤) 정의. offset 은 부모 기준 상대 위치(바인드 포즈, T-포즈).
 * 이 인덱스가 곧 skinIndex 로 쓰인다.
 */
const BONES: BoneDef[] = [
  { name: 'hips', parent: -1, offset: [0, 4.4, 0] },
  { name: 'spine', parent: 0, offset: [0, 0.75, 0] },
  { name: 'chest', parent: 1, offset: [0, 0.85, 0] },
  { name: 'neck', parent: 2, offset: [0, 0.65, 0] },
  { name: 'head', parent: 3, offset: [0, 0.55, 0] },
  { name: 'upperArmL', parent: 2, offset: [0.7, 0.45, 0] },
  { name: 'lowerArmL', parent: 5, offset: [1.25, 0, 0] },
  { name: 'handL', parent: 6, offset: [1.05, 0, 0] },
  { name: 'upperArmR', parent: 2, offset: [-0.7, 0.45, 0] },
  { name: 'lowerArmR', parent: 8, offset: [-1.25, 0, 0] },
  { name: 'handR', parent: 9, offset: [-1.05, 0, 0] },
  { name: 'upperLegL', parent: 0, offset: [0.42, -0.35, 0] },
  { name: 'lowerLegL', parent: 11, offset: [0, -1.7, 0] },
  { name: 'footL', parent: 12, offset: [0, -1.6, 0] },
  { name: 'upperLegR', parent: 0, offset: [-0.42, -0.35, 0] },
  { name: 'lowerLegR', parent: 14, offset: [0, -1.7, 0] },
  { name: 'footR', parent: 15, offset: [0, -1.6, 0] },
];

const COLOR = {
  skin: 0xf1b48a,
  shirt: 0x4a7dff,
  pants: 0x2b3350,
  shoe: 0x14171f,
} as const;

/**
 * 리깅 캐릭터.
 * 코드로 뼈대(Bone)를 세우고, 몸통·팔·다리를 각 뼈에 스킨(skinIndex/weight)으로
 * 묶은 SkinnedMesh 를 만든 뒤, 매 프레임 뼈를 회전시켜 걷기/대기/손흔들기 애니메이션을 만든다.
 * 외부 파일·인터넷 없이 실제 스켈레탈 리깅이 동작한다.
 */
export class CharacterMode implements Mode {
  readonly id = 'character';
  readonly title = '리깅 캐릭터';

  private mesh: THREE.SkinnedMesh | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private helper: THREE.SkeletonHelper | null = null;
  private readonly bones: THREE.Bone[] = [];
  private readonly boneIndex = new Map<string, number>();

  private anim: AnimName = 'walk';
  private speed = 1;

  enter(ctx: ModeContext): void {
    const { track, panel, env } = ctx;
    env.controls.target.set(0, 4, 0);

    // 1) 뼈대 생성 및 계층 구성
    BONES.forEach((def, i) => {
      const bone = new THREE.Bone();
      bone.name = def.name;
      bone.position.set(def.offset[0], def.offset[1], def.offset[2]);
      this.bones.push(bone);
      this.boneIndex.set(def.name, i);
    });
    BONES.forEach((def, i) => {
      if (def.parent >= 0) this.bones[def.parent].add(this.bones[i]);
    });
    // 바인드 포즈의 월드 좌표 계산(지오메트리 생성에 사용)
    this.bones[0].updateMatrixWorld(true);
    const wp = (i: number): THREE.Vector3 => this.bones[i].getWorldPosition(new THREE.Vector3());

    // 2) 각 뼈에 대응하는 몸체 지오메트리(월드 바인드 좌표)
    const parts: THREE.BufferGeometry[] = [];
    const idx = (n: string): number => this.boneIndex.get(n) as number;

    // 몸통 / 골반 / 목 / 머리
    parts.push(this.finalize(boxAt(wp(0), 1.35, 0.75, 0.85), idx('hips'), COLOR.pants));
    parts.push(this.finalize(boxAt(mid(wp(1), wp(2), 0.1), 1.55, 1.95, 0.9), idx('spine'), COLOR.shirt));
    parts.push(this.finalize(limb(add(wp(2), 0, -0.1, 0), wp(4), 0.2, 0.22), idx('neck'), COLOR.skin));
    parts.push(this.finalize(sphereAt(wp(4), 0.62), idx('head'), COLOR.skin));

    // 팔 (좌/우)
    for (const s of ['L', 'R'] as const) {
      const ua = idx(`upperArm${s}`);
      const la = idx(`lowerArm${s}`);
      const ha = idx(`hand${s}`);
      parts.push(this.finalize(sphereAt(wp(ua), 0.28), ua, COLOR.shirt)); // 어깨
      parts.push(this.finalize(limb(wp(ua), wp(la), 0.24, 0.2), ua, COLOR.skin));
      parts.push(this.finalize(sphereAt(wp(la), 0.2), la, COLOR.skin)); // 팔꿈치
      parts.push(this.finalize(limb(wp(la), wp(ha), 0.19, 0.16), la, COLOR.skin));
      parts.push(this.finalize(sphereAt(wp(ha), 0.22), ha, COLOR.skin)); // 손
    }

    // 다리 (좌/우)
    for (const s of ['L', 'R'] as const) {
      const ul = idx(`upperLeg${s}`);
      const ll = idx(`lowerLeg${s}`);
      const ft = idx(`foot${s}`);
      parts.push(this.finalize(sphereAt(wp(ul), 0.34), ul, COLOR.pants)); // 골반 관절
      parts.push(this.finalize(limb(wp(ul), wp(ll), 0.34, 0.28), ul, COLOR.pants));
      parts.push(this.finalize(sphereAt(wp(ll), 0.27), ll, COLOR.pants)); // 무릎
      parts.push(this.finalize(limb(wp(ll), wp(ft), 0.27, 0.22), ll, COLOR.pants));
      parts.push(this.finalize(boxAt(add(wp(ft), 0, -0.18, 0.28), 0.5, 0.32, 1.15), ft, COLOR.shoe)); // 발
    }

    const merged = mergeGeometries(parts, false);
    if (!merged) throw new Error('캐릭터 지오메트리 병합 실패');

    // 3) SkinnedMesh 생성 및 스켈레톤 바인딩
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
    const mesh = new THREE.SkinnedMesh(merged, this.material);
    mesh.castShadow = true;
    mesh.frustumCulled = false; // 애니메이션으로 바인드 경계를 벗어나도 사라지지 않게
    mesh.add(this.bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh = mesh;
    track(mesh);

    // 4) 뼈대 시각화
    const helper = new THREE.SkeletonHelper(mesh);
    (helper.material as THREE.LineBasicMaterial).linewidth = 2;
    this.helper = helper;
    track(helper);

    // 5) UI
    panel.section(
      this.title,
      '코드로 <b>뼈대(스켈레톤)</b>를 세우고 몸을 각 뼈에 <b>스킨</b>으로 묶은 SkinnedMesh 입니다. 매 프레임 뼈를 회전시켜 애니메이션합니다. 외부 파일 없이 <b>실제 리깅</b>이 동작합니다.',
    );

    panel.buttonGroup({
      buttons: [
        { id: 'walk', label: '🚶 걷기' },
        { id: 'idle', label: '🧍 대기' },
        { id: 'wave', label: '👋 손흔들기' },
      ],
      active: this.anim,
      onSelect: (id) => (this.anim = id as AnimName),
    });

    panel.slider({ label: '속도', min: 0.2, max: 3, value: this.speed, onInput: (v) => (this.speed = v) });
    panel.toggle({ label: '뼈대 보기 (스켈레톤)', value: true, onChange: (v) => this.helper && (this.helper.visible = v) });
    panel.toggle({ label: '자동 회전', value: false, onChange: (v) => (env.controls.autoRotate = v) });

    panel.hint('걷기=팔다리 교차 스윙, 대기=가벼운 호흡, 손흔들기=오른팔 흔들기. 초록 선이 뼈대(관절)입니다.');

    this.pose(0);
  }

  update(_dt: number, elapsed: number): void {
    this.pose(elapsed);
  }

  /** 애니메이션: 현재 모드에 맞춰 뼈 회전을 설정 */
  private pose(t: number): void {
    const mesh = this.mesh;
    if (!mesh) return;
    const set = (name: string, x: number, y: number, z: number): void => {
      const i = this.boneIndex.get(name);
      if (i !== undefined) this.bones[i].rotation.set(x, y, z);
    };

    if (this.anim === 'walk') {
      const w = t * this.speed * 3;
      const swing = Math.sin(w);
      set('upperLegL', swing * 0.5, 0, 0);
      set('lowerLegL', Math.max(0, -swing) * 0.8 + 0.05, 0, 0);
      set('upperLegR', -swing * 0.5, 0, 0);
      set('lowerLegR', Math.max(0, swing) * 0.8 + 0.05, 0, 0);
      set('upperArmL', -swing * 0.5, 0, -1.3);
      set('lowerArmL', 0.3, 0, 0);
      set('upperArmR', swing * 0.5, 0, 1.3);
      set('lowerArmR', 0.3, 0, 0);
      set('chest', 0, swing * 0.12, 0);
      set('head', 0, -swing * 0.1, 0);
      mesh.position.y = Math.abs(Math.sin(w)) * 0.12;
    } else if (this.anim === 'idle') {
      const b = Math.sin(t * 1.6) * 0.05;
      set('upperLegL', 0, 0, 0);
      set('lowerLegL', 0.03, 0, 0);
      set('upperLegR', 0, 0, 0);
      set('lowerLegR', 0.03, 0, 0);
      set('upperArmL', 0.05, 0, -1.25 - b);
      set('lowerArmL', 0.2, 0, 0);
      set('upperArmR', 0.05, 0, 1.25 + b);
      set('lowerArmR', 0.2, 0, 0);
      set('chest', 0, b * 0.5, 0);
      set('head', b * 0.3, 0, 0);
      mesh.position.y = b * 0.4;
    } else {
      // wave
      const wave = Math.sin(t * this.speed * 8) * 0.5;
      set('upperLegL', 0, 0, 0);
      set('lowerLegL', 0.03, 0, 0);
      set('upperLegR', 0, 0, 0);
      set('lowerLegR', 0.03, 0, 0);
      set('upperArmL', 0.05, 0, -1.25);
      set('lowerArmL', 0.2, 0, 0);
      set('upperArmR', 0, 0, -1.6); // 오른팔 위로
      set('lowerArmR', 0, 0, -0.3 + wave); // 팔뚝 흔들기
      set('head', 0, 0, 0);
      mesh.position.y = 0;
    }
  }

  /** 지오메트리에 정점색·스킨 인덱스/가중치를 부여 */
  private finalize(geo: THREE.BufferGeometry, boneIdx: number, hex: number): THREE.BufferGeometry {
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace); // 선형색으로 변환
    for (let i = 0; i < n; i++) {
      si[i * 4] = boneIdx; // 단일 뼈에 완전 종속(강체 스키닝)
      sw[i * 4] = 1;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return geo;
  }

  exit(): void {
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.bones.length = 0;
    this.boneIndex.clear();
    this.mesh = null;
    this.material = null;
    this.helper = null;
  }
}

// ---- 지오메트리 헬퍼(월드 바인드 좌표에 배치) ----

function boxAt(center: THREE.Vector3, sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  geo.translate(center.x, center.y, center.z);
  return geo;
}

function sphereAt(center: THREE.Vector3, r: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(r, 18, 14);
  geo.translate(center.x, center.y, center.z);
  return geo;
}

/** a→b 를 잇는 원기둥(관절 사이 뼈살) */
function limb(a: THREE.Vector3, b: THREE.Vector3, rTop: number, rBottom: number): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(dir.length(), 0.001);
  const geo = new THREE.CylinderGeometry(rTop, rBottom, len, 12, 1, false);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  geo.applyQuaternion(quat);
  const m = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  geo.translate(m.x, m.y, m.z);
  return geo;
}

function mid(a: THREE.Vector3, b: THREE.Vector3, dy = 0): THREE.Vector3 {
  return new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2 + dy, (a.z + b.z) / 2);
}

function add(v: THREE.Vector3, dx: number, dy: number, dz: number): THREE.Vector3 {
  return new THREE.Vector3(v.x + dx, v.y + dy, v.z + dz);
}
