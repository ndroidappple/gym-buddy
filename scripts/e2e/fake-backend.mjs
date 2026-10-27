/* A stand-in for Supabase and the app's /api functions, for end-to-end tests (scripts/test-e2e.mjs).
   Playwright answers every request the app makes, so a test runs the real app, signed in, against
   data it controls: nothing reaches the real account, the databases or the AI, and every run is the same.

   Supabase is answered as PostgREST would: a table is an array of rows here, and the query string's
   filters (eq, gte, lte, like, order, limit) and upserts work on it. /api answers come from `api`
   handlers the test passes in, so each test decides what a food search or the coach says. */

export const SUPABASE_URL = "https://e2e.supabase.co";
export const USER = { id: "00000000-0000-4000-8000-0000000000e2", email: "lifter@e2e.test" };

// The column(s) an upsert matches on, per table (the primary keys in supabase/migrations).
const KEYS = { storage_kv: ["user_id", "key"], coach_memory: ["user_id"], week_review_schedule: ["user_id"], google_health: ["user_id"] };
const keyOf = (table) => KEYS[table] || ["id"];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const user = (meta) => ({ id: USER.id, aud: "authenticated", role: "authenticated", email: USER.email, app_metadata: { provider: "email" }, user_metadata: meta, created_at: "2026-01-01T00:00:00Z" });

/** A session the app reads as signed in (its token is never checked: every request it signs is answered here). */
function session(meta) {
  const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
  const access_token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, email: USER.email, role: "authenticated", aud: "authenticated", exp })}.e2e`;
  return { access_token, refresh_token: "e2e-refresh", token_type: "bearer", expires_in: 365 * 86400, expires_at: exp, user: user(meta) };
}

/** PostgREST's filters, enough of them for this app: `col=op.value`. */
function matches(row, params) {
  for (const [col, expr] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(col)) continue;
    const i = expr.indexOf(".");
    const op = expr.slice(0, i), v = expr.slice(i + 1), x = row[col];
    const ok = op === "eq" ? String(x) === v
      : op === "neq" ? String(x) !== v
      : op === "gte" ? String(x) >= v
      : op === "gt" ? String(x) > v
      : op === "lte" ? String(x) <= v
      : op === "lt" ? String(x) < v
      : op === "like" ? new RegExp(`^${v.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*")}$`).test(String(x ?? ""))
      : op === "is" ? (v === "null" ? x == null : String(x) === v)
      : op === "in" ? v.replace(/^\(|\)$/g, "").split(",").includes(String(x))
      : true;
    if (!ok) return false;
  }
  return true;
}

function query(rows, params) {
  let out = rows.filter((r) => matches(r, params));
  const order = params.find(([k]) => k === "order")?.[1];
  if (order) {
    const [col, dir] = order.split(",")[0].split(".");
    out = [...out].sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? -1 : String(a[col] ?? "") > String(b[col] ?? "") ? 1 : 0) * (dir === "desc" ? -1 : 1));
  }
  const limit = params.find(([k]) => k === "limit")?.[1];
  if (limit) out = out.slice(0, +limit);
  const select = params.find(([k]) => k === "select")?.[1];
  if (select && select !== "*") {
    const cols = select.split(",").map((c) => c.trim());
    out = out.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
  }
  return out;
}

/**
 * Answers the page's Supabase and /api requests. Call before page.goto.
 * seed: { tables: { name: rows[] }, userMeta, localStorage: { key: value } }; api: { "/api/food": (url, body) => json }.
 * Returns { tables, requests }: the live tables (what the app saved) and every request seen, to assert on.
 */
export async function installFakeBackend(context, { tables: seed = {}, userMeta = { name_asked: true }, localStorage: local = {}, api = {} } = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
  const requests = [];
  let meta = { ...userMeta };

  // Signed in before the app's first line runs: supabase-js keeps its session in localStorage.
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  await context.addInitScript(([key, s, extra]) => {
    if (sessionStorage.getItem("e2e-seeded")) return; // a reload keeps what the app saved
    sessionStorage.setItem("e2e-seeded", "1");
    localStorage.setItem(key, JSON.stringify(s));
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  }, [`sb-${ref}-auth-token`, session(meta), local]);

  const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: body === undefined ? "" : JSON.stringify(body) });

  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    }
    const url = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    requests.push({ method: req.method(), path: url.pathname, search: url.search, body });

    // Auth: the one signed-in lifter.
    if (url.pathname === "/auth/v1/user") {
      if (req.method() === "PUT") meta = { ...meta, ...(body?.data || {}) };
      return json(route, 200, user(meta));
    }
    if (url.pathname === "/auth/v1/token") return json(route, 200, session(meta));
    if (url.pathname === "/auth/v1/logout") return json(route, 204);

    // Database functions: nothing to report (no history, no push subscriptions).
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc) return json(route, 200, rpc[1] === "food_daily_totals" ? [] : null);

    const table = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1];
    if (!table) return json(route, 404, { message: `e2e: no fake for ${url.pathname}` });
    const rows = (tables[table] ||= []);
    const params = [...url.searchParams.entries()];
    const one = (req.headers().accept || "").includes("vnd.pgrst.object");
    const prefer = req.headers().prefer || "";
    const reply = (out) => {
      if (one) return out.length === 1 ? json(route, 200, out[0]) : json(route, 406, { code: "PGRST116", message: `e2e: ${out.length} rows` });
      return json(route, 200, out);
    };

    if (req.method() === "GET" || req.method() === "HEAD") return reply(query(rows, params));
    if (req.method() === "DELETE") {
      const gone = rows.filter((r) => matches(r, params));
      tables[table] = rows.filter((r) => !gone.includes(r));
      return prefer.includes("return=representation") ? reply(gone) : json(route, 204);
    }
    if (req.method() === "PATCH") {
      const hit = rows.filter((r) => matches(r, params));
      hit.forEach((r) => Object.assign(r, body));
      return prefer.includes("return=representation") ? reply(query(hit, params.filter(([k]) => k === "select"))) : json(route, 204);
    }
    if (req.method() === "POST") {
      const keys = keyOf(table);
      const now = new Date().toISOString();
      const saved = (Array.isArray(body) ? body : [body]).map((r) => {
        const at = rows.find((x) => keys.every((k) => String(x[k]) === String(r[k])));
        if (at) return Object.assign(at, r, r.updated_at ? {} : { updated_at: now });
        const row = { created_at: now, updated_at: now, ...r };
        rows.push(row);
        return row;
      });
      return prefer.includes("return=representation") ? reply(query(saved, params.filter(([k]) => k === "select"))) : json(route, 201);
    }
    return json(route, 405, { message: `e2e: ${req.method()} not faked` });
  });

  // The app's own server functions (Vercel in production): each test says what they answer.
  await context.route((u) => u.pathname.startsWith("/api/"), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch { return req.postData(); } })() : null;
    requests.push({ method: req.method(), path: url.pathname, search: url.search, body });
    const handler = api[url.pathname];
    if (!handler) return json(route, 503, { error: `e2e: ${url.pathname} isn't faked in this test` });
    return json(route, 200, await handler(url, body));
  });

  return { tables, requests };
}
