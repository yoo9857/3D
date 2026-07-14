# 3D 애니메이션의 수학 — 인터랙티브 시각화

3D 애니메이션에 쓰이는 수학 원리를 마우스로 조작하며 배우는 웹 앱입니다.

| 데모 | 수학 원리 |
| --- | --- |
| 행렬·벡터 변환 | 4×4 변환 행렬로 점(벡터)을 이동·회전·크기변환 |
| 베지에 곡선 | 매개변수 방정식으로 만드는 부드러운 경로 |
| 빛·그림자 | 렌더링 방정식(적분)으로 결정되는 픽셀 밝기 |
| 물·연기 | 나비에–스토크스 기반 유체(파동/난류 근사) |
| 2D → 3D 이미지 | 업로드한 이미지의 픽셀을 밝기 기반 높이의 입체 기둥으로 |
| AI 인물 3D | 사진에서 깊이 추정 + 배경 제거로 사람을 실제 3D로 복원, OBJ/STL/GLB 내보내기 |

## 기술 스택

- **Vite** — 개발 서버 & 정적 빌드
- **TypeScript** — 엄격 모드(strict)로 타입 안전성 확보
- **Three.js** — WebGL 3D 렌더링 + OBJ/STL/GLB 익스포터
- **transformers.js v4** (`@huggingface/transformers`) — 브라우저 내 AI 추론(WebGPU 우선, WASM 폴백)
  - 깊이 추정: **Depth Anything V2 (Small)** — `onnx-community/depth-anything-v2-small`
  - 배경 제거: **MODNet 인물 매팅** — `Xenova/modnet`
  - 무거운 추론은 **Web Worker**(`src/vision/worker.ts`)에서 실행해 UI 프리징 방지
  - 모델은 최초 사용 시 클라이언트가 Hugging Face Hub 에서 내려받습니다(서버에 모델을 둘 필요 없음).
    완전 오프라인이 필요하면 모델 파일을 `public/` 아래 두고 `env.allowLocalModels`/`env.localModelPath` 를 조정하세요.

## 개발

```bash
npm install      # 최초 1회 의존성 설치
npm run dev      # 개발 서버 실행 (자동으로 브라우저 열림)
npm run build    # 타입 검사 + dist/ 정적 빌드 생성
npm run preview  # 빌드 결과 미리보기
npm run typecheck# 타입 검사만 수행
```

## 배포

`npm run build` 로 생성된 `dist/` 폴더의 내용을 **정적 파일**로 아무 웹 서버에 올리면 됩니다.
상대경로(`base: './'`)로 빌드되므로 도메인 루트든 하위 경로(`/3d/`)든 그대로 동작합니다.

예) Nginx:

```nginx
location /3d/ {
    alias /var/www/math3d/dist/;
    try_files $uri $uri/ =404;
}
```

## 폴더 구조

```
src/
├── main.ts               # 부트스트랩(진입점)
├── core/                 # 엔진 코어
│   ├── SceneManager.ts   #   씬·카메라·렌더러·렌더 루프
│   ├── ModeManager.ts    #   모드 등록·전환·자동 정리(메모리 해제)
│   └── types.ts          #   공용 인터페이스(Mode, ModeContext …)
├── modes/                # 데모 6종 (각 파일이 하나의 Mode)
│   ├── TransformMode.ts
│   ├── BezierMode.ts
│   ├── LightingMode.ts
│   ├── FluidMode.ts
│   ├── ImageMode.ts      #   2D 이미지 → 3D(밝기 기둥, AI 불필요, 가벼움)
│   └── PersonMode.ts     #   AI 인물 3D(깊이 추정+배경 제거+내보내기)
├── vision/               # AI 추론
│   ├── worker.ts         #   Web Worker: 깊이 추정 + 배경 제거
│   ├── VisionClient.ts   #   워커 래퍼(Promise + 진행률)
│   └── types.ts          #   워커 메시지 프로토콜
├── geometry/
│   └── reliefMesh.ts     #   깊이+마스크 → 닫힌(watertight) 입체 메쉬
├── ui/                   # DOM UI
│   ├── Panel.ts          #   컨트롤 패널 빌더
│   └── Tabs.ts           #   상단 탭바
├── utils/                # 공용 유틸
│   ├── dispose.ts        #   GPU 리소스 해제
│   ├── errors.ts         #   전역 예외 처리 + 오버레이 + WebGL 체크
│   ├── exporters.ts      #   OBJ/STL/GLB 내보내기
│   └── math.ts
└── styles/
    └── main.css
```

### 새 데모(모드) 추가하는 법

1. `src/modes/` 에 `Mode` 인터페이스를 구현하는 클래스를 만듭니다.
   - `enter(ctx)`: 객체 생성 & `ctx.panel` 로 UI 구성. `ctx.track(obj)` 로 등록한 객체는 자동 정리됩니다.
   - `update(dt, elapsed)`: 매 프레임 애니메이션(선택).
   - `exit()`: 참조 해제(선택). GPU 해제는 자동.
2. `src/main.ts` 의 `modeManager.register(new YourMode())` 에 한 줄 추가하면 탭이 생깁니다.

`prototype-standalone.html` 은 초기 단일 파일 프로토타입으로, 참고용으로만 남겨둡니다.
