import type { MeasureItem, Judgment } from './types';

/**
 * 寸法項目の公差から良否を自動判定する。
 * - 公差(upper/lower)が無い、または値が無い場合は null（判定不可）
 */
export function judgeDimension(item: MeasureItem, value: number | null): Judgment {
  if (value == null || Number.isNaN(value)) return null;
  if (item.type !== 'dimension') return null;
  const hasUpper = item.upper != null;
  const hasLower = item.lower != null;
  if (!hasUpper && !hasLower) return null;
  if (hasLower && value < (item.lower as number)) return 'NG';
  if (hasUpper && value > (item.upper as number)) return 'NG';
  return 'OK';
}
