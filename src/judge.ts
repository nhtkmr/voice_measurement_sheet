import type { MeasureItem, Judgment } from './types';
import { isNumericItem } from './types';

/**
 * 寸法・角度項目の公差から良否を自動判定する。
 * - 公差(upper/lower)が無い、または値が無い場合は null（判定不可）
 * - 角度は内部値(10進度)で比較するため寸法と同じロジックで扱える。
 */
export function judgeDimension(item: MeasureItem, value: number | null): Judgment {
  if (value == null || Number.isNaN(value)) return null;
  if (!isNumericItem(item.type)) return null;
  const hasUpper = item.upper != null;
  const hasLower = item.lower != null;
  if (!hasUpper && !hasLower) return null;
  if (hasLower && value < (item.lower as number)) return 'NG';
  if (hasUpper && value > (item.upper as number)) return 'NG';
  return 'OK';
}
