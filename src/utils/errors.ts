/**
 * 전역 예외 처리 유틸.
 * 사용자에게는 친절한 한국어 오버레이를 보여주고,
 * 개발자를 위해 콘솔에도 원본 오류를 남깁니다.
 */

function escapeHtml(input: string): string {
  const div = document.createElement('div');
  div.textContent = input;
  return div.innerHTML;
}

/** 오류 오버레이를 표시합니다. */
export function showError(title: string, detail?: string): void {
  // 콘솔에는 항상 원본을 남긴다
  console.error(`[Math3D] ${title}`, detail ?? '');

  const el = document.getElementById('error-overlay');
  if (!el) return;

  el.hidden = false;
  el.innerHTML = `
    <div class="error-box">
      <h2>⚠️ ${escapeHtml(title)}</h2>
      ${detail ? `<pre>${escapeHtml(detail)}</pre>` : ''}
      <button type="button" id="error-dismiss">닫기</button>
    </div>`;

  document.getElementById('error-dismiss')?.addEventListener('click', () => {
    el.hidden = true;
    el.innerHTML = '';
  });
}

/** 함수 실행을 감싸 예외를 오버레이로 표시합니다(치명적이지 않은 작업용). */
export function guard<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    showError(`${label} 처리 중 오류가 발생했습니다`, err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

/** 앱 시작 시 1회 호출: 잡히지 않은 예외를 오버레이로 표시 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    showError('예상치 못한 오류', event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    showError('처리되지 않은 비동기 오류', reason instanceof Error ? reason.message : String(reason));
  });
}

/** WebGL 지원 여부 확인 */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return (
      typeof WebGLRenderingContext !== 'undefined' &&
      (canvas.getContext('webgl') !== null || canvas.getContext('experimental-webgl') !== null)
    );
  } catch {
    return false;
  }
}
