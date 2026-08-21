import type { ChatMessage } from '../types';

const DB_NAME = 'discordia';
const DB_VERSION = 1;
const STORE = 'chat';

export interface StoredChat extends ChatMessage {
  roomId: string;
  seq: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('by_room_seq', ['roomId', 'seq']);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function nextSeq(roomId: string): number {
  const key = `discordia:seq:${roomId}`;
  const cur = Number(localStorage.getItem(key) || '0');
  const next = cur + 1;
  try {
    localStorage.setItem(key, String(next));
  } catch {
    /* noop */
  }
  return next;
}

async function withStore(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function cursor(index: IDBIndex, range: IDBKeyRange, direction: IDBCursorDirection): Promise<StoredChat[]> {
  return new Promise((resolve, reject) => {
    const out: StoredChat[] = [];
    const req = index.openCursor(range, direction);
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        out.push(cursor.value as StoredChat);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/** Salva mensagens novas (com seq próprio) respeitando o limite de histórico. */
export async function appendMessages(roomId: string, messages: StoredChat[]): Promise<void> {
  if (!messages.length) return;
  await withStore('readwrite', (store) => {
    messages.forEach((m) => store.put(m));
    return store.count();
  });
  await trimRoom(roomId);
}

async function trimRoom(roomId: string, cap = 400): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const index = tx.objectStore(STORE).index('by_room_seq');
  const range = IDBKeyRange.bound([roomId, 0], [roomId, Number.MAX_SAFE_INTEGER]);
  const req = index.openCursor(range, 'prev');
  let excess = 0;
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    excess += 1;
    if (excess > cap) cursor.delete();
    cursor.continue();
  };
}

/** Últimas `limit` mensagens da sala (mais recentes primeiro). */
export async function loadRecent(roomId: string, limit: number): Promise<StoredChat[]> {
  const db = await openDB();
  const store = db.transaction(STORE).objectStore(STORE);
  const index = store.index('by_room_seq');
  const range = IDBKeyRange.bound([roomId, 0], [roomId, Number.MAX_SAFE_INTEGER]);
  const rows = await cursor(index, range, 'prev');
  return rows.slice(0, limit).reverse();
}

/** Mensagens anteriores a `beforeSeq`, limitadas (mais antigas primeiro). */
export async function loadBefore(roomId: string, beforeSeq: number, limit: number): Promise<StoredChat[]> {
  const db = await openDB();
  const store = db.transaction(STORE).objectStore(STORE);
  const index = store.index('by_room_seq');
  const range = IDBKeyRange.bound([roomId, 0], [roomId, beforeSeq - 1]);
  const rows = await cursor(index, range, 'prev');
  return rows.slice(0, limit).reverse();
}

export async function hasMessages(roomId: string): Promise<boolean> {
  const db = await openDB();
  const store = db.transaction(STORE).objectStore(STORE);
  const index = store.index('by_room_seq');
  const range = IDBKeyRange.bound([roomId, 0], [roomId, Number.MAX_SAFE_INTEGER]);
  const req = index.count(range);
  return new Promise<boolean>((resolve) => {
    req.onsuccess = () => resolve(req.result > 0);
    req.onerror = () => resolve(false);
  });
}

/** Remove uma mensagem pelo ID. */
export async function deleteMessage(messageId: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(messageId));
}