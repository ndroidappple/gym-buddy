import { useEffect, useMemo, useRef } from "react";
import { supabase } from "../supabase-client.js";
import { wanting } from "./heart.js";

/* Google Health on the phone side. The server (api/google-health.js) holds the connection, sends
   weight and food, and reads heart rate; this asks it to. prefs.googleHealth ({ on, since, heart })
   remembers on the account that it's connected (and whether heart rate was allowed), so every phone
   signed in knows. */

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

async function ask(action, extra = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let res;
  try {
    res = await fetch("/api/google-health", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, tz: tz(), ...extra }),
    });
  } catch {
    throw new Error("No connection. Try again when you're back online.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Couldn't reach Google Health. Try again in a minute.");
  return body;
}

// Connecting leaves the app for Google's page; this notes when, so coming back checks how it went.
const PENDING = "gymbuddy-google-health-connecting";
export const connecting = () => { try { return Date.now() - Number(localStorage.getItem(PENDING) || 0) < 30 * 60_000; } catch { return false; } };
export const doneConnecting = () => { try { localStorage.removeItem(PENDING); } catch {} };

/** Opens Google's page to allow GymBuddy in. Throws with a message fit to show. */
export async function connectGoogleHealth() {
  const { url } = await ask("connect");
  try { localStorage.setItem(PENDING, String(Date.now())); } catch {}
  location.href = url;
}
/** { connected, since, syncedAt, error, allowed: { workouts, weight, food } } */
export const googleHealthStatus = () => ask("status");
export const disconnectGoogleHealth = () => ask("disconnect");

/** Sends what's new, a batch at a time. Resolves { connected, sent, removed, error }. */
export async function syncGoogleHealth() {
  let sent = 0, removed = 0, out;
  for (let i = 0; i < 10; i++) {
    out = await ask("sync");
    sent += out.sent || 0;
    removed += out.removed || 0;
    if (!out.connected || !out.more) break;
  }
  return { ...out, sent, removed };
}

/**
 * Keeps Google Health up to date while it's on: once everything has saved to the account (the
 * server reads it from there), a few seconds after the last change. Changes made while offline or
 * that failed go on the next change or when the app comes back to the front. `onGone` runs when
 * the server says it isn't connected any more (they took access away in their Google account).
 */
export function useGoogleHealthSync({ on, synced, sessions, weighins, food, onGone }) {
  // What the server would send, roughly: a change here means something to send.
  const sig = useMemo(() => (on ? JSON.stringify([
    sessions.map((s) => [s.id, s.date, s.finishedAt, s.bw, Object.values(s.sets || {}).reduce((n, v) => n + v.length, 0)]),
    weighins,
    (food || []).map((f) => [f.id, f.date, f.meal, f.name, f.amount, f.kcal, f.protein, f.carbs, f.fat]),
  ]) : ""), [on, sessions, weighins, food]);
  const done = useRef(null); // the sig last sent in full
  const gone = useRef(onGone);
  gone.current = onGone;

  useEffect(() => {
    if (!on || !synced || sig === done.current) return;
    let stop = false;
    const run = () => syncGoogleHealth().then((r) => {
      if (stop) return;
      if (!r.connected) { gone.current?.(); return; }
      if (!r.error) done.current = sig;
    }).catch(() => {});
    const t = setTimeout(run, 4000);
    const onVis = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearTimeout(t); document.removeEventListener("visibilitychange", onVis); };
  }, [on, synced, sig]);
}

/**
 * Heart rate for recent workouts (see heart.js): asks Google Health for each finished workout that
 * hasn't got it complete yet, when the app opens or comes back to the front and every 5 minutes
 * while it's open. Watches sync on their own schedule, so a workout just finished is asked again
 * until its readings reach the end. `onReadings(id, readings)` gets each workout's readings;
 * `onAllowed(false)` runs when heart rate isn't allowed (they unticked it on Google's page).
 */
export function useHeartRate({ on, sessions, onReadings, onAllowed, onGone }) {
  const latest = useRef({ sessions, onReadings, onAllowed, onGone });
  latest.current = { sessions, onReadings, onAllowed, onGone };
  const busy = useRef(false);
  const tried = useRef({}); // id -> when this phone last asked, so a workout with nothing yet isn't asked every minute

  useEffect(() => {
    if (!on) return;
    let stop = false;
    const run = async () => {
      if (busy.current || stop || document.visibilityState !== "visible") return;
      busy.current = true;
      try {
        const now = Date.now();
        const due = wanting(latest.current.sessions, now).filter((s) => !(now - (tried.current[s.id] || 0) < 10 * 60_000)).slice(0, 12);
        for (let i = 0; i < due.length && !stop; i += 4) {
          const batch = due.slice(i, i + 4);
          batch.forEach((s) => { tried.current[s.id] = now; });
          const r = await ask("heart", { workouts: batch.map((s) => ({ id: s.id, start: s.startedAt, end: s.finishedAt })) });
          if (!r.connected) { latest.current.onGone?.(); return; }
          if (!r.allowed) { latest.current.onAllowed?.(false); return; }
          for (const s of batch) if (r.readings[s.id]) latest.current.onReadings(s.id, r.readings[s.id]);
        }
      } catch {} finally { busy.current = false; }
    };
    const t = setTimeout(run, 3000);
    const id = setInterval(run, 5 * 60_000);
    const onVis = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearTimeout(t); clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [on]);
}
