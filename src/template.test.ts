import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  applyTolerance,
  saveTemplate,
  deleteTemplate,
  initTemplates,
  listTemplates,
  loadTemplates,
  getTemplate,
  templateKey,
  templateLabel,
  templateFieldError,
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

describe('templateLabel', () => {
  it('品番のみ', () => {
    expect(templateLabel({ partNo: 'P-100' })).toBe('P-100');
  });
  it('品番＋品名', () => {
    expect(templateLabel({ partNo: 'P-100', name: 'テスト部品' })).toBe('P-100 / テスト部品');
  });
  it('品番＋品名＋工程', () => {
    expect(templateLabel({ partNo: 'P-100', name: 'テスト部品', process: '外径工程' })).toBe(
      'P-100 / テスト部品 / 外径工程'
    );
  });
  it('品名が無く工程だけある場合も欠落した区切りが残らない', () => {
    expect(templateLabel({ partNo: 'P-100', process: '外径工程' })).toBe('P-100 / 外径工程');
  });
  it('空文字は未設定として扱う', () => {
    expect(templateLabel({ partNo: 'P-100', name: '', process: '' })).toBe('P-100');
  });
  it('Session もそのまま渡せる（同じ3フィールドを持つため）', () => {
    const session = {
      id: 's1', partNo: 'P-200', name: '別部品', process: '仕上げ',
      date: '2026-01-01T00:00:00.000Z', items: [], rows: [],
    };
    expect(templateLabel(session)).toBe('P-200 / 別部品 / 仕上げ');
  });
});

describe('templateFieldError（テンプレ消失につながる文字を弾く）', () => {
  it('正常な値は null（ハイフン・中間の空白は許可）', () => {
    expect(templateFieldError('品番', 'SAMPLE-001', true)).toBeNull();
    expect(templateFieldError('品番', 'ABC 123', true)).toBeNull();
    expect(templateFieldError('品名', '')).toBeNull(); // 品名は空でも可
  });
  it('品番が空なら弾く', () => {
    expect(templateFieldError('品番', '', true)).toContain('品番');
    expect(templateFieldError('品番', '   ', true)).toContain('品番');
  });
  it('Cosmos ID に使えない文字（/ \\ ? #）を弾く', () => {
    expect(templateFieldError('品番', 'ABC/123', true)).not.toBeNull();
    expect(templateFieldError('品番', 'A\\B', true)).not.toBeNull();
    expect(templateFieldError('品番', 'A?B', true)).not.toBeNull();
    expect(templateFieldError('品番', 'A#B', true)).not.toBeNull();
  });
  it('複合キーの区切り文字 U+241F を弾く', () => {
    expect(templateFieldError('品番', 'A␟B', true)).not.toBeNull();
  });
  it('制御文字（タブ等）を弾く', () => {
    expect(templateFieldError('品番', 'A\tB', true)).not.toBeNull();
  });
  it('前後の空白を弾く', () => {
    expect(templateFieldError('品番', ' P-1', true)).toContain('空白');
    expect(templateFieldError('品番', 'P-1 ', true)).toContain('空白');
  });
});

describe('未同期テンプレの保護（消失防止）', () => {
  // canSync() を true にするため window と fetch を用意する
  let calls: { method: string; url: string }[];
  beforeEach(() => {
    calls = [];
    (globalThis as any).window = {};
    vi.spyOn(console, 'error').mockImplementation(() => {}); // 想定内の失敗ログを抑制
  });
  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).fetch;
    vi.restoreAllMocks();
  });
  const mockFetch = (impl: (method: string, url: string) => any) => {
    (globalThis as any).fetch = vi.fn((url: string, init?: any) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      return Promise.resolve(impl(method, url));
    });
  };

  it('保存がサーバー失敗しても、次回の initTemplates で消えない（サーバー一覧に無くても残す）', async () => {
    // POST(upsert) は失敗、GET(initTemplates) は空一覧を返す
    mockFetch((method) =>
      method === 'GET'
        ? { ok: true, json: async () => [] }
        : { ok: false, status: 500 }
    );
    const ok = await saveTemplate({ partNo: 'P-NEW', items: [] });
    expect(ok).toBe(false); // サーバー保存は失敗
    expect(loadTemplates()['P-NEW␟␟']).toBeTruthy(); // ローカルには有る

    // サーバーは P-NEW を知らない。従来はここで消えていた。
    await initTemplates();
    expect(loadTemplates()['P-NEW␟␟']).toBeTruthy(); // 保護されて残る
  });

  it('サーバーが復帰したら再送され、保護対象から外れる', async () => {
    let serverHasIt = false;
    mockFetch((method) => {
      if (method === 'GET') return { ok: true, json: async () => (serverHasIt ? [{ partNo: 'P-NEW', items: [] }] : []) };
      if (method === 'POST') { serverHasIt = true; return { ok: true }; } // 今度は成功
      return { ok: true };
    });
    // 1回目: 失敗させて未同期にする
    (globalThis as any).fetch = vi.fn((_url: string, init?: any) =>
      Promise.resolve(init?.method === 'POST' ? { ok: false, status: 500 } : { ok: true, json: async () => [] })
    );
    await saveTemplate({ partNo: 'P-NEW', items: [] });

    // 2回目: POST が成功するモックに差し替え、initTemplates で再送
    mockFetch((method) => {
      if (method === 'GET') return { ok: true, json: async () => [] };
      if (method === 'POST') return { ok: true };
      return { ok: true };
    });
    await initTemplates();
    // 再送(POST)が呼ばれたこと＝保護対象を送り直している
    expect(calls.some((c) => c.method === 'POST')).toBe(true);
    // まだローカルに残っている（消えていない）
    expect(loadTemplates()['P-NEW␟␟']).toBeTruthy();
  });

  it('削除がサーバー失敗しても、次回の initTemplates でサーバーから復活しない', async () => {
    // まず正常に1件作る（POST 成功）
    mockFetch(() => ({ ok: true, json: async () => [] }));
    await saveTemplate({ partNo: 'P-DEL', items: [] });

    // 削除は失敗させる。GET はまだ P-DEL を返す（サーバー未反映）
    mockFetch((method) =>
      method === 'GET'
        ? { ok: true, json: async () => [{ partNo: 'P-DEL', items: [] }] }
        : { ok: false, status: 500 } // DELETE 失敗
    );
    const ok = await deleteTemplate('P-DEL␟␟');
    expect(ok).toBe(false);
    expect(loadTemplates()['P-DEL␟␟']).toBeUndefined(); // ローカルからは消えた

    // サーバーはまだ持っている。従来はここで復活していた。
    await initTemplates();
    expect(loadTemplates()['P-DEL␟␟']).toBeUndefined(); // 復活しない
  });
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
