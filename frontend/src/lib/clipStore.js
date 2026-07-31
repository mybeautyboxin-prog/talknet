/**
 * IndexedDB wrapper for per-PTT audio clips (user-side, local-only).
 * Clips are 2-way (local mic + all remote audio), stored offline, never uploaded.
 */
const DB_NAME = "talknet_ptt_clips";
const STORE = "clips";
const VERSION = 1;

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

export async function listClips(roomId) {
  try {
    const db = await openDb();
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

export async function deleteClip(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
