import { describe, it, expect } from 'vitest';
import { parseNumber, parseCommand } from './numberParser';

describe('parseNumber', () => {
  it('算用数字の小数', () => {
    expect(parseNumber('12.34')).toBe(12.34);
  });
  it('「点」区切り', () => {
    expect(parseNumber('12点34')).toBe(12.34);
  });
  it('「てん」「コンマ」', () => {
    expect(parseNumber('12てん3')).toBe(12.3);
    expect(parseNumber('0コンマ5')).toBe(0.5);
  });
  it('マイナス', () => {
    expect(parseNumber('マイナス0点5')).toBe(-0.5);
    expect(parseNumber('-1.2')).toBe(-1.2);
  });
  it('漢数字 整数', () => {
    expect(parseNumber('十二')).toBe(12);
    expect(parseNumber('二十三')).toBe(23);
    expect(parseNumber('百五')).toBe(105);
  });
  it('漢数字 小数（桁ごと）', () => {
    expect(parseNumber('十二点三四')).toBe(12.34);
  });
  it('全角と単位語の除去', () => {
    expect(parseNumber('１２．３ミリ')).toBe(12.3);
    expect(parseNumber('25mm')).toBe(25);
  });
  it('解釈不可は null', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('あいうえお')).toBeNull();
    expect(parseNumber('1.2.3')).toBeNull();
  });
  it('ゆっくり入力: 断片の連結が1数値として解ける', () => {
    // ゆっくり区切って話した断片を連結したもの（main.ts の保留バッファ相当）
    expect(parseNumber('12' + '点' + '34')).toBe(12.34);
    expect(parseNumber('十二' + '点' + '三四')).toBe(12.34);
    expect(parseNumber('マイナス' + '0点' + '5')).toBe(-0.5);
  });
});

describe('parseCommand', () => {
  it('ナビゲーション', () => {
    expect(parseCommand('次')).toBe('next');
    expect(parseCommand('戻る')).toBe('prev');
    expect(parseCommand('やり直し')).toBe('undo');
  });
  it('良否', () => {
    expect(parseCommand('OK')).toBe('ok');
    expect(parseCommand('エヌジー')).toBe('ng');
  });
  it('非コマンドは null', () => {
    expect(parseCommand('12.3')).toBeNull();
  });
});
