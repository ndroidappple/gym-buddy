import { supabase } from "../supabase-client.js";

export const STORE_KEY = "ironlog-v2";

/* Every save lands on this phone first (localStorage, per user), then syncs to the
   account. A copy that hasn't reached the account yet is marked dirty, so a
   killed app or dead gym wifi never loses a session. */

async function localKey() {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  return id ? `${STORE_KEY}:${id}` : null;
}

function readLocal(key) {
  try { const raw = key && localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function writeLocal(key, rec) {
  try { if (key) localStorage.setItem(key, JSON.stringify(rec)); } catch {}
}

const unwrap = ({ savedAt, ...data }) => data;

/**
 * Loads { sessions, program, drafts }.
 * Resolves { data, offline } — data is null only when the account is confirmed empty.
 * Throws when the account can't be reached and this phone has no copy, so the caller
 * never mistakes a network error for a new account.
 */
export async function loadState() {
  const key = await localKey();
  const local = readLocal(key); // { data, savedAt, dirty }
  let remote;
  try {
    const r = await window.storage.get(STORE_KEY);
    remote = r?.value ? JSON.parse(r.value) : null;
  } catch (e) {
    if (local) return { data: local.data, offline: true };
    throw e;
  }
  // Unsynced changes on this phone that are newer than the account copy win.
  if (local && (!remote || (local.dirty && local.savedAt >= (remote.savedAt || 0)))) {
    return { data: local.data, offline: false };
  }
  if (!remote) return { data: null, offline: false };
  const data = unwrap(remote);
  writeLocal(key, { data, savedAt: remote.savedAt || 0, dirty: false });
  return { data, offline: false };
}

/**
 * Returns { save(data), retry() }. onStatus receives "pending" | "synced" | "offline".
 * Writes are serialized; only the newest state is sent after an in-flight write.
 */
export function createSaver(onStatus) {
  const keyP = localKey();
  let latest = null;
  let running = false;

  async function flush() {
    if (running || !latest) return;
    running = true;
    const rec = latest;
    latest = null;
    try {
      await window.storage.set(STORE_KEY, JSON.stringify({ ...rec.data, savedAt: rec.savedAt }));
      if (!latest) { writeLocal(await keyP, { ...rec, dirty: false }); onStatus("synced"); }
    } catch {
      if (!latest) latest = rec;
      running = false;
      onStatus("offline");
      return;
    }
    running = false;
    flush();
  }

  return {
    async save(data) {
      const rec = { data, savedAt: Date.now(), dirty: true };
      writeLocal(await keyP, rec);
      latest = rec;
      onStatus("pending");
      flush();
    },
    retry: flush,
  };
}
