/**
 * 학습된 image→3D 모델을 "사용"하는 클라이언트.
 *
 * 백엔드에 종속되지 않도록 단순한 계약(contract)만 정의합니다:
 *   POST {endpoint}  (multipart/form-data, field: image)
 *   →  응답이 다음 중 하나:
 *      1) NDJSON 진행률 스트림(application/x-ndjson): 줄마다 {progress, stage},
 *         마지막 줄 {done:true, glbBase64} — 진행 상황을 실시간 표시(로컬 서버).
 *      2) GLB 바이너리(model/gltf-binary)
 *      3) JSON { url: "...glb" } (비동기 작업 완료 후 결과 URL)
 *
 * 지금은 원하는 제공자(클라우드 API 또는 사장님 GPU 서버)를 endpoint 로 지정해 쓰고,
 * 나중에 직접 학습한 가중치로 백엔드만 바꾸면 이 코드는 그대로 재사용됩니다.
 */

export interface GenerateOptions {
  endpoint: string;
  apiKey?: string;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

/** endpoint 에 stream=1 쿼리를 안전하게 덧붙인다(기존 쿼리 보존). */
function withStreamParam(endpoint: string): string {
  try {
    const u = new URL(endpoint, window.location.href);
    if (!u.searchParams.has('stream')) u.searchParams.set('stream', '1');
    return u.toString();
  } catch {
    return endpoint + (endpoint.includes('?') ? '&' : '?') + 'stream=1';
  }
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function generate3D(image: Blob, opts: GenerateOptions): Promise<ArrayBuffer> {
  if (!opts.endpoint) throw new Error('생성 서버 엔드포인트(URL)가 설정되지 않았습니다.');

  const form = new FormData();
  form.append('image', image, 'input.png');

  const headers: Record<string, string> = {};
  if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;

  opts.onProgress?.('서버에 3D 생성 요청 중…');
  const res = await fetch(withStreamParam(opts.endpoint), {
    method: 'POST',
    body: form,
    headers,
    signal: opts.signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`서버 오류 ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
  }

  const contentType = res.headers.get('content-type') ?? '';

  // 1) NDJSON 진행률 스트림
  if (contentType.includes('application/x-ndjson') || contentType.includes('application/jsonl')) {
    return await readNdjsonStream(res, opts.onProgress);
  }

  // 2) JSON 응답(비동기 작업 URL 반환형)
  if (contentType.includes('application/json')) {
    const data = (await res.json()) as { url?: string; error?: string };
    if (data.error) throw new Error(`서버 에러: ${data.error}`);
    if (!data.url) throw new Error('서버 JSON 응답에 결과 url 이 없습니다.');
    opts.onProgress?.('생성된 GLB 내려받는 중…');
    const modelRes = await fetch(data.url, { signal: opts.signal });
    if (!modelRes.ok) throw new Error(`GLB 다운로드 실패 ${modelRes.status}`);
    return await modelRes.arrayBuffer();
  }

  // 3) 바이너리 GLB 직접 반환형
  opts.onProgress?.('GLB 수신 완료, 화면에 로드 중…');
  return await res.arrayBuffer();
}

async function readNdjsonStream(res: Response, onProgress?: (m: string) => void): Promise<ArrayBuffer> {
  if (!res.body) throw new Error('스트림 응답 본문이 없습니다.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let result: ArrayBuffer | null = null;

  const handle = (line: string) => {
    const s = line.trim();
    if (!s) return;
    let evt: { progress?: number; stage?: string; done?: boolean; error?: string; glbBase64?: string };
    try {
      evt = JSON.parse(s);
    } catch {
      return; // 부분 라인/비JSON 무시
    }
    if (evt.error) throw new Error(evt.error);
    if (typeof evt.progress === 'number' || evt.stage) {
      const pct = typeof evt.progress === 'number' ? `${Math.round(evt.progress * 100)}% · ` : '';
      onProgress?.(`${pct}${evt.stage ?? ''}`.trim());
    }
    if (evt.done && evt.glbBase64) result = base64ToArrayBuffer(evt.glbBase64);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      handle(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.trim()) handle(buf); // 마지막 개행 없는 라인 처리

  if (!result) throw new Error('스트림이 GLB 결과 없이 종료되었습니다.');
  return result;
}
