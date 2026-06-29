import { describe, it, expect, beforeEach } from 'vitest';
import {
  getNgVoice,
  setNgVoice,
  getAdvanceDir,
  setAdvanceDir,
  getSlowInput,
  setSlowInput,
} from './settings';

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
});

describe('NG音声設定', () => {
  it('既定は有効', () => {
    expect(getNgVoice()).toBe(true);
  });
  it('OFFを保存して読み出せる', () => {
    setNgVoice(false);
    expect(getNgVoice()).toBe(false);
    setNgVoice(true);
    expect(getNgVoice()).toBe(true);
  });
});

describe('ゆっくり入力設定', () => {
  it('既定は無効', () => {
    expect(getSlowInput()).toBe(false);
  });
  it('ONを保存して読み出せる', () => {
    setSlowInput(true);
    expect(getSlowInput()).toBe(true);
    setSlowInput(false);
    expect(getSlowInput()).toBe(false);
  });
});

describe('進む方向設定', () => {
  it('既定は項目方向(item)', () => {
    expect(getAdvanceDir()).toBe('item');
  });
  it('No.方向(row)を保存して読み出せる', () => {
    setAdvanceDir('row');
    expect(getAdvanceDir()).toBe('row');
    setAdvanceDir('item');
    expect(getAdvanceDir()).toBe('item');
  });
});
