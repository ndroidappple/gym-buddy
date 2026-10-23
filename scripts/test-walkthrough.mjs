/* Checks the coach's walkthrough of a workout (src/lib/walkthrough.js, the walk mode in api/coach.js):
   the places a step can point at, what's kept of the coach's steps (unknown places, chart moments for
   sets with no time, too many steps), when a kept walkthrough goes stale, what the coach reads, the
   reply stream carrying the steps, disconnecting Google Health taking a heart rate walkthrough too, and
   the changes a step can offer (checked against the plan, labelled, applied and undone one by one).
   Run: npm run test:coach   (exits 1 on any failure) */
import { createServer } from "vite";

let failed = 0;
const ok = (name, cond, detail = "") => { if (!cond) { failed++; console.error(`✗ ${name}${detail ? `\n    ${String(detail).slice(0, 1500)}` : ""}`); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);

process.env.VITE_SUPABASE_URL ||= "https://example.supabase.co"; // nothing here talks to it
process.env.VITE_SUPABASE_ANON_KEY ||= "test";
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const W = await vite.ssrLoadModule("/src/lib/walkthrough.js");
const H = await vite.ssrLoadModule("/src/lib/heart.js");
const { PROGRAM } = await vite.ssrLoadModule("/src/data/program.js");
const { applyChanges, describeProgram } = await vite.ssrLoadModule("/src/lib/programChange.js");
await vite.close();
const api = await import("../api/coach.js");

const T = Date.parse("2026-10-22T22:00:00Z");
const hr = { v: 2, avg: 115, max: 145, low: 88, bounds: [96, 117, 142, 167], source: "google", zones: { light: 20, moderate: 25, vigorous: 6, peak: 0 }, hard: 6, complete: true, at: T + 4e6 };
const workout = {
  id: "w1", day: "push", date: "2026-10-22", startedAt: T, finishedAt: T + 3.6e6, note: "Felt strong",
  sets: {
    "Flat DB Press": [{ w: 70, r: 10, rir: 2, t: T + 6e5, hr: 140, hrRest: 110 }, { w: 70, r: 8, rir: 1, t: T + 7.5e5, hr: 145 }],
    "Machine Pec Dec": [{ w: 120, r: 12, rir: 2 }],
    "Treadmill Run": [{ min: 10 }],
  },
  hr,
};
const before = { id: "w0", day: "push", date: "2026-10-18", sets: { "Flat DB Press": [{ w: 65, r: 10 }, { w: 65, r: 9 }] }, hr: { ...hr, avg: 108, max: 139 } };

// Places: what the recap shows, in screen order.
const withHeart = W.walkPlaces(workout, { heart: true }).map((p) => p.id);
eq("places with heart rate", withHeart, ["overview", "heart", "chart", "zones", "hr:Flat DB Press", "lift:Flat DB Press", "lift:Machine Pec Dec", "cardio:Treadmill Run"]);
eq("places without heart rate (not connected)", W.walkPlaces(workout, { heart: false }).map((p) => p.id), ["overview", "lift:Flat DB Press", "lift:Machine Pec Dec", "cardio:Treadmill Run"]);
ok("showsHeart needs Google Health on", !W.showsHeart(workout, { googleHealth: { on: false } }) && W.showsHeart(workout, { googleHealth: { on: true } }));
ok("showsHeart: nothing from the watch", !W.showsHeart({ ...workout, hr: { none: true } }, { googleHealth: { on: true } }));

// What's kept of the coach's steps.
const places = W.walkPlaces(workout, { heart: true });
const steps = W.cleanWalk({
  steps: [
    { kind: "overall", target: "overview", title: "  Solid push day ", text: "Good   session overall." },
    { kind: "good", target: "Flat DB Press", title: "Press moved up", text: "70s for 10." },
    { kind: "improve", target: "chart", lift: "Flat DB Press", set: 2, title: "Second set ran hot", text: "145 bpm." },
    { kind: "improve", target: "chart", lift: "Machine Pec Dec", set: 1, title: "No time", text: "No set time." },
    { kind: "bogus", target: "lift:Squat", title: "", text: "Not on screen." },
    { kind: "next", target: "lift:Machine Pec Dec", title: "Add weight", text: "Go to 130." },
    { kind: "next", target: "overview", title: "Extra", text: "Seventh step." },
    { kind: "good", target: "overview", title: "Empty", text: "  " },
  ],
}, places, workout);
eq("at most six steps, empty ones dropped", steps.length, 6);
eq("text and titles tidied", [steps[0].title, steps[0].text], ["Solid push day", "Good session overall."]);
eq("a bare lift name points at its row", steps[1].target, "lift:Flat DB Press");
eq("a chart moment for a set with a time", [steps[2].target, steps[2].lift, steps[2].set], ["chart", "Flat DB Press", 2]);
ok("no chart moment for a set without a time", steps[3].target === "chart" && steps[3].lift == null && steps[3].set == null, JSON.stringify(steps[3]));
eq("an unknown place and kind fall back", [steps[4].target, steps[4].kind, steps[4].title], ["overview", "good", "Done well"]);
eq("nothing usable is null", W.cleanWalk({ steps: [{ text: "" }] }, places, workout), null);
eq("no steps at all is null", W.cleanWalk(null, places, workout), null);

// Freshness: written from the sets and heart rate as they were.
const walk = { v: W.WALK_VERSION, basis: W.walkBasis(workout), coach: "tank", at: T, heart: true, steps };
ok("fresh while nothing changed", W.freshWalk({ ...workout, walk }) === walk);
ok("fresh after a note changes", W.freshWalk({ ...workout, note: "edited", walk }) === walk);
ok("stale once a set changes", !W.freshWalk({ ...workout, sets: { ...workout.sets, "Machine Pec Dec": [{ w: 120, r: 11, rir: 2 }] }, walk }));
ok("stale once more heart rate arrives", !W.freshWalk({ ...workout, hr: { ...hr, at: hr.at + 1 }, walk }));
ok("stale from an older version", !W.freshWalk({ ...workout, walk: { ...walk, v: 0 } }));

// What the coach reads.
const ctx = W.walkContext({ session: { ...workout, walk }, sessions: [before, workout], program: PROGRAM, profile: { doneAt: 1, goals: ["muscle"], days: 4 }, notes: ["Left shoulder tweaks on wide presses"], places });
ok("context: the workout's sets with times, rests and heart rate", /Flat DB Press: 70×10 \(RIR 2, .*HR 140, down to 110\)/.test(ctx), ctx.slice(0, 900));
ok("context: last time", ctx.includes("last time 2026-10-18"));
ok("context: no chat opener", !ctx.includes("opened this chat"));
ok("context: the day's plan", ctx.includes(`Plan for ${PROGRAM.push.name}`));
ok("context: the coach's notes", ctx.includes("Left shoulder tweaks"));
ok("context: earlier heart rate", ctx.includes("Heart rate in earlier workouts:") && ctx.includes("2026-10-18"));
ok("context: the places", ctx.includes("- hr:Flat DB Press:") && ctx.includes("- cardio:Treadmill Run:"));
ok("context: not the old walkthrough", !ctx.includes("Your walkthrough of this workout"));
const noHeart = W.walkContext({ session: { ...workout, hr: null, sets: { "Machine Pec Dec": [{ w: 120, r: 12 }] } }, sessions: [before], program: PROGRAM, places: W.walkPlaces(workout) });
ok("context without heart rate says nothing of it", !/heart rate/i.test(noHeart), noHeart);

// The server side: the prompt and the stream.
const sys = api.walkInstructions("piston", ctx);
ok("prompt: the coach and the data", sys.startsWith("You are Piston") && sys.includes("Lifter data:\n") && sys.includes("Places on the recap"));
ok("prompt: only listed places", sys.includes("Only use places that are listed"));
const schema = api.WALK_TOOL.walk_through.inputSchema.jsonSchema;
eq("tool: 3 to 6 steps", [schema.properties.steps.minItems, schema.properties.steps.maxItems], [3, 6]);
const fake = { fullStream: (async function* () {
  yield { type: "start-step" };
  yield { type: "tool-call", toolName: "walk_through", input: { steps: [{ kind: "overall", target: "overview", title: "x", text: "y" }] } };
})(), finishReason: Promise.resolve("tool-calls"), usage: Promise.resolve({}), response: Promise.resolve({ modelId: "m" }), providerMetadata: Promise.resolve(null) };
const out = await new Response(api.toReplyStream(fake, "m")).text();
const recs = out.split(api.PROPOSAL_MARK).slice(1).map((l) => JSON.parse(l));
ok("stream: the steps travel as a walk record, and it isn't empty", recs.some((r) => r.walk?.steps?.length === 1) && !recs.some((r) => r.status), out);

// Disconnecting Google Health: a walkthrough written with heart rate goes too; one without stays.
const gone = H.withoutHeart({ ...workout, walk });
ok("disconnect drops a heart rate walkthrough", !gone.walk && !gone.hr);
const plain = { ...workout, hr: undefined, sets: { "Machine Pec Dec": [{ w: 120, r: 12 }] }, walk: { ...walk, heart: false } };
ok("a walkthrough without heart rate isn't heart data", !H.hasHeart(plain) && H.withoutHeart(plain) === plain);
ok("a heart walkthrough alone counts as heart data", H.hasHeart({ id: "x", sets: {}, walk }));

// Changes a step can offer.
const P = PROGRAM;
const cc = (change) => W.cleanChange(change, P, workout);
eq("rest change kept, on this workout's day, with the plan's lift name", cc({ action: "update", day: "legs", exercise: "flat db press", rest_seconds: 120, junk: 1 }),
  { action: "update", day: "push", exercise: "Flat DB Press", rest_seconds: 120 });
eq("weight for next time kept", cc({ action: "weight", day: "push", exercise: "Flat DB Press", weight: 75 }), { action: "weight", day: "push", exercise: "Flat DB Press", weight: 75 });
eq("a change that changes nothing is dropped", cc({ action: "update", day: "push", exercise: "Flat DB Press", rest_seconds: 90 }), null);
eq("a lift not on the day is dropped", cc({ action: "update", day: "push", exercise: "Back Squat", rest_seconds: 120 }), null);
eq("rename isn't offered", cc({ action: "rename", day: "push", new_name: "Chest" }), null);
eq("no weight for cardio or nonsense", [cc({ action: "weight", exercise: "Flat DB Press", weight: -5 }), cc({ action: "weight", exercise: "Flat DB Press" })], [null, null]);
eq("custom workouts have no plan to change", W.cleanChange({ action: "update", exercise: "Flat DB Press", rest_seconds: 120 }, P, { ...workout, day: "custom" }), null);
const withChanges = W.cleanWalk({ steps: [
  { kind: "overall", target: "overview", title: "a", text: "a" },
  { kind: "improve", target: "lift:Flat DB Press", title: "b", text: "b", change: { action: "update", exercise: "Flat DB Press", rest_seconds: 120 } },
  { kind: "improve", target: "overview", title: "c", text: "c", change: { action: "update", exercise: "Machine Pec Dec", sets: 4 } },
  { kind: "next", target: "overview", title: "d", text: "d", change: { action: "weight", exercise: "Flat DB Press", weight: 75 } },
  { kind: "next", target: "overview", title: "e", text: "e", change: { action: "update", exercise: "Machine Pec Dec", rest_seconds: 60 } },
  { kind: "next", target: "overview", title: "f", text: "f", change: { action: "update", exercise: "Nope", rest_seconds: 60 } },
] }, places, workout, P);
eq("at most three changes, bad ones dropped", withChanges.map((x) => x.change?.action || null), [null, "update", "update", "weight", null, null]);
ok("cleanWalk without a program offers no changes", W.cleanWalk({ steps: [{ kind: "next", target: "overview", title: "x", text: "x", change: { action: "weight", exercise: "Flat DB Press", weight: 75 } }] }, places, workout).every((x) => !x.change));

eq("labels", [
  W.changeLabel(P, { action: "update", day: "push", exercise: "Flat DB Press", rest_seconds: 120 }),
  W.changeLabel(P, { action: "update", day: "push", exercise: "Flat DB Press", sets: 4, rep_min: 6, rep_max: 10 }),
  W.changeLabel(P, { action: "weight", day: "push", exercise: "Flat DB Press", weight: 72.5 }),
  W.changeLabel(P, { action: "replace", day: "push", exercise: "Flat DB Press", new_exercise: "Incline DB Press" }),
], ["Rest 90s → 2 min", "3 → 4 sets, Reps 8–12 → 6–10", "Start at 72.5 lb next time", "Swap for Incline DB Press"]);

// The weight for next time lives on the lift until a workout logs it, and the coaches see it.
const weighted = applyChanges(P, [{ action: "weight", day: "push", exercise: "Flat DB Press", weight: 75 }]);
eq("weight change sets next", weighted.program.push.exercises.find((e) => e.n === "Flat DB Press").next, { w: 75 });
ok("the same weight again is already done", applyChanges(weighted.program, [{ action: "weight", day: "push", exercise: "Flat DB Press", weight: 75 }]).errors.length === 1);
ok("coaches read the next-time weight", describeProgram(weighted.program).includes("Flat DB Press 3x8-12 90s (start at 75 lb next time)"));

// Undo takes back one change, even after another.
const a = applyChanges(P, [{ action: "update", day: "push", exercise: "Flat DB Press", rest_seconds: 120 }]).program;
const dA = W.changeDiff(P.push, a.push);
const b = applyChanges(a, [{ action: "replace", day: "push", exercise: "Machine Pec Dec", new_exercise: "Cable Fly (Low to High)" }]);
const ab = b.program;
const dB = W.changeDiff(a.push, ab.push);
const undoneA = W.undoDiff(ab, "push", dA);
eq("undo the first: its rest goes back", undoneA.push.exercises.find((e) => e.n === "Flat DB Press").rest, 90);
ok("undo the first: the later swap stays", !undoneA.push.exercises.some((e) => e.n === "Machine Pec Dec"), JSON.stringify(undoneA.push.exercises.map((e) => e.n)));
const undoneB = W.undoDiff(undoneA, "push", dB);
eq("undo both: back to the plan", JSON.stringify(undoneB.push), JSON.stringify(P.push));

// The tool schema carries the change.
const stepSchema = api.WALK_TOOL.walk_through.inputSchema.jsonSchema.properties.steps.items;
eq("tool: a step's change", stepSchema.properties.change.properties.action.enum, ["update", "weight", "replace", "add", "remove"]);
ok("prompt: changes are the lifter's call", api.walkInstructions("tank", "").includes("the lifter decides"));
ok("context: the day key for changes", ctx.includes("(day key push;"));

if (failed) { console.error(`\n${failed} walkthrough check(s) failed`); process.exit(1); }
console.log("walkthrough: all checks passed");
