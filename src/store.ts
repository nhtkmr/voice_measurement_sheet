// 測定セッションの保存/読込。Azure Functions API (/api/sessions) 経由で
// サーバー(Cosmos DB)に保存し、ログインした全員で共有する。
// 「直近に開いていたセッションID」だけは端末ローカルの意味なので localStorage に残す。
import type { Session } from './types';

const CURRENT = 'vms.currentSessionId';
const API = '/api/sessions';

async function send(method: string, url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * 測定セッションを保存（自動保存にも使用）。
 * 保存できたかを返す。呼び出し側はこれを見てUI表示・再試行・切替可否を判断する
 * （黙って失敗するとデータ消失に気付けないため）。
 */
export async function saveSession(session: Session): Promise<boolean> {
  try {
    const res = await send('PUT', `${API}/${encodeURIComponent(session.id)}`, session);
    if (!res.ok) throw new Error(`saveSession failed: ${res.status}`);
    localStorage.setItem(CURRENT, session.id);
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function getSession(id: string): Promise<Session | undefined> {
  try {
    const res = await fetch(`${API}/${encodeURIComponent(id)}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`getSession failed: ${res.status}`);
    return (await res.json()) as Session;
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

export async function listSessions(): Promise<Session[]> {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`listSessions failed: ${res.status}`);
    const all = (await res.json()) as Session[];
    return all.sort((a, b) => b.date.localeCompare(a.date));
  } catch (e) {
    console.error(e);
    return [];
  }
}

export async function deleteSession(id: string): Promise<void> {
  try {
    const res = await send('DELETE', `${API}/${encodeURIComponent(id)}`);
    if (!res.ok && res.status !== 404) throw new Error(`deleteSession failed: ${res.status}`);
  } catch (e) {
    console.error(e);
  }
  if (localStorage.getItem(CURRENT) === id) localStorage.removeItem(CURRENT);
}

/** 直近に開いていたセッションIDを取得（再読込時の復元用・端末ローカル） */
export function getCurrentSessionId(): string | null {
  return localStorage.getItem(CURRENT);
}
