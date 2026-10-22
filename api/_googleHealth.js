import { createHash, createHmac, createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { bodyweightSeries, num } from "../src/lib/util.js";

/* Google Health sync, shared by api/google-health.js (the app's requests) and
   api/google-health-callback.js (where Google sends the lifter back after they allow it).
   Files starting with an underscore aren't served as functions.

   GymBuddy writes bodyweight and each food entry (as a nutrition log), from the day the lifter
   connected. Every data point gets a name GymBuddy makes up from the item and its contents
   (gbb-/gbf-<item hash>-<content hash>), so sending one twice is harmless, and an edit is a new
   data point plus a delete of the old one (Google can't edit a nutrition log made this way, so
   everything works the same way). Workouts aren't written: the lifter records them in Google
   Health from their watch, and a second copy would double them.

   It reads one thing: heart rate during a workout, which the app turns into the workout's
   intensity (src/lib/heart.js).

   Needs GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET (Google Cloud, OAuth client), and
   REST_ALERT_SECRET for the database functions that hold the link. */

export const CLIENT_ID = process.env.GOOGLE_HEALTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_HEALTH_CLIENT_SECRET;
export const ghReady = () => !!(CLIENT_ID && CLIENT_SECRET);

const API = "https://health.googleapis.com/v4/users/me/dataTypes";
const SCOPE = "https://www.googleapis.com/auth/googlehealth.";
/** What each kind of item needs from the lifter, and where it goes in Google Health. (Workouts,
    "w:", were written before and aren't now; ones already sent are left alone.) */
export const KINDS = {
  bw: { type: "weight", scope: `${SCOPE}health_metrics_and_measurements.writeonly`, prefix: "gbb" },
  f: { type: "nutrition-log", scope: `${SCOPE}nutrition.writeonly`, prefix: "gbf" },
};
export const HEART_SCOPE = `${SCOPE}health_metrics_and_measurements.readonly`;
export const SCOPES = [...Object.values(KINDS).map((k) => k.scope), HEART_SCOPE];

export const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
export const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
export const LINK_SECRET = process.env.REST_ALERT_SECRET; // the database functions for the link only work with it

/** Where Google sends the lifter back: this site's callback (it must match the OAuth client exactly). */
export const redirectUri = (request) => process.env.GOOGLE_HEALTH_REDIRECT_URI || `${new URL(request.url).origin}/api/google-health-callback`;

/** The link (encrypted refresh token, allowed scopes, since), through the secret-only database functions. */
export function links() {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const rpc = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, { p_secret: LINK_SECRET, ...args });
    if (error) throw error;
    return data;
  };
  return {
    get: (user) => rpc("google_health_link_get", { p_user: user }),
    save: (user, { token, scopes, since }) => rpc("google_health_link_save", { p_user: user, p_token: token, p_scopes: scopes, p_since: since }),
    note: (user, error) => rpc("google_health_link_note", { p_user: user, p_error: error }),
    remove: (user) => rpc("google_health_link_delete", { p_user: user }),
  };
}

/* ── secrets ── */

// Keys for the refresh token and the sign-in state, made from the client secret: nothing more to set up.
// Changing the client secret makes saved tokens unreadable; the lifter connects again.
const key = (info) => Buffer.from(hkdfSync("sha256", CLIENT_SECRET || "", "gymbuddy", info, 32));
const b64 = (buf) => Buffer.from(buf).toString("base64url");

/** Google's refresh token, encrypted for the database (AES-256-GCM). */
export function sealToken(token) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key("google-health-token"), iv);
  const body = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return `v1.${b64(Buffer.concat([iv, c.getAuthTag(), body]))}`;
}
export function openToken(sealed) {
  const raw = Buffer.from(String(sealed).replace(/^v1\./, ""), "base64url");
  const d = createDecipheriv("aes-256-gcm", key("google-health-token"), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

/* The OAuth state: who is connecting and from which day, signed so the callback can trust it. Good
   for 20 minutes. It can't be tied to the browser: on an iPhone, Google's page opens outside the
   home screen app, which doesn't share its cookies. */
const STATE_MS = 20 * 60_000;
export function signState({ user, since }) {
  const body = b64(JSON.stringify({ u: user, s: since, e: Date.now() + STATE_MS, n: b64(randomBytes(8)) }));
  return `${body}.${b64(createHmac("sha256", key("google-health-state")).update(body).digest())}`;
}
export function readState(state) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", key("google-health-state")).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return s.e > Date.now() ? { user: s.u, since: s.s } : null;
  } catch { return null; }
}

/* ── Google sign-in ── */

export function authUrl({ redirectUri, state }) {
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "),
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body.error_description || body.error || `token ${res.status}`); e.code = body.error; throw e; }
  return body;
}
/** The code Google sent back, traded for { access_token, refresh_token, scope }. */
export const exchangeCode = (code, redirectUri) => tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
/** A fresh access token. Throws with code "invalid_grant" when the lifter took GymBuddy's access away. */
export const accessToken = async (refresh) => (await tokenRequest({ refresh_token: refresh, grant_type: "refresh_token" })).access_token;
export const revoke = (token) => fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(8000) }).catch(() => {});

/** The kinds a granted scope list allows to write: ["bw", "f"] or fewer. */
export const grantedKinds = (scopes) => Object.entries(KINDS).filter(([, k]) => String(scopes || "").split(" ").includes(k.scope)).map(([kind]) => kind);
/** Whether a granted scope list allows reading heart rate. */
export const canReadHeart = (scopes) => String(scopes || "").split(" ").includes(HEART_SCOPE);

async function get(access, path, params) {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, body } : { ok: false, status: res.status, message: body.error?.message || `${res.status}` };
}

/**
 * Whether GymBuddy can use the Google account in Google Health (Google asks for the app to be
 * opened once first). The identity call needs a read scope GymBuddy doesn't ask for, so this lists
 * one data point it's allowed to: its own weight or food (which works with write-only), or else
 * heart rate. Resolves { ok, status, message }.
 */
export async function canUse(access, scopes) {
  const kind = grantedKinds(scopes)[0];
  return kind
    ? get(access, `${KINDS[kind].type}/dataPoints`, { pageSize: "1", dataSourceFamily: "users/me/dataSourceFamilies/self-sources" })
    : get(access, "heart-rate/dataPoints", { pageSize: "1" });
}

/**
 * Heart rate readings between two instants (ms), oldest first: [[ms, bpm], ...]. A long workout
 * at one reading a second is thousands, so past 3,000 they're averaged into 5-second steps.
 * Resolves { ok, readings } or { ok: false, status, message }.
 */
export async function heartRate(access, start, end) {
  const iso = (ms) => new Date(ms).toISOString();
  const params = { pageSize: "10000", filter: `heart_rate.sample_time.physical_time >= "${iso(start)}" AND heart_rate.sample_time.physical_time < "${iso(end)}"` };
  let readings = [];
  for (let page = 0; page < 4; page++) {
    const r = await get(access, "heart-rate/dataPoints", params);
    if (!r.ok) return r;
    for (const p of r.body.dataPoints || []) {
      const t = Date.parse(p.heartRate?.sampleTime?.physicalTime), b = Number(p.heartRate?.beatsPerMinute);
      if (t && b > 0) readings.push([t, b]);
    }
    if (!r.body.nextPageToken) break;
    params.pageToken = r.body.nextPageToken;
  }
  readings.sort((a, b) => a[0] - b[0]);
  if (readings.length > 3000) {
    const steps = new Map();
    for (const [t, b] of readings) { const k = Math.floor(t / 5000) * 5000; const s = steps.get(k) || [0, 0]; steps.set(k, [s[0] + b, s[1] + 1]); }
    readings = [...steps].map(([t, [sum, n]]) => [t, Math.round(sum / n)]);
  }
  return { ok: true, readings };
}

const ZONE_ORDER = ["LIGHT", "MODERATE", "VIGOROUS", "PEAK"];
const nextDay = (date) => new Date(Date.parse(`${date}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10);
const daysBefore = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) - n * 86400_000).toISOString().slice(0, 10);
/**
 * The lifter's own heart rate zones (Google works them out daily from their fitness and age) for a
 * date, or the latest in the two weeks before it: the bpm each of light, moderate, vigorous and peak
 * starts at. Resolves [light, moderate, vigorous, peak] or null.
 */
export async function heartZones(access, date) {
  const f = "daily_heart_rate_zones.date";
  const r = await get(access, "daily-heart-rate-zones/dataPoints", { pageSize: "20", filter: `${f} >= "${daysBefore(date, 14)}" AND ${f} < "${nextDay(date)}"` });
  if (!r.ok) return null;
  const day = (p) => { const d = p.dailyHeartRateZones?.date; return d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : ""; };
  const latest = (r.body.dataPoints || []).filter((p) => day(p) <= date).sort((a, b) => day(b).localeCompare(day(a)))[0];
  const zones = latest?.dailyHeartRateZones?.heartRateZones || [];
  const bounds = ZONE_ORDER.map((type) => Number(zones.find((z) => z.heartRateZoneType === type)?.minBeatsPerMinute));
  return bounds.every((b, i) => b > 0 && (i === 0 || b > bounds[i - 1])) ? bounds : null;
}

/* ── time ── */

/** The UTC offset of `tz` at an instant, in seconds (east positive). */
export function offsetSeconds(tz, ms) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value || "";
    const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part);
    return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3] || 0) * 60) : 0;
  } catch { return 0; }
}
/** The instant a wall-clock time on a date happens in `tz`. */
export function localInstant(date, hhmm, tz) {
  const [y, mo, d] = date.split("-").map(Number), [h, mi] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall - offsetSeconds(tz, wall) * 1000;
  t = wall - offsetSeconds(tz, t) * 1000; // again, in case the guess fell across a clock change
  return t;
}
/** Today's date where the lifter is. */
export function localToday(tz, now = Date.now()) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now)); } catch { return new Date(now).toISOString().slice(0, 10); }
}
export const validTz = (tz) => { try { return typeof tz === "string" && tz.length < 64 && !!new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { return false; } };

const at = (ms, tz) => ({ time: new Date(ms).toISOString(), offset: `${offsetSeconds(tz, ms)}s` });
const interval = (start, end, tz) => {
  const s = at(start, tz), e = at(end, tz);
  return { startTime: s.time, startUtcOffset: s.offset, endTime: e.time, endUtcOffset: e.offset };
};

/* ── what to send ── */

const hash = (v, n) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, n);
const nameFor = (kind, item, content) => `users/me/dataTypes/${KINDS[kind].type}/dataPoints/${KINDS[kind].prefix}-${hash(item, 10)}-${hash(content, 8)}`;
const LB = 453.59237;
// Food has a date and a meal, not a time: each meal goes in at a usual time for it.
const MEALS = { breakfast: ["08:00", "BREAKFAST"], lunch: ["12:30", "LUNCH"], snacks: ["15:30", "SNACK"], dinner: ["18:30", "DINNER"] };

/** A food entry as a nutrition log. */
function meal(f, tz, now) {
  const [hhmm, type] = MEALS[f.meal] || MEALS.snacks;
  const start = Math.min(localInstant(f.date, hhmm, tz), now - 15 * 60_000);
  const portion = `${num(+f.amount)} ${f.unit}`.trim();
  const label = `${f.brand ? `${f.brand} ` : ""}${f.name}`.slice(0, 100);
  const g = (x) => Math.round(Math.max(0, +x || 0) * 10) / 10;
  const content = { date: f.date, meal: f.meal, label, portion, kcal: g(f.kcal), p: g(f.protein), c: g(f.carbs), fat: g(f.fat) };
  return {
    content,
    body: {
      nutritionLog: {
        interval: interval(start, start + 15 * 60_000, tz),
        foodDisplayName: `${label} (${portion})`,
        mealType: type,
        energy: { kcal: content.kcal },
        totalCarbohydrate: { grams: content.c },
        totalFat: { grams: content.fat },
        nutrients: [{ nutrient: "PROTEIN", quantity: { grams: content.p } }],
      },
    },
  };
}

/**
 * What to send and what to take back, from what's logged and what was sent before.
 * `account`: the saved app data ({ sessions, weighins }); `food`: food entries since
 * `since`; `synced`: { item: name } already in Google Health; `granted`: the kinds the lifter
 * allowed. Only dates from `since` to today count. A kind they didn't allow is left alone.
 * Returns { send: [{ item, kind, name, body, replaces }], remove: [{ item, kind, name }] }.
 */
export function plan({ account, food = [], since, tz, synced = {}, granted = Object.keys(KINDS), now = Date.now() }) {
  const today = localToday(tz, now);
  const inRange = (date) => date >= since && date <= today;
  const want = {}; // item -> { kind, date, content, body }
  const add = (kind, item, date, out) => { if (out && granted.includes(kind)) want[item] = { kind, date, ...out }; };

  // One weight a day: a weigh-in, or the bodyweight entered with that day's workout.
  const sessionEnd = Object.fromEntries((account?.sessions || []).filter((s) => s.bw != null).map((s) => [s.date, s.finishedAt]));
  for (const { date, bw } of bodyweightSeries(account?.sessions || [], account?.weighins || [])) {
    if (!inRange(date) || !(bw > 0 && bw < 1500)) continue;
    const when = Math.min(sessionEnd[date] || localInstant(date, "07:00", tz), now - 60_000);
    const o = at(when, tz);
    add("bw", `bw:${date}`, date, { content: { bw }, body: { weight: { sampleTime: { physicalTime: o.time, utcOffset: o.offset }, weightGrams: Math.round(bw * LB) } } });
  }
  for (const f of food) {
    if (inRange(f.date)) add("f", `f:${f.id}`, f.date, meal(f, tz, now));
  }

  const send = [], remove = [];
  for (const [item, w] of Object.entries(want)) {
    const name = nameFor(w.kind, item, w.content);
    if (synced[item] !== name) send.push({ item, kind: w.kind, date: w.date, name, body: w.body, replaces: synced[item] || null });
  }
  for (const [item, name] of Object.entries(synced)) {
    const kind = item.split(":")[0];
    if (!want[item] && KINDS[kind] && granted.includes(kind)) remove.push({ item, kind, name });
  }
  // Oldest first, so a long backlog fills in in order.
  send.sort((a, b) => a.date.localeCompare(b.date) || a.item.localeCompare(b.item));
  return { send, remove };
}

/* ── Google Health requests ── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// An app Google hasn't reviewed gets 2.5 requests a second for each lifter.
const GAP_MS = 450;

async function call(access, url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const out = await res.json().catch(() => ({}));
  // Writes answer with an operation, which can carry a failure of its own.
  if (res.ok && !out.error) return { ok: true };
  const status = res.ok ? ({ 5: 404, 6: 409 }[out.error.code] || 400) : res.status;
  return { ok: false, status, message: out.error?.message || `${res.status}` };
}

/** Creates one data point under its own name. Already there counts as done. */
export async function create(access, { kind, name, body }) {
  const r = await call(access, `${API}/${KINDS[kind].type}/dataPoints`, { name, dataSource: { recordingMethod: "MANUAL" }, ...body });
  return r.ok || r.status === 409 ? { ok: true } : r;
}
/** Deletes data points of one kind. Already gone counts as done. */
export async function removeNames(access, kind, names) {
  if (!names.length) return { ok: true };
  const r = await call(access, `${API}/${KINDS[kind].type}/dataPoints:batchDelete`, { names });
  return r.ok || r.status === 404 ? { ok: true } : r;
}

/**
 * Carries out a plan, up to `limit` new data points (the rest go next time). `record` saves what
 * changed: record({ put: [{ item, name }], drop: [items] }). Resolves { sent, removed, more, error }.
 */
export async function carryOut(access, { send, remove }, record, { limit = 30 } = {}) {
  let sent = 0, removed = 0, error = null;
  // Things deleted in GymBuddy: one request per kind.
  for (const kind of Object.keys(KINDS)) {
    const gone = remove.filter((r) => r.kind === kind);
    if (!gone.length) continue;
    const r = await removeNames(access, kind, gone.map((g) => g.name));
    if (!r.ok) { error = r.message; continue; }
    await record({ put: [], drop: gone.map((g) => g.item) });
    removed += gone.length;
    await sleep(GAP_MS);
  }
  const batch = send.slice(0, limit);
  for (const s of batch) {
    // An edit: the old version goes first. If sending the new one then fails, the record still
    // names the old one, so the next sync sends it again (and the delete finds nothing to do).
    if (s.replaces) {
      const d = await removeNames(access, s.kind, [s.replaces]);
      await sleep(GAP_MS);
      if (!d.ok) { error = d.message; continue; }
    }
    const r = await create(access, s);
    await sleep(GAP_MS);
    if (!r.ok) { error = r.message; if (r.status === 401 || r.status === 403 || r.status === 429) break; continue; }
    await record({ put: [{ item: s.item, name: s.name }], drop: [] });
    sent++;
  }
  return { sent, removed, more: send.length > batch.length, error };
}
