import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase-client.js";
import { newId } from "./food.js";

/* The conversation with the head coach, and what the coach remembers. Same promise as the food
   log: every change lands on this phone first (localStorage), then an outbox sends it to Supabase
   (coach_messages, coach_memory), retrying until it's through. Messages are kept 30 days here and
   on the server (a nightly job deletes older ones); the memory notes are how older things carry on.

   The thread is split into chats (meta.chat on each message). A chat goes quiet after CHAT_GAP_MS
   without a message: the next visit opens a new one, and the old one stays under past chats.
   Messages saved before chats existed are split wherever an hour passed between two of them. */

export const KEEP_DAYS = 30;
const KEY = (uid) => `ironlog-coach:${uid}`;
const COLS = ["id", "coach", "role", "content", "meta", "created_at", "updated_at"];
const pick = (o) => Object.fromEntries(COLS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const cutoff = () => new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
const EMPTY = { messages: {}, notes: [], notesAt: null, outbox: [], current: null }; // current: { id, at } of the chat picked on this phone
export const CHAT_GAP_MS = 3600_000;
export const MAX_NOTES = 20;

function readLocal(uid) {
  try { return JSON.parse(localStorage.getItem(KEY(uid))) || null; } catch { return null; }
}
function writeLocal(uid, s) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(s)); } catch {}
}
const fresh = (messages) => { const c = cutoff(); return Object.fromEntries(Object.entries(messages).filter(([, m]) => (m.created_at || "") >= c)); };

/** Saved messages (oldest first) as chats: [{ id, messages, start, end }], each oldest first. */
export function splitChats(rows) {
  const chats = new Map();
  let lastOld = null, oldKey = null;
  for (const r of rows) {
    let key = r.meta?.chat;
    if (!key) {
      const t = Date.parse(r.created_at);
      if (lastOld == null || t - lastOld >= CHAT_GAP_MS) oldKey = `old:${r.id}`;
      lastOld = t;
      key = oldKey;
    }
    if (!chats.has(key)) chats.set(key, { id: key, messages: [] });
    chats.get(key).messages.push(r);
  }
  return [...chats.values()].map((c) => ({ ...c, start: c.messages[0].created_at, end: c.messages[c.messages.length - 1].created_at }));
}

/** Cleans what the model sent as memory: short, distinct, non-empty strings. */
export function cleanNotes(notes) {
  const out = [];
  for (const n of Array.isArray(notes) ? notes : []) {
    const t = typeof n === "string" ? n.replace(/\s+/g, " ").trim().slice(0, 140) : "";
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, MAX_NOTES);
}

/**
 * The head coach thread for the signed-in lifter. Returns { ready, messages (oldest first), chats,
 * chatId (the chat to open now; null for a new one), notes, status, addMessage, updateMessage, setNotes,
 * clearMessages, newChat, openChat }. status: "synced" | "pending" | "offline".
 */
export function useCoachThread(enabled = true) {
  const [uid, setUid] = useState(null);
  const [state, setState] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("synced");
  const stateRef = useRef(state);
  const flushing = useRef(false);

  const commit = useCallback((fn) => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    if (uid) writeLocal(uid, next);
    setState(next);
  }, [uid]);

  const flush = useCallback(async () => {
    if (flushing.current || !uid) return;
    flushing.current = true;
    try {
      for (;;) {
        const op = stateRef.current.outbox[0];
        if (!op) { setStatus("synced"); break; }
        setStatus("pending");
        const { error } = op.op === "clear"
          ? await supabase.from("coach_messages").delete().eq("user_id", uid).lte("created_at", op.before)
          : op.table === "coach_memory"
            ? await supabase.from("coach_memory").upsert({ user_id: uid, notes: op.row.notes, updated_at: op.row.updated_at })
            : await supabase.from("coach_messages").upsert({ ...op.row, user_id: uid });
        if (error) {
          // A row the database rejects (a bad value) would block the queue forever: drop it.
          if (error.code && /^(22|23)/.test(error.code)) console.warn("coach: dropped a rejected change", error.message);
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

  // The account's copy on top of this phone's. Anything still queued here, or written after this
  // read began, is newer, so it's kept.
  const pull = useCallback(async (id) => {
    const started = new Date().toISOString();
    const [m, n] = await Promise.all([
      supabase.from("coach_messages").select(COLS.join(",")).gte("created_at", cutoff()).order("created_at").limit(500),
      supabase.from("coach_memory").select("notes, updated_at").maybeSingle(),
    ]);
    if (m.error || n.error) throw m.error || n.error;
    const cur = stateRef.current;
    const pending = new Set(cur.outbox.map((o) => o.id));
    const messages = Object.fromEntries((m.data || []).map((r) => [r.id, r]));
    for (const [k, v] of Object.entries(cur.messages)) if (pending.has(k) || (v.updated_at || "") > started) messages[k] = v;
    const clear = cur.outbox.filter((o) => o.op === "clear").pop();
    if (clear) for (const [k, v] of Object.entries(messages)) if (v.created_at <= clear.before) delete messages[k];
    const memoryQueued = cur.outbox.some((o) => o.table === "coach_memory");
    const theirs = n.data && (!cur.notesAt || n.data.updated_at > cur.notesAt);
    const next = {
      ...cur,
      messages: fresh(messages),
      ...(!memoryQueued && theirs ? { notes: cleanNotes(n.data.notes), notesAt: n.data.updated_at } : {}),
    };
    stateRef.current = next;
    setState(next);
    writeLocal(id, next);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const id = data.session?.user?.id;
      if (!id || !alive) return;
      setUid(id);
      const local = readLocal(id) || EMPTY;
      const start = { ...EMPTY, ...local, messages: fresh(local.messages || {}) };
      stateRef.current = start;
      setState(start);
      setReady(true);
      try { if (alive) await pull(id); } catch { if (alive) setStatus("offline"); }
    })();
    return () => { alive = false; };
  }, [enabled, pull]);

  // A chat from another phone shows up when the app comes back to the front. At most every 10 s.
  useEffect(() => {
    if (!uid) return;
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 10000) return;
      last = Date.now();
      pull(uid).catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    addEventListener("focus", refresh);
    return () => { document.removeEventListener("visibilitychange", refresh); removeEventListener("focus", refresh); };
  }, [uid, pull]);

  useEffect(() => { if (ready) flush(); }, [ready, flush]);
  useEffect(() => {
    if (status === "synced") return;
    const retry = () => flush();
    const onVis = () => { if (document.visibilityState === "visible") retry(); };
    addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVis);
    const id = setInterval(retry, 30000);
    return () => { removeEventListener("online", retry); document.removeEventListener("visibilitychange", onVis); clearInterval(id); };
  }, [status, flush]);

  const later = useCallback(() => setTimeout(flush, 0), [flush]);

  const putMessage = useCallback((row) => {
    const now = new Date().toISOString();
    commit((s) => {
      const rec = { ...s.messages[row.id], ...row, updated_at: now, created_at: s.messages[row.id]?.created_at || row.created_at || now };
      const outbox = s.outbox.filter((o) => !(o.table === "coach_messages" && o.id === row.id));
      outbox.push({ table: "coach_messages", op: "upsert", id: row.id, row: pick(rec) });
      return { ...s, messages: { ...s.messages, [row.id]: rec }, outbox };
    });
    later();
  }, [commit, later]);

  const addMessage = useCallback((row) => { const id = row.id || newId(); putMessage({ ...row, id }); return id; }, [putMessage]);
  const updateMessage = useCallback((id, patch) => { if (stateRef.current.messages[id]) putMessage({ ...patch, id }); }, [putMessage]);
  const setNotes = useCallback((notes) => {
    const now = new Date().toISOString();
    const clean = cleanNotes(notes);
    commit((s) => ({ ...s, notes: clean, notesAt: now, outbox: [...s.outbox.filter((o) => o.table !== "coach_memory"), { table: "coach_memory", op: "upsert", id: "memory", row: { notes: clean, updated_at: now } }] }));
    later();
  }, [commit, later]);
  const clearMessages = useCallback(() => {
    const before = new Date().toISOString();
    commit((s) => ({ ...s, messages: {}, outbox: [...s.outbox.filter((o) => o.table !== "coach_messages"), { table: "coach_messages", op: "clear", id: "clear", before }] }));
    later();
  }, [commit, later]);

  // Starting or reopening a chat is this phone's choice: it isn't sent anywhere. Returns the chat's id.
  const pickChat = useCallback((id) => { commit((s) => ({ ...s, current: { id, at: new Date().toISOString() } })); return id; }, [commit]);
  const newChat = useCallback(() => pickChat(newId()), [pickChat]);

  const messages = useMemo(() => Object.values(state.messages).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")), [state.messages]);
  const chats = useMemo(() => splitChats(messages), [messages]);
  // The chat picked here while it's active (picked or written to within the hour), else the latest
  // chat while it's active, else none: a new one starts.
  const active = (at) => !!at && Date.now() - Date.parse(at) < CHAT_GAP_MS;
  const cur = state.current;
  const latest = chats.reduce((b, c) => (!b || c.end > b.end ? c : b), null);
  const chatId = cur && (active(cur.at) || active(chats.find((c) => c.id === cur.id)?.end)) ? cur.id : active(latest?.end) ? latest.id : null;
  return { ready: enabled && ready, messages, chats, chatId, notes: state.notes, status: enabled ? status : "synced", addMessage, updateMessage, setNotes, clearMessages, newChat, openChat: pickChat };
}
