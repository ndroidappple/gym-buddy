import { TOOLS, runTool, SERVER_INFO } from "./_mcp.js";
import { lifterSource, configured, originOf, bearer } from "./_lifter.js";
import { today } from "../src/lib/util.js";

/* The same read-only tools as the MCP server, as a plain REST API, for AI apps that don't speak MCP
   but can call a web API with a key (custom GPT actions, assistants that write their own
   integration code, scripts):

     GET  /api/tools                     the tools and how to call them (no key needed)
     GET  /api/tools/openapi.json        an OpenAPI 3.1 description (no key needed)
     POST /api/tools/<tool>              run one: JSON body of arguments
     GET  /api/tools/<tool>?start=…      or the arguments as query parameters

   Send `Authorization: Bearer <key>`: an API key from Settings → AI assistants, or an OAuth access
   token. vercel.json rewrites /api/tools/<x> to /api/tools?tool=<x>. */

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });

/** OpenAPI 3.1 for the tools: one POST operation each, its arguments as the JSON body. */
export function openApi(origin) {
  return {
    openapi: "3.1.0",
    info: { title: "GymBuddy", version: SERVER_INFO.version, description: "Read-only access to one lifter's GymBuddy log: workouts, lifts, food, bodyweight and weeks in review. Weights are in pounds; dates are YYYY-MM-DD. Call getOverview first." },
    servers: [{ url: origin }],
    security: [{ bearer: [] }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "An API key from GymBuddy → Settings → AI assistants (gbk_…)." } } },
    paths: Object.fromEntries(TOOLS.map((t) => [`/api/tools/${t.name}`, {
      post: {
        operationId: t.name.replace(/_(\w)/g, (_, c) => c.toUpperCase()),
        summary: t.title,
        description: t.description,
        requestBody: { required: false, content: { "application/json": { schema: t.inputSchema } } },
        responses: {
          200: { description: "The result.", content: { "application/json": { schema: { type: "object" } } } },
          400: { description: "A bad argument, or nothing found; the message says which." },
          401: { description: "Missing or bad API key." },
        },
      },
    }])),
  };
}

async function handle(request, args) {
  const name = new URL(request.url).searchParams.get("tool");
  if (!name) {
    return json({
      name: "GymBuddy", readOnly: true, auth: "Authorization: Bearer <API key from Settings → AI assistants>",
      call: "POST /api/tools/<name> with a JSON body of arguments (or GET with query parameters)",
      openapi: `${originOf(request)}/api/tools/openapi.json`, mcp: `${originOf(request)}/api/mcp`,
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, arguments: inputSchema.properties, required: inputSchema.required || [] })),
    });
  }
  if (name === "openapi.json") return json(openApi(originOf(request)));
  if (!configured()) return json({ error: "Not configured: missing Supabase URL/key env vars." }, 500);
  if (!bearer(request)) return json({ error: "Send an API key as Authorization: Bearer gbk_… (Settings → AI assistants)." }, 401);
  const source = await lifterSource(request);
  if (!source) return json({ error: "That API key isn't valid. Make a new one in Settings → AI assistants." }, 401);
  const r = await runTool(name, args, { source, today: today() });
  return r.ok ? json(r.data) : json(r.data || { error: r.error }, r.status);
}

export async function GET(request) {
  const args = Object.fromEntries([...new URL(request.url).searchParams].filter(([k]) => k !== "tool"));
  return handle(request, args);
}

export async function POST(request) {
  let args = {};
  const text = await request.text();
  if (text.trim()) {
    try { args = JSON.parse(text); } catch { return json({ error: "The body must be JSON." }, 400); }
  }
  return handle(request, args);
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
