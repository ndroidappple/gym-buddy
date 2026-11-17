import { createClient } from "@supabase/supabase-js";
import { reviewKey, REVIEW_PREFIX } from "../src/lib/weekReview.js";

/* Who's asking, for the AI-app endpoints (api/mcp.js, api/tools.js): turns the request's
   Authorization header into a `source` that reads one lifter's log. Two kinds of credential work,
   so any AI app can connect, whichever it supports:

   - An OAuth access token from Supabase Auth (Claude, ChatGPT and other MCP apps sign in and get
     one). Reads go through PostgREST with that token, so the own-rows RLS policies apply.
   - An API key (gbk_…) made in Settings → AI assistants, for apps that take a fixed header instead.
     Reads go through the api_* database functions, which check the key and read only its owner's
     rows (supabase/migrations/20261117000000_api_keys.sql).

   Either way the server only holds the publishable key: nothing here can read another lifter. */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const ACCOUNT_KEY = "ironlog-v2"; // STORE_KEY in src/lib/store.js
const NO_SESSION = { persistSession: false, autoRefreshToken: false };
export const API_KEY = /^gbk_[0-9a-f]{48}$/;

export const configured = () => !!(SUPABASE_URL && SUPABASE_KEY);

/** This app's public address: PUBLIC_URL when set (a custom domain behind a proxy), else the request's. */
export const originOf = (request) => (process.env.PUBLIC_URL || new URL(request.url).origin).replace(/\/$/, "");

export const bearer = (request) => (request.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/i)?.[1] || null;

const num = (r) => ({ ...r, kcal: +r.kcal, protein: +r.protein, carbs: +r.carbs, fat: +r.fat, amount: +r.amount });
const parse = (v) => (v ? JSON.parse(v) : null);

/**
 * The lifter behind the request's credential, as a source (see api/_mcp.js), or null when there's
 * no credential or it's no good. `make` is for the test, to stand in for Supabase.
 */
export async function lifterSource(request, make = createClient) {
  const token = bearer(request);
  if (!token) return null;
  if (API_KEY.test(token)) {
    const sb = make(SUPABASE_URL, SUPABASE_KEY, { auth: NO_SESSION });
    const { data: who, error } = await sb.rpc("api_whoami", { p_key: token });
    if (error || !who) return null;
    return keySource(sb, token, who);
  }
  // A client with the publishable key and the lifter's token: Postgres sees auth.uid() = this lifter.
  const sb = make(SUPABASE_URL, SUPABASE_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: NO_SESSION });
  const { data } = await sb.auth.getUser(token).catch(() => ({ data: null }));
  return data?.user ? tokenSource(sb, data.user) : null;
}

/** Signed in with a token: plain table reads, kept to this lifter by RLS (the user_id filters are belt and braces). */
function tokenSource(sb, user) {
  let account;
  const kv = async (key) => {
    const { data, error } = await sb.from("storage_kv").select("value").eq("user_id", user.id).eq("key", key).maybeSingle();
    if (error) throw error;
    return parse(data?.value);
  };
  return {
    user: { name: user.user_metadata?.first_name || null },
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
        rows.push(...data.map(num));
        if (data.length < 1000) break;
      }
      return rows;
    },
  };
}

/** Signed in with an API key: every read is a database function that checks the key. */
function keySource(sb, key, who) {
  let account;
  const call = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, { p_key: key, ...args });
    if (error) throw error;
    return data;
  };
  return {
    user: { name: who.name || null },
    account: () => (account ??= call("api_kv", { p_kv_key: ACCOUNT_KEY }).then(parse)),
    review: (weekEnd) => call("api_kv", { p_kv_key: reviewKey(weekEnd) }).then(parse),
    latestReviewKey: () => call("api_latest_review_key", {}),
    async food(start, end) {
      const rows = [];
      for (let from = 0; from < 5000; from += 1000) {
        const { data, error } = await sb.rpc("api_food", { p_key: key, p_start: start, p_end: end }).range(from, from + 999);
        if (error) throw error;
        rows.push(...data.map(num));
        if (data.length < 1000) break;
      }
      return rows;
    },
  };
}
