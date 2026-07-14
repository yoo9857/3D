import type { ReconstructionResult, WorkerResponse } from './types';

type ProgressCb = (phase: string, progress?: number) => void;

interface Pending {
  resolve: (r: ReconstructionResult) => void;
  reject: (e: Error) => void;
  onProgress?: ProgressCb;
}

/**
 * AI 워커를 감싸 Promise 기반 API 를 제공.
 * 워커는 최초 사용 시 지연 생성되어, 이 모드를 쓰지 않으면 자원을 낭비하지 않습니다.
 */
export class VisionClient {
  private worker: Worker | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.onMessage(event.data);
    worker.onerror = (event) => {
      const err = new Error(event.message || 'AI 워커 오류');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  private onMessage(msg: WorkerResponse): void {
    if (msg.type === 'progress') {
      // 진행 메시지는 가장 최근 작업으로 전달
      for (const p of this.pending.values()) p.onProgress?.(msg.phase, msg.progress);
      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.type === 'error') {
      pending.reject(new Error(msg.message));
    } else {
      pending.resolve({
        depth: new Uint8Array(msg.depth),
        mask: new Uint8Array(msg.mask),
        width: msg.width,
        height: msg.height,
        notes: msg.notes,
      });
    }
  }

  /** 이미지(RGBA)를 보내 깊이·마스크를 재구성 */
  reconstruct(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    removeBackground: boolean,
    onProgress?: ProgressCb,
  ): Promise<ReconstructionResult> {
    const worker = this.ensureWorker();
    const id = ++this.seq;
    // 전송용 버퍼 복사(원본 보존)
    const buffer = rgba.slice().buffer;
    return new Promise<ReconstructionResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ type: 'process', id, rgba: buffer, width, height, removeBackground }, [buffer]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
