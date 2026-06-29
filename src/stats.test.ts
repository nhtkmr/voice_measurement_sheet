import { describe, it, expect } from 'vitest';
import { sampleStdDev, columnStats } from './stats';
import { judgeDimension } from './judge';
import type { MeasureItem, Row } from './types';

describe('sampleStdDev', () => {
  it('既知の値', () => {
    const s = sampleStdDev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s).toBeCloseTo(2.138, 2);
  });
  it('2点未満は null', () => {
    expect(sampleStdDev([1])).toBeNull();
  });
});

describe('judgeDimension', () => {
  const item: MeasureItem = {
    id: 'd',
    label: 'A',
    type: 'dimension',
    lower: 9.95,
    upper: 10.05,
  };
  it('公差内は OK', () => {
    expect(judgeDimension(item, 10.0)).toBe('OK');
  });
  it('上限超過は NG', () => {
    expect(judgeDimension(item, 10.06)).toBe('NG');
  });
  it('下限未満は NG', () => {
    expect(judgeDimension(item, 9.9)).toBe('NG');
  });
  it('境界はOK', () => {
    expect(judgeDimension(item, 10.05)).toBe('OK');
  });
});

describe('columnStats Cp/Cpk', () => {
  const item: MeasureItem = {
    id: 'd',
    label: 'A',
    type: 'dimension',
    lower: 4,
    upper: 16,
  };
  it('中央寄り: Cp=Cpk', () => {
    const vals = [9, 10, 11, 10, 10];
    const rows: Row[] = vals.map((v) => ({ values: [v], judgments: [judgeDimension(item, v)] }));
    const s = columnStats(item, rows, 0);
    expect(s.n).toBe(5);
    expect(s.mean).toBeCloseTo(10, 6);
    // sigma ~ 0.707, Cp = 12/(6*0.707) ~ 2.83
    expect(s.cp).toBeCloseTo(2.828, 2);
    expect(s.cpk).toBeCloseTo(s.cp as number, 2);
  });
});
