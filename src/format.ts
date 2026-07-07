import type { MeasureItem } from './types';
import { isNumericItem } from './types';
import { formatAngle } from './angle';

function sign(v: number): string {
  return v >= 0 ? `+${v}` : `${v}`;
}

/**
 * 測定項目の公差を表示用文字列にする。
 * - 基準値＋上下公差があれば "10 +0.05/-0.05"
 * - 公差が無く上限/下限のみなら "9.95〜10.05"
 * - 角度は表示形式(小数/度分秒)に整形。対称公差は "±" 表記。
 * - 目視/未設定は ''（呼び出し側で「目視」等を補う）
 */
export function toleranceLabel(it: MeasureItem): string {
  if (!isNumericItem(it.type)) return '';
  if (it.type === 'angle') return angleToleranceLabel(it);
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

/** 角度項目の公差ラベル（表示形式に整形） */
function angleToleranceLabel(it: MeasureItem): string {
  const dms = (it.angleFormat ?? 'decimal') === 'dms';
  const fmtVal = (v: number) => formatAngle(v, dms ? 'dms' : 'decimal');
  const fmtTol = (v: number) =>
    (v >= 0 ? '+' : '-') + formatAngle(Math.abs(v), dms ? 'dms' : 'decimal');
  if (it.nominal != null && (it.upperTol != null || it.lowerTol != null)) {
    // 対称公差は "基準 ±tol" に集約
    if (
      it.upperTol != null &&
      it.lowerTol != null &&
      Math.abs(it.upperTol + it.lowerTol) < 1e-9
    ) {
      return `${fmtVal(it.nominal)} ±${formatAngle(Math.abs(it.upperTol), dms ? 'dms' : 'decimal')}`;
    }
    const u = it.upperTol != null ? fmtTol(it.upperTol) : '';
    const l = it.lowerTol != null ? fmtTol(it.lowerTol) : '';
    return `${fmtVal(it.nominal)} ${[u, l].filter(Boolean).join('/')}`;
  }
  if (it.lower != null || it.upper != null) {
    return `${it.lower != null ? fmtVal(it.lower) : ''}〜${it.upper != null ? fmtVal(it.upper) : ''}`;
  }
  return '';
}
