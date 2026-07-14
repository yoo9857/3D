"""
TripoSR 로컬 추론: 이미지 1장 → 3D 메시(GLB).
CPU 실행(Intel/32GB). 학습된 가중치(stabilityai/TripoSR)를 HuggingFace 에서 자동 다운로드.

사용: python infer.py <입력이미지> <출력.glb> [mc_resolution]
"""
import sys
import os

import numpy as np
import torch
import trimesh
import trimesh.repair
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "TripoSR"))
from tsr.system import TSR
from tsr.utils import remove_background, resize_foreground


def progress(frac: float, msg: str) -> None:
    """서버가 파싱해 브라우저로 중계하는 진행률 라인. 형식: `@P <0~1> <메시지>`"""
    print(f"@P {frac:.3f} {msg}", flush=True)


def main() -> None:
    image_path = sys.argv[1]
    out_path = sys.argv[2]
    mc_res = int(sys.argv[3]) if len(sys.argv) > 3 else 256

    torch.set_num_threads(max(1, os.cpu_count() or 4))
    device = "cpu"

    progress(0.03, "모델 로드 중(최초 1회 가중치 다운로드)…")
    model = TSR.from_pretrained(
        "stabilityai/TripoSR",
        config_name="config.yaml",
        weight_name="model.ckpt",
    )
    model.renderer.set_chunk_size(8192)
    model.to(device)

    progress(0.20, "배경 제거·전경 정렬 중…")
    image = Image.open(image_path).convert("RGB")
    try:
        import rembg

        session = rembg.new_session()
        image = remove_background(image, session)
        image = resize_foreground(image, 0.85)
        arr = np.array(image).astype(np.float32) / 255.0
        if arr.shape[-1] == 4:
            arr = arr[:, :, :3] * arr[:, :, 3:4] + 0.5 * (1 - arr[:, :, 3:4])
        image = Image.fromarray((arr * 255.0).astype(np.uint8))
    except Exception as e:  # noqa: BLE001
        print("  배경 제거 건너뜀:", e, flush=True)

    progress(0.40, "3D 추론 중(가장 오래 걸리는 단계)…")
    with torch.no_grad():
        scene_codes = model([image], device=device)

    progress(0.82, "메시 추출 중(marching cubes)…")
    meshes = model.extract_mesh(scene_codes, True, resolution=mc_res)
    mesh = meshes[0]

    # marching cubes 결과는 면 winding 이 뒤섞여 노멀이 안쪽을 향하는 경우가 있다.
    # → 웹앱(단면 재질)에서 "내부가 비쳐 보이고 뒤집힌" 현상.
    # winding·노멀을 바깥 기준으로 통일하고 노멀을 새로 계산해 넣는다.
    try:
        trimesh.repair.fix_normals(mesh)  # winding 일관화 + 바깥 방향
        trimesh.repair.fix_inversion(mesh)  # 전체가 뒤집혔으면 되돌림
    except Exception as e:  # noqa: BLE001
        print("  노멀 보정 건너뜀:", e, flush=True)

    # TripoSR 는 +Z 가 위쪽(Z-up, get_spherical_cameras up=[0,0,1]).
    # glTF/three.js 는 Y-up 이라 그대로 두면 90° 누워서 보인다.
    # X축 -90° 회전으로 Z-up → Y-up 정렬: (x,y,z) → (x, z, -y).
    rot = trimesh.transformations.rotation_matrix(-np.pi / 2.0, [1.0, 0.0, 0.0])
    mesh.apply_transform(rot)
    mesh.rezero()

    # glTF 는 정점 노멀이 있어야 매끄럽게 셰이딩된다(없으면 뚫려 보이거나 각짐).
    mesh.vertex_normals  # noqa: B018  (접근 시 자동 계산·캐시)

    progress(0.96, "GLB 저장 중…")
    mesh.export(out_path)
    progress(1.0, "완료")
    print("SAVED", out_path, flush=True)


if __name__ == "__main__":
    main()
