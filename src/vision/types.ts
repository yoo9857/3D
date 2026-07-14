/** 메인 스레드 ↔ AI 워커 간 메시지 프로토콜 */

export interface ProcessRequest {
  type: 'process';
  id: number;
  /** RGBA 픽셀(길이 = width*height*4) */
  rgba: ArrayBuffer;
  width: number;
  height: number;
  /** 배경 제거 사용 여부 */
  removeBackground: boolean;
}

export type WorkerRequest = ProcessRequest;

export interface ProgressMessage {
  type: 'progress';
  phase: string;
  /** 0~1, 미정이면 생략 */
  progress?: number;
}

export interface ResultMessage {
  type: 'result';
  id: number;
  /** 깊이 맵 그레이스케일(0~255, 255=가장 가까움), 길이 = width*height */
  depth: ArrayBuffer;
  /** 전경 마스크(0~255, 255=사람), 길이 = width*height */
  mask: ArrayBuffer;
  width: number;
  height: number;
  /** 배경 제거/깊이 중 폴백이 사용됐는지 알림 */
  notes: string[];
}

export interface ErrorMessage {
  type: 'error';
  id: number;
  message: string;
}

export type WorkerResponse = ProgressMessage | ResultMessage | ErrorMessage;

/** 재구성 결과(메인에서 사용) */
export interface ReconstructionResult {
  depth: Uint8Array;
  mask: Uint8Array;
  width: number;
  height: number;
  notes: string[];
}
