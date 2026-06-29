import type { MeasureItem, Row, ColumnStats } from './types';

/** 標本標準偏差 (n-1)。データ2点未満では null。 */
export function sampleStdDev(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * 列(測定項目)ごとの工程能力指標を計算する。
 * Cp  = (USL - LSL) / (6σ)
 * Cpk = min((USL - x̄)/(3σ), (x̄ - LSL)/(3σ))
 * 片側公差の場合は存在する側のみで Cpk を算出（Cp は両側必須）。
 */
export function columnStats(item: MeasureItem, rows: Row[], colIndex: number): ColumnStats {
  const values: number[] = [];
  let ngCount = 0;
  for (const r of rows) {
    const v = r.values[colIndex];
    if (v != null && !Number.isNaN(v)) values.push(v);
    if (r.judgments[colIndex] === 'NG') ngCount++;
  }

  const n = values.length;
  const m = mean(values);
  const sigma = sampleStdDev(values);
  const min = n ? Math.min(...values) : null;
  const max = n ? Math.max(...values) : null;

  let cp: number | null = null;
  let cpk: number | null = null;

  if (sigma != null && sigma > 0 && m != null && item.type === 'dimension') {
    const usl = item.upper;
    const lsl = item.lower;
    if (usl != null && lsl != null) {
      cp = (usl - lsl) / (6 * sigma);
    }
    const cpkCandidates: number[] = [];
    if (usl != null) cpkCandidates.push((usl - m) / (3 * sigma));
    if (lsl != null) cpkCandidates.push((m - lsl) / (3 * sigma));
    if (cpkCandidates.length) cpk = Math.min(...cpkCandidates);
  }

  return { n, mean: m, sigma, min, max, cp, cpk, ngCount };
}

/** Cpk の水準で色を返す（UI用）。 */
export function cpkLevelColor(cpk: number | null): string {
  if (cpk == null) return '#888';
  if (cpk >= 1.33) return '#2e7d32'; // 十分
  if (cpk >= 1.0) return '#f9a825'; // 要注意
  return '#c62828'; // 不足
}
