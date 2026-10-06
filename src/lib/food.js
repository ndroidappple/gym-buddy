import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase-client.js";
import { today } from "./util.js";
import { addDays } from "./nutrition.js";

/* Food log storage. Unlike workouts (one JSON record per account), food lives in its own tables
   (food_entries, foods) because it grows fast: thousands of rows a year, and a save must not
   rewrite all of them. Same promise as workouts, though: every change lands on this phone first
   (localStorage), then an outbox sends it to Supabase, retrying until it's through. Ids are made
   here, so a retried insert is an upsert of the same row and never a duplicate. */

const WINDOW_DAYS = 120; // how far back the app loads entries
const KEY = (uid) => `ironlog-food:${uid}`;
const ENTRY_COLS = ["id", "date", "meal", "name", "brand", "amount", "unit", "grams", "kcal", "protein", "carbs", "fat", "source", "source_ref", "basis", "created_at", "updated_at"];
const FOOD_COLS = ["id", "name", "brand", "basis", "created_at", "updated_at"];
const pick = (o, cols) => Object.fromEntries(cols.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export const newId = () => (crypto.randomUUID ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

function readLocal(uid) {
  try { return JSON.parse(localStorage.getItem(KEY(uid))) || null; } catch { return null; }
}
function writeLocal(uid, s) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(s)); } catch {}
}
const EMPTY = { entries: {}, foods: {}, outbox: [] };

/**
 * The food log for the signed-in lifter, or nothing while `enabled` is false.
 * Returns { ready, entries, foods, status, addEntry, updateEntry, removeEntry, addFood, removeFood }.
 * status: "synced" | "pending" | "offline".
 */
export function useFood(enabled) {
  const [uid, setUid] = useState(null);
  const [state, setState] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("synced");
  const stateRef = useRef(state);
  const flushing = useRef(false);

  // Computed from the ref (not inside a state updater) so the outbox is current before flush runs.
  const commit = useCallback((fn) => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    if (uid) writeLocal(uid, next);
    setState(next);
  }, [uid]);

  // Sends queued changes in order; stops at the first failure and tries again later.
  const flush = useCallback(async () => {
    if (flushing.current || !uid) return;
    flushing.current = true;
    try {
      for (;;) {
        const op = stateRef.current.outbox[0];
        if (!op) { setStatus("synced"); break; }
        setStatus("pending");
        const t = supabase.from(op.table);
        const { error } = op.op === "delete" ? await t.delete().eq("id", op.id) : await t.upsert({ ...op.row, user_id: uid });
        if (error) {
          // A row the database rejects (a bad value) would block the queue forever: drop it.
          if (error.code && /^(22|23)/.test(error.code)) console.warn("food: dropped a rejected change", error.message);
          else { setStatus("offline"); break; }
        }
        commit((s) => ({ ...s, outbox: s.outbox.filter((x) => x !== op) }));
      }
    } catch {
      setStatus("offline");
    } finally {
      flushing.current = false;
    }
  }, [uid, commit]);

  // Load: this phone's copy first (instant, works offline), then the account's rows on top.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const id = data.session?.user?.id;
      if (!id || !alive) return;
      setUid(id);
      const local = readLocal(id) || EMPTY;
      stateRef.current = local;
      setState(local);
      setReady(true);
      try {
        const since = addDays(today(), -WINDOW_DAYS);
        const [e, f] = await Promise.all([
          supabase.from("food_entries").select(ENTRY_COLS.join(",")).gte("date", since).order("created_at"),
          supabase.from("foods").select(FOOD_COLS.join(",")).order("created_at"),
        ]);
        if (e.error || f.error) throw e.error || f.error;
        if (!alive) return;
        const cur = stateRef.current;
        // Anything still waiting in the outbox is newer than the account's copy: keep it.
        const pending = new Set(cur.outbox.map((o) => o.id));
        const merge = (rows, mine) => {
          const out = Object.fromEntries((rows || []).map((r) => [r.id, r]));
          for (const [k, v] of Object.entries(mine)) if (pending.has(k)) out[k] = v;
          for (const o of cur.outbox) if (o.op === "delete") delete out[o.id];
          return out;
        };
        const next = { ...cur, entries: merge(e.data, cur.entries), foods: merge(f.data, cur.foods) };
        stateRef.current = next;
        setState(next);
        writeLocal(id, next);
      } catch {
        if (alive) setStatus("offline");
      }
    })();
    return () => { alive = false; };
  }, [enabled]);

  useEffect(() => { if (ready) flush(); }, [ready, flush]);

  // While changes are waiting: retry when the connection or the app comes back, and every 30 s.
  useEffect(() => {
    if (status === "synced") return;
    const retry = () => flush();
    const onVis = () => { if (document.visibilityState === "visible") retry(); };
    addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVis);
    const id = setInterval(retry, 30000);
    return () => { removeEventListener("online", retry); document.removeEventListener("visibilitychange", onVis); clearInterval(id); };
  }, [status, flush]);

  const queue = useCallback((table, key, op, row) => {
    const now = new Date().toISOString();
    commit((s) => {
      const list = { ...s[key] };
      let rec = null;
      if (op === "delete") delete list[row.id];
      else { rec = { ...list[row.id], ...row, updated_at: now, created_at: list[row.id]?.created_at || now }; list[row.id] = rec; }
      // Later edits to the same row replace its queued one; a delete cancels a queued upsert.
      const outbox = s.outbox.filter((o) => !(o.table === table && o.id === row.id && o.op === "upsert"));
      outbox.push(op === "delete" ? { table, op, id: row.id } : { table, op, id: row.id, row: pick(rec, table === "foods" ? FOOD_COLS : ENTRY_COLS) });
      return { ...s, [key]: list, outbox };
    });
    setTimeout(flush, 0);
  }, [commit, flush]);

  const addEntry = useCallback((row) => { const id = row.id || newId(); queue("food_entries", "entries", "upsert", { ...row, id }); return id; }, [queue]);
  const updateEntry = useCallback((id, patch) => queue("food_entries", "entries", "upsert", { ...stateRef.current.entries[id], ...patch, id }), [queue]);
  const removeEntry = useCallback((id) => queue("food_entries", "entries", "delete", { id }), [queue]);
  const addFood = useCallback((row) => { const id = row.id || newId(); queue("foods", "foods", "upsert", { ...row, id }); return id; }, [queue]);
  const updateFood = useCallback((id, patch) => queue("foods", "foods", "upsert", { ...stateRef.current.foods[id], ...patch, id }), [queue]);
  const removeFood = useCallback((id) => queue("foods", "foods", "delete", { id }), [queue]);

  return {
    ready: enabled && ready,
    entries: Object.values(state.entries),
    foods: Object.values(state.foods),
    status: enabled ? status : "synced",
    addEntry, updateEntry, removeEntry, addFood, updateFood, removeFood,
  };
}

/** The saved food an entry was logged from (by Tank or from "Your foods"), if it still exists. */
export const savedFoodFor = (foods, entry) => (entry?.source_ref && ["custom", "ai"].includes(entry.source) ? foods.find((f) => f.id === entry.source_ref) || null : null);
