import { liftHistory, foodDays, foodItems, setText, reviewKey, REVIEW_PREFIX, WEEKDAYS } from "../src/lib/weekReview.js";
import { PROGRAM, normalizeProgram } from "../src/data/program.js";
import { addDays, latestWeight } from "../src/lib/nutrition.js";

/* GymBuddy as an MCP server: the protocol and the tools, with no Supabase in sight so the test can
   drive it with made-up data (scripts/test-mcp.mjs). api/mcp.js does the sign-in and hands this a
   `source` that reads the signed-in lifter's rows, through row-level security.

   MCP is JSON-RPC over HTTP: Claude POSTs { jsonrpc, id, method, params } and gets { jsonrpc, id,
   result } back. Four methods matter: initialize (the handshake), tools/list (the menu),
   tools/call (run one tool) and ping. Every tool only reads: there is nothing here that writes.

   A source has: user ({ id, name }), account() (the ironlog-v2 record or null), food(start, end)
   (food_entries rows), review(weekEnd) and latestReviewKey() (saved week reviews). */

export const SERVER_INFO = { name: "gymbuddy", title: "GymBuddy", version: "1.0.0" };
/** Newest first. A client asking for one of these gets it back; anything else gets the newest. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = [
  "Read-only access to one lifter's GymBuddy log: the person who signed in when this connector was added.",
  "Call get_overview first: it has their name, program, goals, nutrition targets and what date ranges have data.",
  "Weights are in pounds. Sets read like 135x8 @2 RIR (weight x reps, reps in reserve); BW is bodyweight. e1rm is the estimated one-rep max.",
  "Dates are YYYY-MM-DD. Nothing here can change their log.",
].join(" ");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MEALS = ["breakfast", "lunch", "dinner", "snacks"];
const dateArg = (what) => ({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: what });
const weekdayOf = (d) => WEEKDAYS[new Date(d + "T12:00:00Z").getUTCDay()];
const r1 = (n) => Math.round(n * 10) / 10;

/** A bad argument: shown to Claude as a tool error it can fix and retry, not a protocol error. */
class ToolInputError extends Error {}

/** start/end from the arguments, defaulting to the `days` up to today, at most `max` days long. */
function range(args, today, days, max) {
  for (const k of ["start", "end"]) if (args[k] != null && !DATE.test(args[k])) throw new ToolInputError(`${k} must be a date like 2026-01-31.`);
  const end = args.end || today;
  let start = args.start || addDays(end, -(days - 1));
  if (start > end) throw new ToolInputError("start is after end.");
  if (addDays(start, max - 1) < end) start = addDays(end, -(max - 1));
  return { start, end };
}

const workoutName = (program, s) => program[s.day]?.name || (s.day === "custom" ? "Custom" : s.day || "Workout");
const minutes = (s) => (s.startedAt && s.finishedAt ? Math.round((s.finishedAt - s.startedAt) / 60000) : null);

/** The tools: name, description, input schema and what it does. `run(args, ctx)` returns plain JSON. */
export const TOOLS = [
  {
    name: "get_overview",
    title: "Overview",
    description: "Start here. The lifter's name, current program (days, lifts, sets and rep ranges), phase (bulk or cut), nutrition targets, latest bodyweight, and how much is logged: first and last workout, workouts in the last 30 days, whether food is tracked.",
    inputSchema: { type: "object", properties: {} },
    async run(_, { source, today }) {
      const a = (await source.account()) || {};
      const prefs = a.prefs || {}, sessions = a.sessions || [], weighins = a.weighins || [];
      const program = programOf(a);
      const dates = sessions.map((s) => s.date).sort();
      const bw = latestWeight(sessions, weighins);
      return {
        name: source.user.name || null,
        today,
        program: Object.entries(program).filter(([, d]) => d?.exercises?.length).map(([id, d]) => ({
          id, name: d.name, focus: d.detail || null,
          lifts: d.exercises.map((e) => ({ name: e.n, sets: e.sets, reps: Array.isArray(e.reps) ? `${e.reps[0]}-${e.reps[1]}` : e.reps ?? null })),
        })),
        phase: prefs.phase && !prefs.phase.endedAt ? prefs.phase : null,
        profile: prefs.profile || null,
        nutrition: { tracking: !!prefs.nutrition?.on, targets: prefs.nutrition?.targets || null },
        workouts: {
          total: sessions.length, first: dates[0] || null, last: dates.at(-1) || null,
          last30Days: dates.filter((d) => d > addDays(today, -30)).length,
        },
        bodyweight: bw ? { lb: r1(+bw.bw), date: bw.date } : null,
        weighIns: weighins.length,
      };
    },
  },
  {
    name: "list_workouts",
    title: "Workouts",
    description: "Workouts between two dates (default: the last 28 days, at most 92 days): date, workout name, minutes, every set of every lift, and the lifter's note.",
    inputSchema: { type: "object", properties: { start: dateArg("First day (default: 27 days before end)."), end: dateArg("Last day (default: today).") } },
    async run(args, { source, today }) {
      const { start, end } = range(args, today, 28, 92);
      const a = (await source.account()) || {};
      const program = programOf(a);
      const rows = (a.sessions || []).filter((s) => s.date >= start && s.date <= end).sort((x, y) => x.date.localeCompare(y.date) || (x.startedAt || 0) - (y.startedAt || 0));
      return {
        from: start, to: end, count: rows.length,
        workouts: rows.map((s) => ({
          date: s.date, weekday: weekdayOf(s.date), workout: workoutName(program, s), minutes: minutes(s),
          lifts: Object.fromEntries(Object.entries(s.sets || {}).filter(([, xs]) => xs?.length).map(([n, xs]) => [n, xs.map(setText).join(", ")])),
          note: s.note || undefined,
        })),
      };
    },
  },
  {
    name: "lift_history",
    title: "One lift's history",
    description: "One lift's last 12 sessions: every set and the estimated one-rep max (e1rm). Partial names work (\"pulldown\"); if nothing matches, it lists the lift names that exist.",
    inputSchema: { type: "object", properties: { lift: { type: "string", description: "The lift's name, or part of it." } }, required: ["lift"] },
    async run({ lift }, { source, today }) {
      if (typeof lift !== "string" || !lift.trim()) throw new ToolInputError("lift is required.");
      const a = (await source.account()) || {};
      return liftHistory(a.sessions || [], lift.trim().slice(0, 80), today);
    },
  },
  {
    name: "food_days",
    title: "Food by day",
    description: "Calories, protein, carbs and fat for each day between two dates (default: the last 14 days, at most 42), with calories per meal. Days with nothing logged say so.",
    inputSchema: { type: "object", properties: { start: dateArg("First day (default: 13 days before end)."), end: dateArg("Last day (default: today).") } },
    async run(args, { source, today }) {
      const { start, end } = range(args, today, 14, 42);
      return foodDays(await source.food(start, end), start, end);
    },
  },
  {
    name: "food_items",
    title: "Foods eaten",
    description: "The individual foods logged between two dates (default: today only, at most 31 days, first 80 items), optionally for one meal.",
    inputSchema: {
      type: "object",
      properties: { start: dateArg("First day (default: end)."), end: dateArg("Last day (default: today)."), meal: { type: "string", enum: MEALS } },
    },
    async run(args, { source, today }) {
      if (args.meal != null && !MEALS.includes(args.meal)) throw new ToolInputError(`meal must be one of ${MEALS.join(", ")}.`);
      const { start, end } = range(args, today, 1, 31);
      return foodItems(await source.food(start, end), start, end, args.meal);
    },
  },
  {
    name: "bodyweight",
    title: "Bodyweight",
    description: "Weigh-ins (lb) between two dates (default: the last 90 days, at most 366).",
    inputSchema: { type: "object", properties: { start: dateArg("First day (default: 89 days before end)."), end: dateArg("Last day (default: today).") } },
    async run(args, { source, today }) {
      const { start, end } = range(args, today, 90, 366);
      const a = (await source.account()) || {};
      const rows = (a.weighins || []).filter((w) => w.date >= start && w.date <= end && +w.bw > 0).sort((x, y) => x.date.localeCompare(y.date));
      return { from: start, to: end, weighIns: rows.map((w) => ({ date: w.date, lb: r1(+w.bw) })) };
    },
  },
  {
    name: "week_review",
    title: "Week in review",
    description: "A week in review the coaches already wrote: headline, summary, training, food, highs and lows, insights and next week's focus. Default: the latest one.",
    inputSchema: { type: "object", properties: { week_end: dateArg("The review's last day (default: the latest review).") } },
    async run(args, { source }) {
      if (args.week_end != null && !DATE.test(args.week_end)) throw new ToolInputError("week_end must be a date like 2026-01-31.");
      const key = args.week_end ? reviewKey(args.week_end) : await source.latestReviewKey();
      const r = key ? await source.review(key.slice(REVIEW_PREFIX.length)) : null;
      if (!r) return { error: args.week_end ? `No review for the week ending ${args.week_end}.` : "No week in review written yet." };
      return { weekStart: r.start, weekEnd: r.weekEnd, writtenAt: r.generatedAt ? new Date(r.generatedAt).toISOString() : null, review: r.story };
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

function programOf(account) {
  try { return account.program ? normalizeProgram(account.program) : PROGRAM; } catch { return PROGRAM; }
}

/** The menu Claude sees. Every tool is marked read-only, so clients can skip asking before each call. */
export const toolList = () => TOOLS.map(({ name, title, description, inputSchema }) => ({
  name, title, description, inputSchema,
  annotations: { title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}));

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/**
 * Answers one JSON-RPC message. Returns the response object, or null for a notification (no id),
 * which gets no reply. `ctx`: { source, today }.
 */
export async function handleMessage(msg, ctx) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg?.id, -32600, "Invalid request");
  const { id, method, params = {} } = msg;
  if (id === undefined) return null; // notifications/initialized and friends: nothing to say back

  switch (method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return ok(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: toolList() });
    case "tools/call": {
      const tool = TOOL_BY_NAME.get(params.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const out = await tool.run(params.arguments || {}, ctx);
        return ok(id, { content: [{ type: "text", text: JSON.stringify(out) }], isError: !!out?.error });
      } catch (e) {
        // A bad argument is Claude's to fix; anything else (Supabase down) is ours, kept vague.
        if (!(e instanceof ToolInputError)) console.error("mcp tool failed", params.name, e?.message ?? e);
        const text = e instanceof ToolInputError ? e.message : "Couldn't read the log just now. Try again in a minute.";
        return ok(id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}
