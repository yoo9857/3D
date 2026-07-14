# image→3D 레퍼런스 서버

웹앱이 "이미지 → 3D(GLB)" 를 요청하는 백엔드입니다. **학습된 모델을 사용**해 진짜 3D 를 만듭니다.
나중에 사장님이 직접 학습한 가중치는 `generate_local()` 에 붙이면 됩니다.

## 계약 (웹앱과의 약속)

```
POST /generate   (multipart/form-data, field: image)
  → GLB 바이너리 (Content-Type: model/gltf-binary)
```

웹앱 `Full 3D (AI)` 탭의 **"생성 서버 URL"** 에 `http://<서버주소>:8000/generate` 를 입력하면 연결됩니다.

## 3가지 백엔드 (환경변수 `BACKEND`)

| BACKEND | 설명 | GPU |
|---|---|---|
| `replicate` (기본) | 클라우드에서 학습된 image→3D 모델 실행. **키만 있으면 진짜 3D.** | 불필요 |
| `demo` | 자리표시자 정육면체. 왕복 테스트용(모델 아님). | 불필요 |
| `local` | 사장님 GPU 서버에서 로컬 가중치 실행(`generate_local()` 에 연결). | 필요 |

## 설치

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # (Windows: .venv\Scripts\activate)
pip install -r requirements.txt
```

## ① 클라우드로 진짜 3D 뽑기 (권장, GPU 불필요)

1. https://replicate.com 가입 → 계정에서 **API 토큰** 발급 (사용량 과금)
2. 환경변수 설정 후 실행:

```bash
export BACKEND=replicate
export REPLICATE_API_TOKEN=r8_xxxxxxxx
export REPLICATE_MODEL=firtoz/trellis     # image→3D 모델 슬러그(예: TRELLIS)
export REPLICATE_IMAGE_FIELD=images       # 모델 입력 필드명
export REPLICATE_IMAGE_AS_LIST=1          # 입력이 배열이면 1, 단일이면 0
uvicorn app:app --host 0.0.0.0 --port 8000
```

3. 웹앱 `Full 3D (AI)` 탭 → "생성 서버 URL" 에 `http://localhost:8000/generate` → 사진 업로드 → 진짜 3D GLB.

> 모델마다 입력 필드명이 다릅니다. 실패하면 해당 모델의 Replicate 페이지 "API" 탭에서 입력 필드명을 확인해
> `REPLICATE_IMAGE_FIELD` / `REPLICATE_IMAGE_AS_LIST` 를 맞추세요. (예: 어떤 모델은 `image`(단일), TRELLIS 는 `images`(배열))
> 다른 모델 예: TripoSR, Hunyuan3D 계열 등 — `REPLICATE_MODEL` 만 바꾸면 됩니다.

## ② 왕복만 먼저 확인 (키 없이)

```bash
export BACKEND=demo
uvicorn app:app --port 8000
```

사진을 올리면 입력 평균색 정육면체 GLB 가 돌아옵니다(웹앱↔서버 연결 확인용).

## ③ 나중에: 자체 GPU / 학습한 가중치

`app.py` 의 `generate_local(image_bytes) -> bytes` 에 파이프라인을 연결하고 `BACKEND=local` 로 실행.
예) Hunyuan3D-2.1 / TRELLIS 추론 → `mesh.export("glb")` 반환. 웹앱/계약은 그대로.

## 운영 주의
- CORS 는 현재 모두 허용(`*`). 배포 시 웹앱 도메인만 허용하도록 제한하세요.
- 추론이 오래 걸리면(수십 초~분) 프록시/게이트웨이 타임아웃을 늘리세요.
