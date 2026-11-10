// A local recovery buffer; only an API confirmation counts as a saved revision.
const DATABASE = "learnai-recovery";
const STORE = "drafts";
let owner="local-demo";
export function setDraftOwner(value:string){owner=value;}
function draftKey(scope = "workbench"): string {
  let value = sessionStorage.getItem("learnai-tab");
  if (!value) { value = crypto.randomUUID(); sessionStorage.setItem("learnai-tab", value); }
  const key=scope === "workbench" ? value : `${value}:${scope}`;
  return owner==="local-demo"?key:`account:${owner}:${key}`;
}
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
let writes: Promise<unknown> = Promise.resolve();
export function flushDraftWrites():Promise<unknown>{return writes;}
export async function loadDraft<T>(scope = "workbench"): Promise<T | undefined> {
  const key=draftKey(scope);
  await writes.catch(() => undefined);
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export function writeDraft(value: unknown, scope = "workbench"): Promise<void> {
  const key=draftKey(scope);
  const next = writes.catch(() => undefined).then(() => persist(value, key));
  writes = next;
  return next;
}
async function persist(value: unknown, key: string): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      if (value === undefined) store.delete(key); else store.put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
