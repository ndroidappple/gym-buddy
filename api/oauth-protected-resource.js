import { originOf } from "./_lifter.js";

/* OAuth discovery for MCP apps (any provider: it's the standard MCP sign-in). vercel.json rewrites
   these here:

   - /.well-known/oauth-protected-resource (RFC 9728), what current MCP apps read: it names this
     project's Supabase Auth as the sign-in server for /api/mcp.
   - /.well-known/oauth-authorization-server (RFC 8414), what apps on the older MCP spec (2025-03-26)
     look for on the MCP server's own address instead: Supabase's own document, passed through.

   The app then registers itself with Supabase and sends the lifter to /oauth/consent. */

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const HEADERS = { "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" };

export async function GET(request) {
  if (!SUPABASE_URL) return Response.json({ error: "Missing Supabase URL env var." }, { status: 500 });
  if (new URL(request.url).searchParams.get("doc") === "authorization-server") {
    const r = await fetch(`${SUPABASE_URL}/.well-known/oauth-authorization-server/auth/v1`).catch(() => null);
    if (!r?.ok) return Response.json({ error: "Couldn't reach the sign-in server." }, { status: 502 });
    return Response.json(await r.json(), { headers: HEADERS });
  }
  return Response.json({
    resource: `${originOf(request)}/api/mcp`,
    authorization_servers: [`${SUPABASE_URL}/auth/v1`],
    // Just email: "openid" makes Supabase sign an ID token, which fails on a project still on the
    // legacy (HS256) JWT secret. The access token is the same whatever the scope.
    scopes_supported: ["email"],
    bearer_methods_supported: ["header"],
    resource_name: "GymBuddy",
  }, { headers: HEADERS });
}
