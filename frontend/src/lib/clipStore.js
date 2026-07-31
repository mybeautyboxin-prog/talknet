/**
 * IndexedDB wrapper for per-PTT audio clips (user-side, local-only).
 * Clips are 2-way (local mic + all remote audio), stored offline, never uploaded.
 * Retention: kept for CLIP_TTL_MS (48h) since creation, then auto-purged on load.
 */
const DB_NAME = "talknet_ptt_clips";
const STORE = "clips";
const VERSION = 1;

export const CLIP_TTL_MS = 48 * 60 * 60 * 1000; // 2 days

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _purgeExpired(db) {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const cutoff = Date.now() - CLIP_TTL_MS;
      const all = req.result || [];
      for (const c of all) {
        const t = new Date(c.created_at || 0).getTime();
        if (!t || t < cutoff) store.delete(c.id);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function listClips(roomId) {
  try {
    const db = await openDb();
    await _purgeExpired(db);
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        const filtered = roomId ? all.filter((c) => c.room_id === roomId) : all;
        // Newest first
        filtered.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
        resolve(filtered);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function addClip(clip) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(clip);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateClipNote(id, note) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const existing = req.result;
      if (existing) { existing.note = (note || "").slice(0, 200); store.put(existing); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteClip(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
