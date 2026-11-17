/* Checks GymBuddy's MCP server (api/_mcp.js, api/mcp.js) on made-up data: npm run test:mcp.
   The protocol handshake, every tool, bad arguments, and the 401 that starts Claude's sign-in. */
import assert from "node:assert/strict";
import { demoAccount } from "./test-week-review.mjs";
import { handleMessage, toolList, PROTOCOL_VERSIONS } from "../api/_mcp.js";

process.env.SUPABASE_URL = "https://demo.supabase.co";
process.env.SUPABASE_ANON_KEY = "demo-publishable-key";
const { POST, GET } = await import("../api/mcp.js");
const meta = await import("../api/oauth-protected-resource.js");

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

console.log("mcp: all checks passed");
