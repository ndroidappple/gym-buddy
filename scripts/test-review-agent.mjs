/* The review agent's loop with a scripted model (no network): tools run on the lifter's data, the
   results go back to the model, write_review ends the run, and a model that won't write it is
   cut down to write_review only, then given up on. npm run test:review */
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { agentReview, reviewTools } from "../api/review.js";
import { buildWeekFacts, cleanStory, fallbackStory } from "../src/lib/weekReview.js";
import { demoAccount } from "./test-week-review.mjs";

const usage = { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 20, text: 20 } };
const call = (toolName, input, id) => ({
  content: [{ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [],
});
const REVIEW = {
  headline: "Three for four, and your back took the week.",
  summary: "Solid week.",
  training: { title: "3 workouts", body: "Good.", coach: "tank" },
  high: { title: "Pulldown PR", body: "80×12.", coach: "wings" },
  low: { title: "Friday", body: "Missed it.", coach: "tank" },
  insights: [{ title: "Rest-day protein", body: "Rest days run 60 g short.", coach: "tank", evidence: "112 vs 172 g" }],
  focus: [{ action: "Hit 170 g protein on rest days", why: "Rest days are where you lose it.", coach: "tank" }],
};

const a = demoAccount();
const data = { ...a, tz: "America/New_York" };
const facts = buildWeekFacts({ ...data, weekEnd: "2026-10-11" });

// 1. Digs with two tools, then writes.
const seen = [];
const script = [
  call("lift_history", { lift: "pulldown" }, "c1"),
  call("food_days", { start: "2026-10-05", end: "2026-10-11" }, "c2"),
  call("write_review", REVIEW, "c3"),
];
let i = 0;
const model = new MockLanguageModelV4({
  doGenerate: async (opts) => { seen.push(opts); return script[i++]; },
});
const out = await agentReview({ facts, data, model, fallbacks: [] });
assert.equal(i, 3, "three model steps");
assert.equal(out.story.headline, REVIEW.headline);
const toolResults = JSON.stringify(seen[1].prompt);
assert.match(toolResults, /Lat Pulldown \(Wide Grip\)/, "lift_history's result went back to the model");
assert.match(JSON.stringify(seen[2].prompt), /"meals"/, "food_days's result went back to the model");
assert.ok(seen[0].tools.some((t) => t.name === "earlier_week"), "all tools offered at first");
const story = cleanStory(out.story, facts, fallbackStory(facts));
assert.deepEqual(story.nutrition, fallbackStory(facts).nutrition, "a card the agent skipped comes from code");

// 2. A model that keeps calling tools: from step 6 only write_review is offered, and after 8 steps it stops.
const tools = [];
const loop = new MockLanguageModelV4({
  doGenerate: async (opts) => { tools.push(opts.tools.map((t) => t.name)); return call("earlier_week", { weeks_ago: 1 }, `l${tools.length}`); },
});
await assert.rejects(agentReview({ facts, data, model: loop, fallbacks: [] }), /no review written/);
assert.deepEqual(tools[5], ["write_review"], "cut down to write_review");
assert.ok(tools.length <= 8, "gives up after 8 steps");

// 3. The tools on their own.
const t = reviewTools(data, facts);
const snap = await t.earlier_week.execute({ weeks_ago: 1 }, {});
assert.equal(snap.end, "2026-10-04");
const items = await t.food_items.execute({ start: "2026-10-05", end: "2026-12-31", meal: "dinner" }, {});
assert.ok(items.items.every((x) => x.date <= "2026-10-11"), "never past the week's end");

console.log("review agent: all checks passed");

// 4. The whole request, with Supabase and the gateway stubbed: auth, the review-day check, the
//    food log read, a model failure falling back to the code-written review, the save, the cap.
{
  process.env.SUPABASE_URL = "http://sb.test"; process.env.SUPABASE_ANON_KEY = "anon";
  const { POST } = await import(`../api/review.js?handler`);
  const kv = { "ironlog-v2": JSON.stringify({ sessions: a.sessions, weighins: a.weighins, prefs: a.prefs, program: a.program }) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const req = new Request(input, init), u = new URL(req.url);
    const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u.host !== "sb.test") return ok({ error: { message: "no gateway in tests" } }, 401); // the model call fails
    if (u.pathname === "/auth/v1/user") return req.headers.get("authorization") === "Bearer good" ? ok({ id: "u1", aud: "authenticated" }) : ok({ msg: "bad jwt" }, 401);
    if (u.pathname === "/rest/v1/food_entries") return ok(a.food.filter((f) => f.date >= u.searchParams.getAll("date")[0].slice(4)));
    if (u.pathname === "/rest/v1/storage_kv" && req.method === "GET") {
      const key = u.searchParams.get("key").slice(3);
      return ok(kv[key] ? [{ value: kv[key] }] : []);
    }
    if (u.pathname === "/rest/v1/storage_kv") { const row = await req.json(); kv[row.key] = row.value; return ok([], 201); }
    return ok([]);
  };
  const today = new Date().toISOString().slice(0, 10);
  const sunday = (() => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); })();
  const post = (body, token = "good") => POST(new Request("http://app/api/review", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
  try {
    assert.equal((await post({ weekEnd: sunday }, "bad")).status, 401, "signed out");
    assert.equal((await post({ weekEnd: "2025-01-05" })).status, 400, "an old week");
    const notSunday = new Date(sunday + "T12:00:00Z"); notSunday.setUTCDate(notSunday.getUTCDate() - 1);
    assert.equal((await post({ weekEnd: notSunday.toISOString().slice(0, 10) })).status, 400, "not their review day");
    const quiet = console.error; console.error = () => {};
    const res = await post({ weekEnd: sunday, tz: "America/New_York" });
    console.error = quiet;
    const r = await res.json();
    assert.equal(res.status, 200);
    assert.equal(r.source, "code", "no model: written by code");
    assert.ok(r.story.headline && r.facts.weekEnd === sunday && r.gens === 1);
    assert.ok(kv[`week-review:${sunday}`], "saved to the account");
    const again = await (await post({ weekEnd: sunday })).json();
    assert.equal(again.generatedAt, r.generatedAt, "saved review comes back without a new run");
    const same = await (await post({ weekEnd: sunday, refresh: true })).json();
    assert.equal(same.gens, 1, "an update with nothing new logged keeps the review");
    kv[`week-review:${sunday}`] = JSON.stringify({ ...r, gens: 3, fingerprint: "x" });
    assert.equal((await (await post({ weekEnd: sunday, refresh: true })).json()).capped, true, "capped after 3 runs");
  } finally {
    globalThis.fetch = realFetch;
  }
  console.log("review request: all checks passed");
}
