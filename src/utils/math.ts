/** 상대 휘도(밝기): sRGB 가중 평균. 0(검정)~1(흰색) */
export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** 값을 [min, max] 범위로 제한 */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export const DEG2RAD = Math.PI / 180;
