import { handleMessage } from "./_mcp.js";
import { lifterSource, configured, originOf, bearer } from "./_lifter.js";
import { today } from "../src/lib/util.js";

/* GymBuddy's MCP server (https://<app>/api/mcp): any AI app that speaks MCP (Claude, ChatGPT,
   Cursor, …) can read a lifter's own log through it. Read-only. The tools and the protocol are in
   _mcp.js; the sign-in is in _lifter.js.

   Sign-in, either way the app supports:
   - OAuth (the standard MCP way). With no token, the 401 points at /.well-known/oauth-protected-resource
     (api/oauth-protected-resource.js), which names this project's Supabase Auth as the sign-in server.
     The app registers itself there, the lifter signs in to GymBuddy and approves on /oauth/consent
     (src/OAuthConsent.jsx), and the app gets an access token for that lifter.
   - An API key from Settings → AI assistants, sent as `Authorization: Bearer gbk_…`.

   Stateless Streamable HTTP: each POST is answered with plain JSON, no session, no event stream. */

const CORS = {
  "access-control-allow-origin": "*", // bearer tokens, not cookies, so any origin is safe
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "www-authenticate",
};
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...headers } });

/** No credential or a bad one: the 401 that starts an MCP app's sign-in, pointing at the sign-in server. */
export function unauthorized(request, bad) {
  const meta = `${originOf(request)}/.well-known/oauth-protected-resource/api/mcp`;
  const challenge = `Bearer resource_metadata="${meta}", scope="email"${bad ? ', error="invalid_token"' : ""}`;
  return json({ error: bad ? "Sign-in expired or API key not valid. Reconnect GymBuddy." : "Sign in to GymBuddy, or send an API key as Authorization: Bearer gbk_…" }, 401, { "www-authenticate": challenge });
}

export async function POST(request) {
  if (!configured()) return json({ error: "GymBuddy's MCP server isn't configured: missing Supabase URL/key env vars." }, 500);
  if (!bearer(request)) return unauthorized(request);
  const source = await lifterSource(request);
  if (!source) return unauthorized(request, true);

  let body;
  try { body = await request.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  // `today` is the server's (UTC) date; tools take explicit dates when it matters.
  const ctx = { source, today: today() };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMessage(m, ctx)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await handleMessage(body, ctx);
  return out ? json(out) : new Response(null, { status: 202, headers: CORS });
}

/** No server-to-client event stream here. Without a credential, a GET also starts the sign-in. */
export function GET(request) {
  if (!bearer(request)) return unauthorized(request);
  return new Response(null, { status: 405, headers: { allow: "POST", ...CORS } });
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
