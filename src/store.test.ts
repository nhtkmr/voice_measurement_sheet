import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { saveSession, getSession, listSessions, deleteSession, getCurrentSessionId } from './store';
import type { Session } from './types';

// Node環境向けの最小 localStorage モック（template.test.ts と同じ方式）
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  // 失敗ケースで console.error が出るのは想定内なので黙らせる
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const session = (): Session => ({
  id: 'sess-1',
  partNo: 'P-1',
  date: '2026-01-01T00:00:00.000Z',
  items: [],
  rows: [],
});

/** fetch を差し替える。res は Response 相当の最小オブジェクト。 */
function mockFetch(impl: (url: string, init?: any) => any): void {
  (globalThis as any).fetch = vi.fn(impl);
}

describe('saveSession', () => {
  it('成功したら true を返し、現在のセッションIDを記録する', async () => {
    mockFetch(() => ({ ok: true, status: 200 }));
    expect(await saveSession(session())).toBe(true);
    expect(getCurrentSessionId()).toBe('sess-1');
  });

  it('セッション全量を PUT する（差分ではないので再送だけで復旧できる）', async () => {
    let captured: any;
    mockFetch((url, init) => {
      captured = { url, method: init.method, body: JSON.parse(init.body) };
      return { ok: true, status: 200 };
    });
    await saveSession(session());
    expect(captured.method).toBe('PUT');
    expect(captured.url).toBe('/api/sessions/sess-1');
    expect(captured.body).toEqual(session());
  });

  // ここが本題: 失敗を呼び出し側へ伝えられること（従来は void で握り潰していた）
  it('サーバーが 500 を返したら false（保存済みとして記録しない）', async () => {
    mockFetch(() => ({ ok: false, status: 500 }));
    expect(await saveSession(session())).toBe(false);
    expect(getCurrentSessionId()).toBe(null);
  });

  it('ネットワーク断（fetch が throw）でも例外を投げず false', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await saveSession(session())).toBe(false);
    expect(getCurrentSessionId()).toBe(null);
  });

  it('失敗後に復帰したら true になる（再送だけで復旧する）', async () => {
    let up = false;
    mockFetch(() => (up ? { ok: true, status: 200 } : { ok: false, status: 503 }));
    expect(await saveSession(session())).toBe(false);
    up = true;
    expect(await saveSession(session())).toBe(true);
    expect(getCurrentSessionId()).toBe('sess-1');
  });
});

describe('getSession', () => {
  it('404 は undefined（エラーではない）', async () => {
    mockFetch(() => ({ ok: false, status: 404 }));
    expect(await getSession('nope')).toBeUndefined();
  });

  it('失敗時も例外を投げず undefined', async () => {
    mockFetch(() => {
      throw new Error('boom');
    });
    expect(await getSession('x')).toBeUndefined();
  });
});

describe('listSessions', () => {
  it('日時の降順で返す', async () => {
    mockFetch(() => ({
      ok: true,
      status: 200,
      json: async () => [
        { ...session(), id: 'old', date: '2026-01-01T00:00:00.000Z' },
        { ...session(), id: 'new', date: '2026-06-01T00:00:00.000Z' },
      ],
    }));
    expect((await listSessions()).map((s) => s.id)).toEqual(['new', 'old']);
  });

  it('失敗時は空配列（アプリを止めない）', async () => {
    mockFetch(() => ({ ok: false, status: 500 }));
    expect(await listSessions()).toEqual([]);
  });
});

describe('deleteSession', () => {
  it('削除したら現在のセッションIDを消す', async () => {
    mockFetch(() => ({ ok: true, status: 200 }));
    await saveSession(session());
    expect(getCurrentSessionId()).toBe('sess-1');
    await deleteSession('sess-1');
    expect(getCurrentSessionId()).toBe(null);
  });

  it('別IDの削除では現在のセッションIDを消さない', async () => {
    mockFetch(() => ({ ok: true, status: 200 }));
    await saveSession(session());
    await deleteSession('other');
    expect(getCurrentSessionId()).toBe('sess-1');
  });
});
