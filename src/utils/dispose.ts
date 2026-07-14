import * as THREE from 'three';

/**
 * Object3D 하위의 모든 geometry/material 을 재귀적으로 해제하여
 * GPU 메모리 누수를 방지합니다. 모드 전환마다 호출됩니다.
 */
export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as Partial<THREE.Mesh> & THREE.Object3D;

    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    const material = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (material) {
      const list = Array.isArray(material) ? material : [material];
      for (const m of list) {
        // 텍스처가 있으면 함께 해제
        for (const value of Object.values(m as unknown as Record<string, unknown>)) {
          if (value instanceof THREE.Texture) {
            value.dispose();
          }
        }
        m.dispose();
      }
    }
  });
}
