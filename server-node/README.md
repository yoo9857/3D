# 로컬 CPU image→3D 서버 (Node)

이 컴퓨터에서 **GPU·API 키 없이** 바로 돌아가는 image→3D 서버입니다.
기본은 **TripoSR(학습된 가중치)로 진짜 full 3D 메시(GLB)** 를 CPU에서 생성하고,
TripoSR 를 못 쓰는 경우 자동으로 **깊이 부조(relief)** 로 폴백합니다.

## 실행

```bash
cd server-node
npm install     # 최초 1회
npm start       # http://localhost:8000/generate
```

TripoSR 백엔드는 `ml/`(Python venv)를 사용합니다. 최초 1회 준비:

```bash
cd ml
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
# 첫 추론 시 stabilityai/TripoSR 가중치(~1.7GB), rembg u2net(~176MB) 자동 다운로드
```

웹앱 `Full 3D (AI)` 탭의 "생성 서버 URL" 은 기본값이 이미 `http://localhost:8000/generate` 라
서버만 켜면 바로 연결됩니다. 사진을 올리면 생성된 3D 가 화면에 뜨고, OBJ/STL/GLB 로 저장됩니다.

## 계약

```
POST /generate  (multipart/form-data, field: image)   → GLB 바이너리
GET  /health                                           → { status, backend }

선택 쿼리:
  ?mode=triposr   (기본) 실제 3D. 첫 추론은 가중치 다운로드로 느림, 이후 CPU 수 분
  ?mode=relief    빠른 부조 폴백(즉시)
  ?mc=256         TripoSR marching cubes 해상도(기본 256, 낮추면 빠름)
  ?depth / ?res   relief 모드 파라미터(높이 강도 / 해상도)

응답 헤더 X-Backend: triposr-cpu | node-cpu-relief | node-cpu-relief(fallback)
```

## 환경변수(경로 커스터마이즈)
- `TRIPOSR_PY`    : venv python 경로 (기본 `C:\3D\ml\.venv\Scripts\python.exe`)
- `TRIPOSR_INFER` : 추론 스크립트 (기본 `C:\3D\ml\infer.py`)
- `PORT`          : 포트 (기본 8000)

## 위치와 한계
- TripoSR 는 단일 이미지 → 뒷면까지 있는 닫힌 메시를 만드는 **실제 학습 모델**입니다(부조와 다름).
  단, CPU 라서 느리고 품질은 GPU 대형 모델(Hunyuan3D-2/TRELLIS)보다 낮습니다.
- **다음 단계**: 서버(GPU) 구매 후 백엔드만 더 강한 모델로 교체. 계약(POST image→GLB)이 같아
  웹앱과 이 노드 서버는 그대로 재사용됩니다. `server/`(Python/FastAPI)도 같은 계약의 대안입니다.

```
브라우저 웹앱  ──▶  server-node ──▶ ml/ TripoSR (지금, CPU, 실제 3D)   ← 여기까지 동작
                              └▶ relief 폴백 (즉시)
              ──▶  server (Python) ──▶ 더 강한 GPU 모델            ← 서버 구매 후
```

## 주의(재발 방지)
`transformers` 는 반드시 **4.x** (권장 `4.49.0`). 5.x 는 ViT 파라미터 이름이 바뀌어
TripoSR 체크포인트 로딩(`load_state_dict`)이 실패합니다. `ml/requirements.txt` 참고.
