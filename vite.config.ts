import { defineConfig } from 'vite';

// 상대경로 base('./')로 빌드하므로, 구매한 서버의 어떤 하위 경로에
// 올려도(예: https://example.com/3d/) 그대로 동작합니다.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 2400, // three.js + transformers.js 는 크므로 경고 완화
  },
  worker: {
    format: 'es', // AI 추론용 모듈 워커
  },
  optimizeDeps: {
    // onnxruntime-web 를 포함하므로 사전 번들링에서 제외(런타임 동적 로딩)
    exclude: ['@huggingface/transformers'],
  },
  server: {
    open: true,
    host: true,
  },
});
