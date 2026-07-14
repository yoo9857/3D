import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { showError } from './errors';

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 다운로드가 시작될 시간을 주고 해제
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** GLB(바이너리 glTF) — 정점 색상 포함. 가장 범용적인 3D 포맷 */
export function exportGLB(object: THREE.Object3D, filename = 'model.glb'): void {
  const exporter = new GLTFExporter();
  exporter.parse(
    object,
    (result) => {
      const blob =
        result instanceof ArrayBuffer
          ? new Blob([result], { type: 'model/gltf-binary' })
          : new Blob([JSON.stringify(result)], { type: 'model/gltf+json' });
      download(blob, filename);
    },
    (error) => showError('GLB 내보내기 실패', String(error.message ?? error)),
    { binary: true },
  );
}

/** OBJ — 지오메트리(색상 미포함). 대부분의 3D 툴에서 호환 */
export function exportOBJ(object: THREE.Object3D, filename = 'model.obj'): void {
  try {
    const text = new OBJExporter().parse(object);
    download(new Blob([text], { type: 'text/plain' }), filename);
  } catch (err) {
    showError('OBJ 내보내기 실패', err instanceof Error ? err.message : String(err));
  }
}

/** STL — 3D 프린팅 표준(색상 미포함, 바이너리) */
export function exportSTL(object: THREE.Object3D, filename = 'model.stl'): void {
  try {
    const dataView = new STLExporter().parse(object, { binary: true });
    download(new Blob([dataView.buffer as ArrayBuffer], { type: 'model/stl' }), filename);
  } catch (err) {
    showError('STL 내보내기 실패', err instanceof Error ? err.message : String(err));
  }
}
