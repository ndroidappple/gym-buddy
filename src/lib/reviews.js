import { supabase } from "../supabase-client.js";
import { REVIEW_PREFIX, reviewKey } from "./weekReview.js";

/* Week in review storage on the phone side. Reviews are written by api/review.js and saved to the
   account (storage_kv, week-review:<date>); this reads them, keeps a copy on the phone so a review
   opens instantly (and offline), and asks the server to write one. */

const CACHE = (uid) => `gymbuddy-reviews:${uid}`;
// Every review's date and headline (the full copies above stop at 12): a list opens complete.
const INDEX = (uid) => `gymbuddy-review-list:${uid}`;
async function uid() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id || null;
}
function readCache(id) {
  try { return (id && JSON.parse(localStorage.getItem(CACHE(id)))) || {}; } catch { return {}; }
}
function writeCache(id, reviews) {
  // The newest 12 weeks are plenty on the phone; the account keeps them all.
  const keep = Object.fromEntries(Object.entries(reviews).sort(([a], [b]) => b.localeCompare(a)).slice(0, 12));
  try { if (id) localStorage.setItem(CACHE(id), JSON.stringify(keep)); } catch {}
}
function remember(id, ...reviews) {
  const add = reviews.filter((r) => r?.weekEnd && r.story);
  if (add.length) writeCache(id, { ...readCache(id), ...Object.fromEntries(add.map((r) => [r.weekEnd, r])) });
}
const summaries = (reviews) => Object.values(reviews).sort((a, b) => b.weekEnd.localeCompare(a.weekEnd))
  .map((r) => ({ weekEnd: r.weekEnd, headline: r.story?.headline || "" }));
function readIndex(id) {
  try { return (id && JSON.parse(localStorage.getItem(INDEX(id)))) || []; } catch { return []; }
}
/** The index and the full copies together, one row a week, newest first. */
function known(id) {
  const rows = new Map(readIndex(id).map((r) => [r.weekEnd, r]));
  for (const r of summaries(readCache(id))) rows.set(r.weekEnd, r);
  return [...rows.values()].sort((a, b) => b.weekEnd.localeCompare(a.weekEnd));
}

/* Who's signed in, known without waiting, so a list can draw from this phone's copies on its first
   frame instead of popping in once the account answers. */
let signedIn = null;
supabase.auth.onAuthStateChange((_e, s) => { signedIn = s?.user?.id || null; });

/** The reviews this phone already has, newest first, right now: what a list shows while listReviews asks the account. */
export function cachedReviews(limit = 26) {
  return known(signedIn).slice(0, limit);
}

/** This phone's copy of a week's review, if it has one. */
export async function cachedReview(weekEnd) {
  return readCache(await uid())[weekEnd] || null;
}

/** A week's review from the account (null if it hasn't been written). */
export async function loadReview(weekEnd) {
  const id = await uid();
  const r = await window.storage.get(reviewKey(weekEnd));
  const review = r?.value ? JSON.parse(r.value) : null;
  remember(id, review);
  return review;
}

/** Past reviews, newest first: [{ weekEnd, headline }]. Falls back to the phone's copies offline. */
export async function listReviews(limit = 26) {
  const id = await uid();
  try {
    const { data, error } = await supabase.from("storage_kv").select("key, value").eq("user_id", id)
      .like("key", `${REVIEW_PREFIX}%`).order("key", { ascending: false }).limit(limit);
    if (error) throw error;
    const reviews = data.map((row) => { try { return JSON.parse(row.value); } catch { return null; } }).filter((r) => r?.weekEnd);
    remember(id, ...reviews);
    const list = reviews.map((r) => ({ weekEnd: r.weekEnd, headline: r.story?.headline || "" }));
    // A shorter list than the index already holds only refreshes the newest rows.
    const all = new Map([...readIndex(id), ...list].map((r) => [r.weekEnd, r]));
    try { if (id) localStorage.setItem(INDEX(id), JSON.stringify([...all.values()].sort((a, b) => b.weekEnd.localeCompare(a.weekEnd)))); } catch {}
    return list;
  } catch {
    return known(id).slice(0, limit);
  }
}

/**
 * Asks the coaches to write (or, with refresh, update) a week's review. Resolves the review.
 * Throws an Error with a message fit to show when it can't.
 */
export function requestReview(weekEnd, { refresh = false } = {}) {
  // The early write (App) and the cards opening can ask at the same time: one request serves both.
  const k = `${weekEnd}:${refresh}`;
  if (!inflight.has(k)) inflight.set(k, send(weekEnd, refresh).finally(() => inflight.delete(k)));
  return inflight.get(k);
}
const inflight = new Map();

async function send(weekEnd, refresh) {
  const id = await uid();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let res;
  try {
    res = await fetch("/api/review", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ weekEnd, refresh, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
  } catch {
    // The connection dropped, but the server may have finished and saved it.
    const saved = await loadReview(weekEnd).catch(() => null);
    if (saved && !refresh) return saved;
    throw new Error("No connection. Your review will be here when you're back online.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.story) throw new Error(body.error || "Your coaches couldn't put the review together. Try again in a minute.");
  remember(id, body);
  return body;
}

/**
 * Keeps the account's review schedule (week_review_schedule) in step with the settings, so the
 * review is written at its time even with the app closed. Sends only when something changed
 * since the last save from this phone, including the phone's time zone (travel).
 */
export async function syncSchedule(r) {
  const id = await uid();
  if (!id) return;
  const row = { user_id: id, enabled: !!r.on, notify: r.notify !== false, day: r.day, hour: r.hour, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
  const key = `gymbuddy-review-schedule:${id}`, sig = JSON.stringify(row);
  try { if (localStorage.getItem(key) === sig) return; } catch {}
  const { error } = await supabase.from("week_review_schedule").upsert(row);
  if (error) return; // tried again the next time the app starts or the settings change
  try { localStorage.setItem(key, sig); } catch {}
}
