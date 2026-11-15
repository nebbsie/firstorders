// Imported towns are kept in the browser so each one downloads once.
const DB = 'first-orders', STORE = 'maps';
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise(res => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
  } catch { return undefined; }
}
export async function cachePut(key: string, value: unknown) {
  try {
    const db = await open();
    await new Promise(res => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(value, key); t.oncomplete = res; t.onerror = res; });
  } catch { /* storage is a convenience; the import still works without it */ }
}
