import { describe, it, expect } from 'vitest';
import { toleranceLabel } from './format';
import { applyTolerance } from './template';
import { dmsToDeg } from './angle';
import type { MeasureItem } from './types';

const angle = (o: Partial<MeasureItem>): MeasureItem =>
  applyTolerance({ id: 'a', label: '角', type: 'angle', angleFormat: 'dms', ...o } as MeasureItem);

describe('toleranceLabel 角度(度分秒)', () => {
  it('非対称は +上/-下 を表示', () => {
    const it = angle({
      nominal: dmsToDeg(45, 30, 0),
      upperTol: dmsToDeg(0, 0, 30),
      lowerTol: -dmsToDeg(0, 0, 20),
    });
    expect(toleranceLabel(it)).toBe(`45°30'0" +0°0'30"/-0°0'20"`);
  });
  it('対称は ± に集約', () => {
    const it = angle({
      nominal: dmsToDeg(45, 30, 0),
      upperTol: dmsToDeg(0, 0, 30),
      lowerTol: -dmsToDeg(0, 0, 30),
    });
    expect(toleranceLabel(it)).toBe(`45°30'0" ±0°0'30"`);
  });
  it('片側のみ(上公差だけ)', () => {
    const it = angle({ nominal: dmsToDeg(45, 0, 0), upperTol: dmsToDeg(0, 1, 0) });
    expect(toleranceLabel(it)).toBe(`45°0'0" +0°1'0"`);
  });
});
