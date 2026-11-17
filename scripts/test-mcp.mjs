/* Checks GymBuddy's AI-app endpoints on made-up data: npm run test:mcp. The MCP handshake, every
   tool, bad arguments, the 401 that starts an app's sign-in, the REST API and its OpenAPI
   description, and API-key sign-in (api/_mcp.js, api/mcp.js, api/tools.js, api/_lifter.js). */
import assert from "node:assert/strict";
import { demoAccount } from "./test-week-review.mjs";
import { handleMessage, toolList, runTool, PROTOCOL_VERSIONS } from "../api/_mcp.js";

process.env.SUPABASE_URL = "https://demo.supabase.co";
process.env.SUPABASE_ANON_KEY = "demo-publishable-key";
const { POST, GET } = await import("../api/mcp.js");
const meta = await import("../api/oauth-protected-resource.js");
const rest = await import("../api/tools.js");
const { lifterSource } = await import("../api/_lifter.js");

const WEEK_END = "2026-10-11";
const a = demoAccount(WEEK_END);
const review = { start: "2026-10-05", weekEnd: WEEK_END, generatedAt: Date.UTC(2026, 9, 12), story: { headline: "Three for four." } };
const source = {
  user: { id: "u1", name: "Sam" },
  account: async () => ({ sessions: a.sessions, weighins: a.weighins, prefs: a.prefs, program: a.program }),
  food: async (start, end) => a.food.filter((f) => f.date >= start && f.date <= end),
  review: async (weekEnd) => (weekEnd === WEEK_END ? review : null),
  latestReviewKey: async () => `week-review:${WEEK_END}`,
};
const ctx = { source, today: WEEK_END };
let id = 0;
const rpc = (method, params) => handleMessage({ jsonrpc: "2.0", id: ++id, method, params }, ctx);
const call = async (name, args = {}) => {
  const r = await rpc("tools/call", { name, arguments: args });
  return { ...r.result, data: r.result.isError && !r.result.content[0].text.startsWith("{") ? r.result.content[0].text : JSON.parse(r.result.content[0].text) };
};

// Handshake
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
assert.equal(init.result.protocolVersion, "2025-06-18", "echoes a supported version");
assert.ok(init.result.capabilities.tools);
const withIcon = await handleMessage({ jsonrpc: "2.0", id: 500, method: "initialize", params: {} }, { ...ctx, origin: "https://gym.example" });
assert.equal(withIcon.result.serverInfo.icons[0].src, "https://gym.example/icons/connector-128.png", "server icon on the app's address");
assert.equal(init.result.serverInfo.icons, undefined, "no address, no icon");
assert.equal((await rpc("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion, PROTOCOL_VERSIONS[0], "unknown version gets the newest");
assert.equal(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx), null, "notifications get no reply");
assert.deepEqual((await rpc("ping")).result, {});
assert.equal((await rpc("resources/list")).error.code, -32601);
assert.equal((await handleMessage({ id: 1, method: "ping" }, ctx)).error.code, -32600, "not JSON-RPC 2.0");

// The menu: every tool read-only
const tools = (await rpc("tools/list")).result.tools;
assert.deepEqual(tools.map((t) => t.name), ["get_overview", "list_workouts", "lift_history", "food_days", "food_items", "bodyweight", "week_review"]);
assert.ok(tools.every((t) => t.annotations.readOnlyHint && !t.annotations.destructiveHint && t.inputSchema.type === "object"));
assert.equal(toolList().length, tools.length);

// Tools
const ov = (await call("get_overview")).data;
assert.equal(ov.name, "Sam");
assert.equal(ov.program.length, 4);
assert.ok(ov.program[0].lifts[0].reps.includes("-"));
assert.equal(ov.nutrition.tracking, true);
assert.equal(ov.phase.type, "cut");
assert.equal(ov.workouts.total, a.sessions.length);
assert.equal(ov.workouts.last, a.sessions.map((s) => s.date).sort().at(-1));
assert.ok(ov.bodyweight.lb > 150 && ov.bodyweight.date);

const wk = (await call("list_workouts", { start: "2026-10-05", end: WEEK_END })).data;
assert.equal(wk.count, 3, "three workouts that week");
assert.match(Object.values(wk.workouts[0].lifts)[0], /^\d+x\d+ @2 RIR/);
assert.ok(wk.workouts[0].minutes >= 55);
assert.ok(wk.workouts.some((w) => w.note === "Shoulder felt tight on presses"));
const def = (await call("list_workouts")).data;
assert.equal(def.from, "2026-09-14", "default is the last 28 days");
assert.equal((await call("list_workouts", { start: "2025-01-01" })).data.from, "2026-07-12", "capped at 92 days");

const lh = (await call("lift_history", { lift: "pulldown" })).data;
assert.equal(lh.lift, "Lat Pulldown (Wide Grip)");
assert.ok(lh.sessions.length > 0 && lh.sessions.length <= 12 && lh.sessions[0].e1rm > 0);
assert.ok((await call("lift_history", { lift: "zercher" })).data.lifts.length > 0, "unknown lift lists the real ones");
assert.equal((await call("lift_history", {})).isError, true);

const fd = (await call("food_days", { start: "2026-10-05", end: WEEK_END })).data;
assert.equal(fd.days.length, 7);
assert.ok(fd.days.find((d) => d.logged !== false).protein > 0);
assert.equal((await call("food_days")).data.days.length, 14);

const fi = (await call("food_items", { start: "2026-10-10", end: "2026-10-10", meal: "dinner" })).data;
assert.ok(fi.items.some((x) => x.name === "IPA beer"), "Saturday's beer");
assert.ok(fi.items.every((x) => x.meal === "dinner"));
assert.equal((await call("food_items", { meal: "brunch" })).isError, true);

const bw = (await call("bodyweight")).data;
assert.ok(bw.weighIns.length >= 8 && bw.weighIns[0].lb > 150);

assert.equal((await call("week_review")).data.review.headline, "Three for four.");
assert.match((await call("week_review", { week_end: "2026-09-27" })).data.error, /No review/);

// Bad input is a tool error Claude can fix, not a crash
for (const args of [{ start: "Oct 5" }, { start: "2026-10-11", end: "2026-10-01" }]) {
  const r = await call("list_workouts", args);
  assert.equal(r.isError, true, JSON.stringify(args));
}
assert.equal((await rpc("tools/call", { name: "drop_tables" })).error.code, -32602);

// A failing database read is reported vaguely, not thrown
const broken = { ...ctx, source: { ...source, account: async () => { throw new Error("connection refused"); } } };
const quiet = console.error; console.error = () => {};
const br = await handleMessage({ jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "get_overview" } }, broken);
console.error = quiet;
assert.equal(br.result.isError, true);
assert.doesNotMatch(br.result.content[0].text, /connection refused/);

// HTTP: no token → 401 pointing at the sign-in metadata
const req = (init) => new Request("https://gym.example/api/mcp", init);
const r401 = await POST(req({ method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }), headers: { "content-type": "application/json" } }));
assert.equal(r401.status, 401);
assert.match(r401.headers.get("www-authenticate"), /^Bearer resource_metadata="https:\/\/gym\.example\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
assert.equal((await GET(req({ method: "GET" }))).status, 401);
assert.equal((await GET(req({ method: "GET", headers: { authorization: "Bearer x" } }))).status, 405);

const m = await (await meta.GET(new Request("https://gym.example/.well-known/oauth-protected-resource/api/mcp"))).json();
assert.equal(m.resource, "https://gym.example/api/mcp");
assert.deepEqual(m.authorization_servers, ["https://demo.supabase.co/auth/v1"]);

// runTool: the one path MCP and REST share
assert.deepEqual(Object.keys((await runTool("get_overview", {}, ctx)).data).slice(0, 2), ["name", "today"]);
assert.equal((await runTool("nope", {}, ctx)).status, 404);
assert.equal((await runTool("list_workouts", { start: "x" }, ctx)).status, 400);
const unknownLift = await runTool("lift_history", { lift: "zercher" }, ctx);
assert.equal(unknownLift.status, 400);
assert.ok(unknownLift.data.lifts.length > 0, "keeps the list of real lifts");

// REST: the listing and OpenAPI need no key; running a tool does
const at = (path, init) => new Request(`https://gym.example${path}`, init);
const list = await (await rest.GET(at("/api/tools"))).json();
assert.equal(list.tools.length, 7);
assert.equal(list.openapi, "https://gym.example/api/tools/openapi.json");
const spec = await (await rest.GET(at("/api/tools?tool=openapi.json"))).json();
assert.equal(spec.openapi, "3.1.0");
assert.equal(Object.keys(spec.paths).length, 7);
assert.equal(spec.paths["/api/tools/lift_history"].post.operationId, "liftHistory");
assert.deepEqual(spec.paths["/api/tools/lift_history"].post.requestBody.content["application/json"].schema.required, ["lift"]);
assert.equal((await rest.POST(at("/api/tools?tool=get_overview", { method: "POST" }))).status, 401);
assert.equal((await rest.POST(at("/api/tools?tool=get_overview", { method: "POST", body: "{nope", headers: { authorization: "Bearer x" } }))).status, 400);

// API-key sign-in: every read goes through the api_* functions, with the key
const calls = [];
const fakeDb = (rows) => () => ({
  rpc(fn, args) {
    calls.push([fn, args]);
    const out = fn === "api_whoami" ? (args.p_key.endsWith("0") ? { name: "Sam" } : null)
      : fn === "api_kv" ? (args.p_kv_key === "ironlog-v2" ? JSON.stringify({ sessions: a.sessions.slice(0, 2) }) : JSON.stringify(review))
      : fn === "api_latest_review_key" ? `week-review:${WEEK_END}` : rows;
    const p = Promise.resolve({ data: out, error: null });
    return Object.assign(p, { range: () => p });
  },
  auth: { getUser: async () => ({ data: { user: null } }) },
});
const KEY = "gbk_" + "a1".repeat(23) + "00";
const withKey = (k) => new Request("https://gym.example/api/mcp", { headers: { authorization: `Bearer ${k}` } });
const ks = await lifterSource(withKey(KEY), fakeDb([{ date: WEEK_END, meal: "lunch", name: "Rice", amount: "1", unit: "cup", kcal: "200", protein: "4", carbs: "45", fat: "0" }]));
assert.equal(ks.user.name, "Sam");
assert.equal((await ks.account()).sessions.length, 2);
assert.equal((await ks.food(WEEK_END, WEEK_END))[0].kcal, 200, "numbers come back as numbers");
assert.equal((await ks.review(WEEK_END)).story.headline, "Three for four.");
assert.equal(await ks.latestReviewKey(), `week-review:${WEEK_END}`);
assert.ok(calls.every(([, args]) => args.p_key === KEY), "every call carries the key");
assert.deepEqual(calls.find(([fn]) => fn === "api_food")[1], { p_key: KEY, p_start: WEEK_END, p_end: WEEK_END });
assert.equal(await lifterSource(withKey("gbk_" + "a1".repeat(24)), fakeDb([])), null, "unknown key");
assert.equal(await lifterSource(withKey("gbk_short"), fakeDb([])), null, "malformed key is tried as a token, and fails");
assert.equal(await lifterSource(new Request("https://gym.example/api/mcp"), fakeDb([])), null, "no credential");

console.log("mcp: all checks passed");
