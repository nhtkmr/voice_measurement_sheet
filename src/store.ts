import { openDB, type IDBPDatabase } from 'idb';
import type { Session } from './types';

const DB_NAME = 'vms';
const STORE = 'sessions';
const CURRENT = 'vms.currentSessionId';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/** 測定セッションを保存（自動保存にも使用） */
export async function saveSession(session: Session): Promise<void> {
  const d = await db();
  await d.put(STORE, session);
  localStorage.setItem(CURRENT, session.id);
}

export async function getSession(id: string): Promise<Session | undefined> {
  const d = await db();
  return d.get(STORE, id);
}

export async function listSessions(): Promise<Session[]> {
  const d = await db();
  const all = (await d.getAll(STORE)) as Session[];
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

export async function deleteSession(id: string): Promise<void> {
  const d = await db();
  await d.delete(STORE, id);
  if (localStorage.getItem(CURRENT) === id) localStorage.removeItem(CURRENT);
}

/** 直近に開いていたセッションIDを取得（再読込時の復元用） */
export function getCurrentSessionId(): string | null {
  return localStorage.getItem(CURRENT);
}
