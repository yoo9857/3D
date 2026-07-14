/// <reference lib="webworker" />
/**
 * AI 추론 워커.
 * - 깊이 추정: Depth Anything V2 (Small)  — 픽셀별 거리
 * - 배경 제거: MODNet 인물 매팅          — 사람만 오려냄
 * WebGPU 우선, 미지원 시 WASM 으로 브라우저에서 직접 실행합니다.
 * 무거운 연산을 메인 스레드와 분리해 UI 가 멈추지 않습니다.
 */
import {
  pipeline,
  RawImage,
  env,
  type DepthEstimationPipeline,
  type BackgroundRemovalPipeline,
} from '@huggingface/transformers';
import { luminance } from '../utils/math';
import type { ProcessRequest, WorkerResponse } from './types';

// 원격(Hugging Face Hub)에서 모델을 받아옵니다.
env.allowLocalModels = false;

// ---- 편집 지점: 최신 모델로 교체 가능 ----
const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';
const SEG_MODEL = 'Xenova/modnet'; // 인물 매팅에 특화

// WebGPU 가 있으면 우선 시도하고, 실패하면 WASM 으로 자동 재시도합니다.
const HAS_GPU = typeof (self.navigator as Navigator & { gpu?: unknown }).gpu !== 'undefined';
const DEVICE_ORDER: Array<'webgpu' | 'wasm'> = HAS_GPU ? ['webgpu', 'wasm'] : ['wasm'];

function post(msg: WorkerResponse, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

function progress(phase: string, value?: number): void {
  post({ type: 'progress', phase, progress: value });
}

// ---- 모델은 최초 1회만 로드 후 재사용 ----
let depthEstimator: DepthEstimationPipeline | null = null;
let bgRemover: BackgroundRemovalPipeline | null = null;

/** device 를 순서대로 시도(webgpu → wasm)하며 파이프라인을 로드 */
async function loadWithFallback<T>(task: string, model: string): Promise<T> {
  let lastErr: unknown;
  for (const device of DEVICE_ORDER) {
    try {
      // @ts-expect-error task 문자열은 런타임에 검증됨
      return (await pipeline(task, model, { device })) as T;
    } catch (err) {
      lastErr = err;
      if (device !== DEVICE_ORDER[DEVICE_ORDER.length - 1]) {
        progress(`${device} 초기화 실패 → WASM 으로 재시도…`);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function ensureDepth(): Promise<DepthEstimationPipeline> {
  if (!depthEstimator) {
    progress('깊이 추정 모델 불러오는 중… (최초 1회, 수십 MB)');
    depthEstimator = await loadWithFallback<DepthEstimationPipeline>('depth-estimation', DEPTH_MODEL);
  }
  return depthEstimator;
}

async function ensureBg(): Promise<BackgroundRemovalPipeline> {
  if (!bgRemover) {
    progress('배경 제거 모델 불러오는 중… (최초 1회)');
    bgRemover = await loadWithFallback<BackgroundRemovalPipeline>('background-removal', SEG_MODEL);
  }
  return bgRemover;
}

/** 전경 마스크 추정. 실패 시 전체 전경(255)으로 폴백 */
async function estimateMask(image: RawImage, w: number, h: number, notes: string[]): Promise<Uint8Array> {
  try {
    const remover = await ensureBg();
    progress('사람 오려내는 중…');
    const out = await remover(image);
    const result = Array.isArray(out) ? out[0] : out;
    // 결과는 RGBA — 알파 채널이 곧 전경 마스크 (resize 는 비동기)
    const rgba = (await result.resize(w, h)).rgba();
    const data = rgba.data as Uint8ClampedArray;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3];
    return mask;
  } catch (err) {
    notes.push(`배경 제거 실패 → 배경 유지 (${err instanceof Error ? err.message : String(err)})`);
    return new Uint8Array(w * h).fill(255);
  }
}

/** 깊이 맵 추정. 실패 시 밝기 기반으로 폴백 */
async function estimateDepth(
  image: RawImage,
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  notes: string[],
): Promise<Uint8Array> {
  try {
    const estimator = await ensureDepth();
    progress('깊이 추정 중…');
    const out = await estimator(image);
    const single = Array.isArray(out) ? out[0] : out;
    const depthImg = (await single.depth.resize(w, h)).grayscale();
    return new Uint8Array(depthImg.data as Uint8Array);
  } catch (err) {
    notes.push(`깊이 추정 실패 → 밝기 기반으로 대체 (${err instanceof Error ? err.message : String(err)})`);
    const fallback = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const j = i * 4;
      fallback[i] = Math.round(luminance(rgba[j], rgba[j + 1], rgba[j + 2]));
    }
    return fallback;
  }
}

async function handleProcess(req: ProcessRequest): Promise<void> {
  const { id, width: w, height: h } = req;
  const rgba = new Uint8ClampedArray(req.rgba);
  const image = new RawImage(new Uint8ClampedArray(rgba), w, h, 4).rgb();
  const notes: string[] = [];

  const depth = await estimateDepth(image, rgba, w, h, notes);
  const mask = req.removeBackground
    ? await estimateMask(image, w, h, notes)
    : new Uint8Array(w * h).fill(255);

  progress('메쉬 생성 중…');
  const depthBuf = depth.buffer as ArrayBuffer;
  const maskBuf = mask.buffer as ArrayBuffer;
  post(
    {
      type: 'result',
      id,
      depth: depthBuf,
      mask: maskBuf,
      width: w,
      height: h,
      notes,
    },
    [depthBuf, maskBuf],
  );
}

self.addEventListener('message', (event: MessageEvent<ProcessRequest>) => {
  const req = event.data;
  if (req.type === 'process') {
    handleProcess(req).catch((err) => {
      post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
    });
  }
});
