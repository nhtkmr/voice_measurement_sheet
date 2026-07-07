import { describe, it, expect } from 'vitest';
import { dmsToDeg, degToDms, formatAngle, parseAngle } from './angle';

describe('dmsToDeg / degToDms', () => {
  it('45°30\'15" ↔ 45.504166...°', () => {
    const deg = dmsToDeg(45, 30, 15);
    expect(deg).toBeCloseTo(45.504166, 5);
    expect(degToDms(deg)).toEqual({ d: 45, m: 30, s: 15, neg: false });
  });
  it('負の角度', () => {
    expect(dmsToDeg(-1, 0, 30)).toBeCloseTo(-1.008333, 5);
    expect(degToDms(-1.008333)).toEqual({ d: 1, m: 0, s: 30, neg: true });
  });
  it('秒の繰り上がり（59.6秒→次の分へ）', () => {
    // 0°0'59.6" ≒ 0.016555…°、丸めると 0°1'0"
    expect(degToDms(59.6 / 3600)).toEqual({ d: 0, m: 1, s: 0, neg: false });
  });
});

describe('formatAngle', () => {
  it('度分秒表示', () => {
    expect(formatAngle(45.504166, 'dms')).toBe(`45°30'15"`);
  });
  it('小数度表示', () => {
    expect(formatAngle(45.504166, 'decimal', 3)).toBe('45.504');
  });
});

describe('parseAngle', () => {
  it('度分秒マーカー', () => {
    expect(parseAngle('45度30分15秒')).toBeCloseTo(45.504166, 5);
  });
  it('記号 °\'"', () => {
    expect(parseAngle(`45°30'15"`)).toBeCloseTo(45.504166, 5);
  });
  it('秒省略', () => {
    expect(parseAngle('45度30分')).toBeCloseTo(45.5, 6);
  });
  it('空白区切り 3 値', () => {
    expect(parseAngle('45 30 15')).toBeCloseTo(45.504166, 5);
  });
  it('小数度（単一値）', () => {
    expect(parseAngle('45.5')).toBeCloseTo(45.5, 6);
  });
  it('漢数字＋点（音声ゆらぎ）', () => {
    expect(parseAngle('四十五点五')).toBeCloseTo(45.5, 6);
  });
  it('解釈不可は null', () => {
    expect(parseAngle('あいうえお')).toBeNull();
  });
});
