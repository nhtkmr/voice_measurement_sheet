import type { MeasureItem } from './types';

function sign(v: number): string {
  return v >= 0 ? `+${v}` : `${v}`;
}

/**
 * 測定項目の公差を表示用文字列にする。
 * - 基準値＋上下公差があれば "10 +0.05/-0.05"
 * - 公差が無く上限/下限のみなら "9.95〜10.05"
 * - 目視/未設定は ''（呼び出し側で「目視」等を補う）
 */
export function toleranceLabel(it: MeasureItem): string {
  if (it.type !== 'dimension') return '';
  if (it.nominal != null && (it.upperTol != null || it.lowerTol != null)) {
    const u = it.upperTol != null ? sign(it.upperTol) : '';
    const l = it.lowerTol != null ? sign(it.lowerTol) : '';
    const tol = [u, l].filter(Boolean).join('/');
    return `${it.nominal} ${tol}`;
  }
  if (it.lower != null || it.upper != null) {
    return `${it.lower ?? ''}〜${it.upper ?? ''}`;
  }
  return '';
}
