import { originOf } from "./mcp.js";

/* OAuth protected resource metadata (RFC 9728) for the MCP server, served at
   /.well-known/oauth-protected-resource (vercel.json rewrites it here). It tells Claude which
   sign-in server issues tokens for /api/mcp: this project's Supabase Auth. Claude reads Supabase's
   own discovery document from there, registers itself, and sends the lifter to /oauth/consent. */

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");

export function GET(request) {
  if (!SUPABASE_URL) return Response.json({ error: "Missing Supabase URL env var." }, { status: 500 });
  return Response.json({
    resource: `${originOf(request)}/api/mcp`,
    authorization_servers: [`${SUPABASE_URL}/auth/v1`],
    // Just email: "openid" makes Supabase sign an ID token, which fails on a project still on the
    // legacy (HS256) JWT secret. The access token is the same whatever the scope.
    scopes_supported: ["email"],
    bearer_methods_supported: ["header"],
    resource_name: "GymBuddy",
  }, { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" } });
}
