/**
 * Offline-first POS queue.
 *
 * Sales are written to IndexedDB (with a localStorage fallback) before the
 * network is attempted, so an outage never loses a transaction. Every entry
 * carries a client-generated idempotency key, which the server uses to make
 * re-synchronisation safe (a retried sale can never be recorded twice).
 */

export type QueuedSale = {
  id: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: string;
  status: "pending" | "syncing" | "failed";
  attempts: number;
  lastError?: string;
  localNumber: string;
  total: string;
};

const DB_NAME = "mervo-pos";
const STORE = "sales";
const LS_KEY = "mervo-pos-queue";

function idbAvailable(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function lsRead(): QueuedSale[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as QueuedSale[];
  } catch {
    return [];
  }
}
function lsWrite(rows: QueuedSale[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(rows));
}

export async function enqueueSale(entry: QueuedSale): Promise<void> {
  if (idbAvailable()) {
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return;
    } catch {
      /* fall through to localStorage */
    }
  }
  lsWrite([...lsRead().filter((r) => r.id !== entry.id), entry]);
}

export async function listQueue(): Promise<QueuedSale[]> {
  if (idbAvailable()) {
    try {
      const db = await openDb();
      const rows = await new Promise<QueuedSale[]>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result as QueuedSale[]);
        req.onerror = () => reject(req.error);
      });
      return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch {
      /* fall through */
    }
  }
  return lsRead().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function updateQueuedSale(id: string, patch: Partial<QueuedSale>): Promise<void> {
  const rows = await listQueue();
  const next = rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
  if (idbAvailable()) {
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        next.forEach((row) => tx.objectStore(STORE).put(row));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return;
    } catch {
      /* fall through */
    }
  }
  lsWrite(next);
}

export async function removeQueuedSale(id: string): Promise<void> {
  if (idbAvailable()) {
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return;
    } catch {
      /* fall through */
    }
  }
  lsWrite(lsRead().filter((r) => r.id !== id));
}

export type SyncOutcome = { synced: number; failed: number; results: { id: string; ok: boolean; error?: string; number?: string }[] };

/** Pushes every queued sale to the server; safe to call repeatedly. */
export async function syncQueue(onProgress?: (remaining: number) => void): Promise<SyncOutcome> {
  const queue = (await listQueue()).filter((q) => q.status !== "syncing");
  const outcome: SyncOutcome = { synced: 0, failed: 0, results: [] };
  for (const entry of queue) {
    await updateQueuedSale(entry.id, { status: "syncing" });
    try {
      const res = await fetch("/api/pos/sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entry.payload),
      });
      const json = (await res.json()) as { ok: boolean; data?: { number: string }; error?: string };
      if (res.ok && json.ok) {
        await removeQueuedSale(entry.id);
        outcome.synced++;
        outcome.results.push({ id: entry.id, ok: true, number: json.data?.number });
      } else if (res.status === 401 || res.status === 403) {
        await updateQueuedSale(entry.id, { status: "failed", lastError: json.error ?? "Not authorised", attempts: entry.attempts });
        outcome.failed++;
        outcome.results.push({ id: entry.id, ok: false, error: json.error });
      } else {
        await updateQueuedSale(entry.id, { status: "failed", lastError: json.error ?? `HTTP ${res.status}`, attempts: entry.attempts + 1 });
        outcome.failed++;
        outcome.results.push({ id: entry.id, ok: false, error: json.error });
      }
    } catch (error) {
      await updateQueuedSale(entry.id, { status: "pending", lastError: error instanceof Error ? error.message : "Network error", attempts: entry.attempts + 1 });
      outcome.failed++;
      outcome.results.push({ id: entry.id, ok: false, error: "Network unavailable" });
    }
    onProgress?.(queue.length - (outcome.synced + outcome.failed));
  }
  return outcome;
}

export const newLocalNumber = () => `LOCAL-${Date.now().toString(36).toUpperCase()}`;
export const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? `pos-${crypto.randomUUID()}` : `pos-${Date.now()}-${Math.random().toString(36).slice(2)}`;
