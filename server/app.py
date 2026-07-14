"""
레퍼런스 image→3D 생성 서버 (FastAPI).

계약(웹앱과의 약속):
    POST /generate   (multipart/form-data, field name: "image")
      → 성공 시: GLB 바이너리(Content-Type: model/gltf-binary)

두 가지 백엔드를 내장:
  1) BACKEND=replicate  → 클라우드(Replicate)에서 학습된 image→3D 모델 실행.
                          GPU 불필요. REPLICATE_API_TOKEN 만 있으면 진짜 3D 가 나옴.
  2) BACKEND=demo       → 자리표시자(정육면체). 왕복 테스트용(모델 아님).
  (로컬 GPU 모델 연결은 generate_local() 자리에 붙이면 됨 — 사장님 GPU 서버용)

실행:
    pip install -r requirements.txt
    # 클라우드 사용(권장, GPU 불필요):
    export BACKEND=replicate
    export REPLICATE_API_TOKEN=r8_xxx           # https://replicate.com/account
    export REPLICATE_MODEL=firtoz/trellis        # 사용할 image→3D 모델 슬러그
    export REPLICATE_IMAGE_FIELD=images          # 모델 입력 필드명(모델마다 다름)
    export REPLICATE_IMAGE_AS_LIST=1             # 입력이 배열이면 1
    uvicorn app:app --host 0.0.0.0 --port 8000

웹앱 "생성 서버 URL" 에 http://<서버>:8000/generate 를 넣으면 연결됩니다.
"""
from __future__ import annotations

import base64
import io
import os
import time

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

app = FastAPI(title="image-to-3d reference server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BACKEND = os.getenv("BACKEND", "replicate" if os.getenv("REPLICATE_API_TOKEN") else "demo")

# ---- Replicate 설정 (환경변수로 조절) ----
REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN", "")
REPLICATE_MODEL = os.getenv("REPLICATE_MODEL", "firtoz/trellis")
REPLICATE_IMAGE_FIELD = os.getenv("REPLICATE_IMAGE_FIELD", "images")
REPLICATE_IMAGE_AS_LIST = os.getenv("REPLICATE_IMAGE_AS_LIST", "1") == "1"
REPLICATE_POLL_SECONDS = float(os.getenv("REPLICATE_POLL_SECONDS", "2"))
REPLICATE_TIMEOUT_SECONDS = float(os.getenv("REPLICATE_TIMEOUT_SECONDS", "600"))


def _find_glb_url(output: object) -> str | None:
    """모델 출력(문자열/리스트/딕셔너리)에서 .glb URL 을 재귀적으로 찾는다."""
    if isinstance(output, str):
        low = output.lower()
        if low.startswith("http") and (".glb" in low or ".gltf" in low):
            return output
        return None
    if isinstance(output, list):
        for item in output:
            found = _find_glb_url(item)
            if found:
                return found
        return None
    if isinstance(output, dict):
        # 흔한 키 우선
        for key in ("model_file", "glb", "mesh", "model", "output"):
            if key in output:
                found = _find_glb_url(output[key])
                if found:
                    return found
        for value in output.values():
            found = _find_glb_url(value)
            if found:
                return found
    return None


def generate_replicate(image_bytes: bytes) -> bytes:
    import requests  # 지연 임포트

    if not REPLICATE_API_TOKEN:
        raise HTTPException(status_code=500, detail="REPLICATE_API_TOKEN 이 설정되지 않았습니다.")

    data_uri = "data:image/png;base64," + base64.b64encode(image_bytes).decode("ascii")
    image_value = [data_uri] if REPLICATE_IMAGE_AS_LIST else data_uri
    headers = {
        "Authorization": f"Bearer {REPLICATE_API_TOKEN}",
        "Content-Type": "application/json",
    }

    # 모델 슬러그로 예측 생성(버전 해시 불필요)
    create = requests.post(
        f"https://api.replicate.com/v1/models/{REPLICATE_MODEL}/predictions",
        headers=headers,
        json={"input": {REPLICATE_IMAGE_FIELD: image_value}},
        timeout=60,
    )
    if create.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"Replicate 생성 요청 실패: {create.status_code} {create.text[:300]}")
    pred = create.json()
    get_url = pred.get("urls", {}).get("get")
    if not get_url:
        raise HTTPException(status_code=502, detail=f"Replicate 응답에 폴링 URL 없음: {str(pred)[:300]}")

    # 완료까지 폴링
    deadline = time.time() + REPLICATE_TIMEOUT_SECONDS
    status = pred.get("status")
    while status not in ("succeeded", "failed", "canceled"):
        if time.time() > deadline:
            raise HTTPException(status_code=504, detail="Replicate 처리 시간 초과")
        time.sleep(REPLICATE_POLL_SECONDS)
        poll = requests.get(get_url, headers=headers, timeout=60)
        pred = poll.json()
        status = pred.get("status")

    if status != "succeeded":
        raise HTTPException(status_code=502, detail=f"Replicate 처리 실패: {status} {str(pred.get('error'))[:300]}")

    glb_url = _find_glb_url(pred.get("output"))
    if not glb_url:
        raise HTTPException(
            status_code=502,
            detail=(
                "모델 출력에서 GLB URL 을 찾지 못했습니다. REPLICATE_MODEL 이 GLB 를 출력하는지, "
                f"REPLICATE_IMAGE_FIELD 가 맞는지 확인하세요. output={str(pred.get('output'))[:300]}"
            ),
        )

    glb = requests.get(glb_url, timeout=120)
    if glb.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"GLB 다운로드 실패: {glb.status_code}")
    return glb.content


def generate_demo(image_bytes: bytes) -> bytes:
    """모델 없이 왕복만 확인하는 자리표시자(입력 평균색 정육면체)."""
    try:
        import numpy as np
        import trimesh
        from PIL import Image
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=501, detail=f"demo 모드엔 trimesh/pillow/numpy 필요: {exc}")
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((16, 16))
    avg = np.asarray(img).reshape(-1, 3).mean(axis=0) / 255.0
    box = trimesh.creation.box(extents=(1.0, 1.6, 1.0))
    box.visual.vertex_colors = np.tile(np.array([*avg, 1.0]) * 255, (len(box.vertices), 1)).astype(np.uint8)
    exported = box.export(file_type="glb")
    return exported if isinstance(exported, (bytes, bytearray)) else bytes(exported)


def generate_local(image_bytes: bytes) -> bytes:
    """
    사장님 GPU 서버용 자리(로컬 오픈 가중치/자체 학습 가중치).
    예) Hunyuan3D-2.1 / TRELLIS 파이프라인 추론 후 mesh.export("glb") 반환.
    """
    raise HTTPException(status_code=501, detail="BACKEND=local 은 아직 연결되지 않았습니다. generate_local() 에 모델을 붙이세요.")


def generate_glb(image_bytes: bytes) -> bytes:
    if BACKEND == "replicate":
        return generate_replicate(image_bytes)
    if BACKEND == "local":
        return generate_local(image_bytes)
    return generate_demo(image_bytes)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "backend": BACKEND, "model": REPLICATE_MODEL if BACKEND == "replicate" else ""}


@app.post("/generate")
async def generate(image: UploadFile = File(...)) -> Response:
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 이미지입니다.")
    glb = generate_glb(data)
    return Response(content=glb, media_type="model/gltf-binary")
