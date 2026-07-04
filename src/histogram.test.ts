import { describe, it, expect } from 'vitest';
import { binStepFor } from './histogram';
import type { MeasureItem } from './types';

const base = (o: Partial<MeasureItem>): MeasureItem => ({
  id: 'x',
  label: 'A',
  type: 'dimension',
  ...o,
});

describe('binStepFor', () => {
  it('公差2桁 ±0.05 → 0.01', () => {
    expect(binStepFor(base({ nominal: 10, upperTol: 0.05, lowerTol: -0.05 }))).toBeCloseTo(0.01, 10);
  });
  it('公差3桁 ±0.005 → 0.001', () => {
    expect(binStepFor(base({ nominal: 10, upperTol: 0.005, lowerTol: -0.005 }))).toBeCloseTo(0.001, 10);
  });
  it('公差1桁 ±0.1 → 0.1', () => {
    expect(binStepFor(base({ nominal: 10, upperTol: 0.1, lowerTol: -0.1 }))).toBeCloseTo(0.1, 10);
  });
  it('上下で桁が違う場合は細かい方（多い桁）を採用', () => {
    expect(binStepFor(base({ nominal: 10, upperTol: 0.1, lowerTol: -0.05 }))).toBeCloseTo(0.01, 10);
  });
  it('公差なし・上下限のみ(旧データ)は基準値との差から桁を推定', () => {
    expect(binStepFor(base({ nominal: 10, upper: 10.05, lower: 9.95 }))).toBeCloseTo(0.01, 10);
  });
  it('decimals があれば最優先（公差 0.100→3桁 の意図を反映して 0.001）', () => {
    // 入力 "0.100" は Number 化で 0.1(1桁) になるが、decimals=3 が保持される
    expect(binStepFor(base({ nominal: 10, upperTol: 0.1, lowerTol: -0.1, decimals: 3 }))).toBeCloseTo(0.001, 10);
  });
  it('decimals のみ指定でもフォールバックする', () => {
    expect(binStepFor(base({ decimals: 3 }))).toBeCloseTo(0.001, 10);
  });
  it('公差が整数(0桁)なら 1', () => {
    expect(binStepFor(base({ nominal: 100, upperTol: 2, lowerTol: -2 }))).toBeCloseTo(1, 10);
  });
});
