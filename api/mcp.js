import { createClient } from "@supabase/supabase-js";
import { handleMessage } from "./_mcp.js";
import { reviewKey, REVIEW_PREFIX } from "../src/lib/weekReview.js";
import { today } from "../src/lib/util.js";

/* GymBuddy's MCP server: lets a lifter add GymBuddy to Claude as a custom connector and ask about
   their own log. Read-only. The tools and the protocol are in _mcp.js; this file does the sign-in.

   Sign-in is Supabase Auth's OAuth 2.1 server. Claude calls here with no token, gets a 401 pointing
   at /.well-known/oauth-protected-resource (api/oauth-protected-resource.js), which names Supabase
   as the sign-in server. The lifter signs in to GymBuddy and approves on /oauth/consent
   (src/OAuthConsent.jsx), and Claude gets an access token for that lifter. Every request below
   reads Supabase with that token, so row-level security returns only the lifter's own rows: the
   same own-rows policies the app runs under. Nothing here uses a key that could read anyone else.

   Stateless Streamable HTTP: each POST is answered with plain JSON, no session, no event stream. */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const ACCOUNT_KEY = "ironlog-v2"; // STORE_KEY in src/lib/store.js

const CORS = {
  "access-control-allow-origin": "*", // bearer tokens, not cookies, so any origin is safe
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "www-authenticate",
};
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...headers } });

/** This app's public address: PUBLIC_URL when set (a custom domain behind a proxy), else the request's. */
export const originOf = (request) => (process.env.PUBLIC_URL || new URL(request.url).origin).replace(/\/$/, "");

/** No token or a bad one: the 401 that starts Claude's sign-in, pointing at where to find the sign-in server. */
function unauthorized(request, error) {
  const meta = `${originOf(request)}/.well-known/oauth-protected-resource/api/mcp`;
  const challenge = `Bearer resource_metadata="${meta}", scope="email"${error ? `, error="${error}"` : ""}`;
  return json({ error: error ? "Sign-in expired or invalid. Reconnect GymBuddy." : "Sign in to GymBuddy to connect it." }, 401, { "www-authenticate": challenge });
}

/** The signed-in lifter's data, read with their token: row-level security keeps it to their rows
    (the user_id filters are belt and braces, and let Postgres use the indexes). */
function userSource(sb, user) {
  let account;
  const kv = async (key) => {
    const { data, error } = await sb.from("storage_kv").select("value").eq("user_id", user.id).eq("key", key).maybeSingle();
    if (error) throw error;
    return data?.value ? JSON.parse(data.value) : null;
  };
  return {
    user: { id: user.id, name: user.user_metadata?.first_name || null },
    account: () => (account ??= kv(ACCOUNT_KEY)),
    review: (weekEnd) => kv(reviewKey(weekEnd)),
    async latestReviewKey() {
      // Keys are week-review:YYYY-MM-DD, so the last one alphabetically is the latest week.
      const { data, error } = await sb.from("storage_kv").select("key").eq("user_id", user.id).like("key", `${REVIEW_PREFIX}%`).order("key", { ascending: false }).limit(1);
      if (error) throw error;
      return data?.[0]?.key || null;
    },
    async food(start, end) {
      const rows = [];
      for (let from = 0; from < 5000; from += 1000) {
        const { data, error } = await sb.from("food_entries").select("date, meal, name, amount, unit, kcal, protein, carbs, fat")
          .eq("user_id", user.id).gte("date", start).lte("date", end).order("date").order("id").range(from, from + 999);
        if (error) throw error;
        rows.push(...data.map((r) => ({ ...r, kcal: +r.kcal, protein: +r.protein, carbs: +r.carbs, fat: +r.fat, amount: +r.amount })));
        if (data.length < 1000) break;
      }
      return rows;
    },
  };
}

export async function POST(request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return json({ error: "GymBuddy's MCP server isn't configured: missing Supabase URL/key env vars." }, 500);
  const token = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return unauthorized(request);

  // A client with the publishable key and the lifter's token: Postgres sees auth.uid() = this lifter.
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth } = await sb.auth.getUser(token).catch(() => ({ data: null }));
  const user = auth?.user;
  if (!user) return unauthorized(request, "invalid_token");

  let body;
  try { body = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  // `today` is the server's (UTC) date; tools take explicit dates when it matters.
  const ctx = { source: userSource(sb, user), today: today() };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMessage(m, ctx)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await handleMessage(body, ctx);
  return out ? json(out) : new Response(null, { status: 202, headers: CORS });
}

/** No server-to-client event stream here. Without a token, a GET also starts the sign-in. */
export function GET(request) {
  if (!request.headers.get("authorization")) return unauthorized(request);
  return new Response(null, { status: 405, headers: { allow: "POST", ...CORS } });
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
