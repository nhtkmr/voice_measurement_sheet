import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyTolerance,
  saveTemplate,
  listTemplates,
  loadTemplates,
  getTemplate,
  templateKey,
  exportTemplatesJson,
  importTemplatesJson,
} from './template';
import { toleranceLabel } from './format';
import type { MeasureItem } from './types';

// Node環境向けの最小 localStorage モック
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
});

describe('applyTolerance', () => {
  it('基準値＋公差から上限/下限を計算', () => {
    const r = applyTolerance({
      id: 'x', label: 'A', type: 'dimension', nominal: 10, upperTol: 0.05, lowerTol: -0.05,
    });
    expect(r.upper).toBe(10.05);
    expect(r.lower).toBe(9.95);
  });
  it('浮動小数ノイズを丸める', () => {
    const r = applyTolerance({
      id: 'x', label: 'A', type: 'dimension', nominal: 0.1, upperTol: 0.2,
    });
    expect(r.upper).toBe(0.3); // 0.1+0.2 の桁ノイズを除去
  });
  it('片側公差', () => {
    const r = applyTolerance({
      id: 'x', label: 'A', type: 'dimension', nominal: 5, lowerTol: -0.1,
    });
    expect(r.lower).toBe(4.9);
    expect(r.upper).toBeUndefined();
  });
});

describe('toleranceLabel', () => {
  it('公差表記', () => {
    const it: MeasureItem = {
      id: 'x', label: 'A', type: 'dimension', nominal: 10, upperTol: 0.05, lowerTol: -0.05,
    };
    expect(toleranceLabel(it)).toBe('10 +0.05/-0.05');
  });
  it('公差が無く上限/下限のみなら範囲表記', () => {
    const it: MeasureItem = { id: 'x', label: 'A', type: 'dimension', lower: 9.95, upper: 10.05 };
    expect(toleranceLabel(it)).toBe('9.95〜10.05');
  });
  it('目視は空', () => {
    expect(toleranceLabel({ id: 'x', label: 'A', type: 'visual' })).toBe('');
  });
});

describe('テンプレJSON 書出/取込', () => {
  it('書出→取込でラウンドトリップする', () => {
    saveTemplate({
      partNo: 'P-1',
      name: '部品1',
      items: [applyTolerance({ id: 'a', label: '外径', type: 'dimension', nominal: 10, upperTol: 0.05, lowerTol: -0.05 })],
    });
    const json = exportTemplatesJson();

    localStorage.clear();
    const res = importTemplatesJson(json, 'merge');
    expect(res.added).toBe(1);
    expect(res.updated).toBe(0);

    const list = listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].partNo).toBe('P-1');
    expect(list[0].items[0].upper).toBe(10.05);
  });

  it('取込時に上限/下限を再計算する（改ざん耐性）', () => {
    const json = JSON.stringify({
      templates: [
        { partNo: 'P-2', items: [{ label: '径', type: 'dimension', nominal: 5, upperTol: 0.1, lowerTol: -0.1, upper: 999 }] },
      ],
    });
    importTemplatesJson(json, 'replace');
    const t = listTemplates().find((x) => x.partNo === 'P-2')!;
    expect(t.items[0].upper).toBe(5.1); // 999 ではなく再計算値
  });

  it('replace は全置換する', () => {
    saveTemplate({ partNo: 'OLD', items: [] });
    importTemplatesJson(JSON.stringify({ templates: [{ partNo: 'NEW', items: [] }] }), 'replace');
    const parts = listTemplates().map((t) => t.partNo);
    expect(parts).toEqual(['NEW']);
  });

  it('不正JSONは例外', () => {
    expect(() => importTemplatesJson('not json', 'merge')).toThrow();
    expect(() => importTemplatesJson('{}', 'merge')).toThrow();
  });
});

describe('3要素キー（品番＋品名＋工程）', () => {
  it('同一品番でも工程が違えば上書きされず共存する', () => {
    saveTemplate({ partNo: 'P', name: '部品', process: '旋盤', items: [] });
    saveTemplate({ partNo: 'P', name: '部品', process: '検査', items: [] });
    const list = listTemplates();
    expect(list).toHaveLength(2);
    expect(new Set(list.map((t) => t.process))).toEqual(new Set(['旋盤', '検査']));
  });

  it('品番・品名・工程がすべて同じなら上書きする', () => {
    saveTemplate({ partNo: 'P', name: '部品', process: '旋盤', items: [] });
    saveTemplate({
      partNo: 'P',
      name: '部品',
      process: '旋盤',
      items: [applyTolerance({ id: 'a', label: '径', type: 'dimension', nominal: 5 })],
    });
    const list = listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].items).toHaveLength(1);
  });

  it('旧形式（工程なし・品番キー）データを自動移行して読める', () => {
    // 旧レイアウト: localStorage に品番をキーにした工程なしテンプレを直接投入
    localStorage.setItem(
      'vms.templates',
      JSON.stringify({ 'P-OLD': { partNo: 'P-OLD', name: '旧部品', items: [] } })
    );
    const list = listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].partNo).toBe('P-OLD');
    // 複合キー（工程は空）で引ける
    const t = getTemplate(templateKey({ partNo: 'P-OLD', name: '旧部品' }));
    expect(t?.name).toBe('旧部品');
    // 保存キーも新形式（複合キー）へ組み替わっている
    expect(Object.keys(loadTemplates())[0]).toBe(templateKey({ partNo: 'P-OLD', name: '旧部品' }));
  });
});
