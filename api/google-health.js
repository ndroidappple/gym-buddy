import { createClient } from "@supabase/supabase-js";
import {
  ghReady, signState, authUrl, openToken, accessToken, revoke, plan, carryOut, localToday, validTz,
  links, redirectUri, grantedKinds, SUPABASE_URL, SUPABASE_KEY, LINK_SECRET,
} from "./_googleHealth.js";

/* Google Health sync: the app's side. POST /api/google-health with the lifter's sign-in and
   { action }:
     connect    { tz }  -> { url }: Google's page asking them to allow GymBuddy. Google then sends
                           them to api/google-health-callback.js, which saves the connection.
     status            -> { connected, since, syncedAt, error, allowed: { workouts, weight, food } }
     sync       { tz }  -> { connected, sent, removed, more }: sends what's new or changed since
                           the last sync, up to 30 data points (call again while `more`).
     disconnect        -> { connected: false }: takes GymBuddy's access back from Google.
   The link (Google's refresh token, encrypted) is read and written through database functions
   that need the rest alerts' shared secret (REST_ALERT_SECRET); what was sent is the lifter's own
   rows in google_health_synced. See supabase/migrations/*_google_health.sql. */

const ACCOUNT_KEY = "ironlog-v2"; // STORE_KEY in src/lib/store.js

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

const allowed = (scopes) => { const g = grantedKinds(scopes); return { workouts: g.includes("w"), weight: g.includes("bw"), food: g.includes("f") }; };

export async function POST(request) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !LINK_SECRET || !ghReady()) return json({ error: "Google Health isn't set up on the server yet." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }

  const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, ...noSession });
  const { data: auth } = token ? await sb.auth.getUser(token) : { data: null };
  const user = auth?.user;
  if (!user) return json({ error: "Sign in first." }, 401);
  const tz = validTz(body.tz) ? body.tz : "UTC";
  const db = links();

  try {
    switch (body.action) {
      case "connect":
        return json({ url: authUrl({ redirectUri: redirectUri(request), state: signState({ user: user.id, since: localToday(tz) }) }) });
      case "status": {
        const link = await db.get(user.id);
        return json(link ? { connected: true, since: link.since, syncedAt: link.syncedAt, error: link.error, allowed: allowed(link.scopes) } : { connected: false });
      }
      case "disconnect": {
        const link = await db.get(user.id);
        if (link) {
          await db.remove(user.id);
          try { await revoke(openToken(link.token)); } catch {}
        }
        return json({ connected: false });
      }
      case "sync": return json(await sync(sb, db, user.id, tz));
      default: return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    console.error("google health", body.action, e?.message ?? e);
    return json({ error: "Couldn't reach Google Health. Try again in a minute." }, 502);
  }
}

async function sync(sb, db, userId, tz) {
  const link = await db.get(userId);
  if (!link) return { connected: false };
  // Gone means connect again: they took GymBuddy's access away in their Google account, or the
  // saved token can't be read any more (the client secret was changed).
  const gone = async () => { await db.remove(userId); return { connected: false, expired: true }; };
  let refresh, access;
  try { refresh = openToken(link.token); } catch { return gone(); }
  try {
    access = await accessToken(refresh);
  } catch (e) {
    if (e.code === "invalid_grant") return gone();
    throw e;
  }

  const today = localToday(tz);
  const [account, food, synced] = await Promise.all([loadAccount(sb, userId), loadFood(sb, userId, link.since, today), loadSynced(sb, userId)]);
  const todo = plan({ account, food, since: link.since, tz, synced, granted: grantedKinds(link.scopes) });
  const record = async ({ put, drop }) => {
    if (put.length) { const { error } = await sb.from("google_health_synced").upsert(put.map((p) => ({ user_id: userId, ...p }))); if (error) throw error; }
    if (drop.length) { const { error } = await sb.from("google_health_synced").delete().eq("user_id", userId).in("item", drop); if (error) throw error; }
  };
  const out = await carryOut(access, todo, record);
  await db.note(userId, out.error ? `Google Health said: ${out.error}` : null).catch(() => {});
  if (out.error) console.warn("google health sync", { sent: out.sent, removed: out.removed, error: out.error });
  return { connected: true, sent: out.sent, removed: out.removed, more: out.more && out.sent > 0, error: out.error ? "Some items didn't go through. They'll be tried again." : null };
}

async function loadAccount(sb, userId) {
  const { data, error } = await sb.from("storage_kv").select("value").eq("user_id", userId).eq("key", ACCOUNT_KEY).maybeSingle();
  if (error) throw error;
  // Nothing saved yet reads as nothing logged; a failed read throws instead, so it never looks like everything was deleted.
  return data?.value ? JSON.parse(data.value) : { sessions: [], weighins: [] };
}

/** Food entries from `start` to `end`, a page at a time (Supabase returns at most 1,000 rows a request). */
async function loadFood(sb, userId, start, end) {
  const rows = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await sb.from("food_entries").select("id, date, meal, name, brand, amount, unit, kcal, protein, carbs, fat")
      .eq("user_id", userId).gte("date", start).lte("date", end).order("date").order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

/** What's in Google Health already: { item: name }. */
async function loadSynced(sb, userId) {
  const out = {};
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await sb.from("google_health_synced").select("item, name").eq("user_id", userId).order("item").range(from, from + 999);
    if (error) throw error;
    for (const r of data) out[r.item] = r.name;
    if (data.length < 1000) break;
  }
  return out;
}
