import { supabase } from "../supabase-client.js";
import { merge3 } from "./merge.js";

export const STORE_KEY = "ironlog-v2";

/* Every save lands on this phone first (localStorage, per user), then syncs to the
   account. A copy that hasn't reached the account yet is marked dirty, so a
   killed app or dead gym wifi never loses a session.

   The account copy is one JSON blob, written whole. So that a device holding old data (the home
   screen app asleep in the background, a forgotten browser tab) can't overwrite what another
   device saved since, every copy remembers the `stamp` (server write time) of the account copy
   it builds on. A save checks the stamp first; if another device wrote in between, the two are
   merged rather than one replacing the other. */

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
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

async function readRemote() {
  const r = await window.storage.get(STORE_KEY);
  if (!r?.value) return null;
  const raw = JSON.parse(r.value);
  return { data: unwrap(raw), savedAt: raw.savedAt || 0, stamp: r.stamp ?? null };
}

/**
 * Loads { sessions, program, drafts, weighins, prefs }.
 * Resolves { data, offline, base } — data is null only when the account is confirmed empty;
 * base ({ data, stamp }) is the account copy this state builds on, for createSaver().start().
 * Throws when the account can't be reached and this phone has no copy, so the caller
 * never mistakes a network error for a new account.
 */
export async function loadState() {
  const key = await localKey();
  const local = readLocal(key); // { data, savedAt, dirty, stamp }
  let remote;
  try {
    remote = await readRemote();
  } catch (e) {
    if (local) return { data: local.data, offline: true, base: { data: local.dirty ? null : local.data, stamp: local.stamp ?? null } };
    throw e;
  }
  if (!remote) return { data: local?.data ?? null, offline: false, base: { data: null, stamp: null } };
  // Changes on this phone that never reached the account are kept. If the account moved on
  // since (another device saved), the two are merged.
  if (local?.dirty) {
    const data = local.stamp && local.stamp === remote.stamp ? local.data : merge3(undefined, local.data, remote.data);
    return { data, offline: false, base: { data: remote.data, stamp: remote.stamp } };
  }
  writeLocal(key, { data: remote.data, savedAt: remote.savedAt, dirty: false, stamp: remote.stamp });
  return { data: remote.data, offline: false, base: { data: remote.data, stamp: remote.stamp } };
}

/**
 * Returns { start(base), save(data), retry(), refresh() }. onStatus receives "pending" | "synced" | "offline".
 * onRemote(data, basis) hands over newer account data (merged with this device's edits where both
 * changed); `basis` is the state it was merged against, so the caller can keep edits made since.
 * shape(data) turns account data into app state (defaults filled in), so merges compare like with like.
 * Writes are serialized; only the newest state is sent after an in-flight write.
 */
export function createSaver(onStatus, onRemote, shape = (d) => d) {
  const keyP = localKey();
  let base = { data: null, stamp: null };
  let latest = null;
  let running = false;

  async function flush() {
    if (running || !latest) return;
    running = true;
    const rec = latest;
    latest = null;
    try {
      let data = rec.data;
      // Only download the account copy when another device wrote since this copy's base.
      const stamp = window.storage.stamp ? await window.storage.stamp(STORE_KEY) : base.stamp;
      if (stamp && stamp !== base.stamp) {
        const remote = await readRemote();
        if (remote) data = merge3(base.data ?? undefined, rec.data, shape(remote.data));
      }
      const res = await window.storage.set(STORE_KEY, JSON.stringify({ ...data, savedAt: rec.savedAt }));
      base = { data, stamp: res?.stamp ?? null };
      if (!same(data, rec.data)) {
        // Edits made while this write was in flight build on rec, not on the merge: fold them in too.
        if (latest) latest = { ...latest, data: merge3(rec.data, latest.data, data) };
        onRemote?.(data, rec.data);
      }
      if (!latest) { writeLocal(await keyP, { data, savedAt: rec.savedAt, dirty: false, stamp: base.stamp }); onStatus("synced"); }
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
    start(b) { base = b || { data: null, stamp: null }; },
    async save(data) {
      if (!latest && !running && same(data, base.data)) return; // nothing new, e.g. just loaded
      const rec = { data, savedAt: Date.now(), dirty: true, stamp: base.stamp };
      writeLocal(await keyP, rec);
      latest = rec;
      onStatus("pending");
      flush();
    },
    retry: flush,
    /** Picks up another device's saves, e.g. when the app comes back to the foreground. */
    async refresh() {
      if (running || latest || !window.storage.stamp) return;
      try {
        const stamp = await window.storage.stamp(STORE_KEY);
        if (!stamp || stamp === base.stamp || running || latest) return;
        const remote = await readRemote();
        if (!remote || running || latest) return;
        const was = base.data;
        base = { data: shape(remote.data), stamp: remote.stamp };
        writeLocal(await keyP, { data: remote.data, savedAt: remote.savedAt, dirty: false, stamp: remote.stamp });
        onRemote?.(base.data, was);
      } catch {} // offline: the next save or resume tries again
    },
  };
}
