/* Checks for the Google Health sync (api/_googleHealth.js): what gets sent, edited and taken back,
   the shapes Google expects, time zones, the sealed token and signed state, and the order of
   requests (an edit's old version goes before the new one is sent).
   Run: npm run test:health   (exits 1 on any failure) */
process.env.GOOGLE_HEALTH_CLIENT_ID = "test-client";
process.env.GOOGLE_HEALTH_CLIENT_SECRET = "test-secret";
const gh = await import("../api/_googleHealth.js");
const { plan, carryOut, sealToken, openToken, signState, readState, offsetSeconds, localInstant, localToday } = gh;

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const TZ = "America/New_York";
const NOW = Date.parse("2026-10-22T20:00:00Z"); // 4 pm in New York
const at = (s) => Date.parse(s);
const program = { push: { name: "Push" }, legs: { name: "Legs" } };
const session = (id, date, start, end, extra = {}) => ({ id, day: "push", date, startedAt: at(start), finishedAt: at(end), sets: { "Bench Press": [{ w: 185, r: 8 }, { w: 185, r: 7 }] }, ...extra });
const base = {
  account: {
    program,
    sessions: [
      session("a1", "2026-10-22", "2026-10-22T10:00:00Z", "2026-10-22T11:05:00Z", { bw: 182.4 }),
      session("old", "2026-10-15", "2026-10-15T10:00:00Z", "2026-10-15T11:00:00Z"),
    ],
    weighins: [{ date: "2026-10-21", bw: 183 }],
  },
  food: [
    { id: "f-1", date: "2026-10-22", meal: "breakfast", name: "Greek Yogurt", brand: "Fage", amount: 1, unit: "cup", kcal: 130, protein: 23, carbs: 9, fat: 0 },
    { id: "f-2", date: "2026-10-22", meal: "dinner", name: "Chicken Breast", brand: null, amount: 6, unit: "oz", kcal: 280, protein: 52, carbs: 0, fat: 6 },
  ],
  since: "2026-10-20", tz: TZ, now: NOW,
};

// Time zones.
eq("New York is UTC-4 in October", offsetSeconds(TZ, NOW), -14400);
eq("and UTC-5 in December", offsetSeconds(TZ, at("2026-12-01T12:00:00Z")), -18000);
eq("08:00 in New York", new Date(localInstant("2026-10-22", "08:00", TZ)).toISOString(), "2026-10-22T12:00:00.000Z");
eq("today in New York", localToday(TZ, at("2026-10-23T02:00:00Z")), "2026-10-22");
eq("a bad time zone is UTC", offsetSeconds("Not/AZone", NOW), 0);

// First sync: everything from `since` to today.
const first = plan(base);
eq("items sent, oldest first", first.send.map((s) => s.item), ["bw:2026-10-21", "bw:2026-10-22", "f:f-1", "f:f-2", "w:a1"]);
eq("nothing to take back", first.remove, []);
const w = first.send.find((s) => s.item === "w:a1");
eq("workout type", w.body.exercise.exerciseType, "STRENGTH_TRAINING");
eq("workout interval", w.body.exercise.interval, { startTime: "2026-10-22T10:00:00.000Z", startUtcOffset: "-14400s", endTime: "2026-10-22T11:05:00.000Z", endUtcOffset: "-14400s" });
eq("workout length", w.body.exercise.activeDuration, "3900s");
eq("workout notes", w.body.exercise.notes, "Push · 2 sets (GymBuddy)");
ok("workout has the required summary", w.body.exercise.metricsSummary && w.body.exercise.displayName);
ok("names are users/me/dataTypes/<type>/dataPoints/<4-63 of a-z 0-9 ->", first.send.every((s) => /^users\/me\/dataTypes\/(exercise|weight|nutrition-log)\/dataPoints\/[a-z0-9-]{4,63}$/.test(s.name)));
const wt = first.send.find((s) => s.item === "bw:2026-10-22");
eq("weight in grams", wt.body.weight.weightGrams, Math.round(182.4 * 453.59237));
eq("a workout's bodyweight is at its end", wt.body.weight.sampleTime, { physicalTime: "2026-10-22T11:05:00.000Z", utcOffset: "-14400s" });
eq("a weigh-in is at 7 am", first.send.find((s) => s.item === "bw:2026-10-21").body.weight.sampleTime.physicalTime, "2026-10-21T11:00:00.000Z");
const yog = first.send.find((s) => s.item === "f:f-1").body.nutritionLog;
eq("food name and portion", yog.foodDisplayName, "Fage Greek Yogurt (1 cup)");
eq("breakfast at 8 am", [yog.mealType, yog.interval.startTime], ["BREAKFAST", "2026-10-22T12:00:00.000Z"]);
eq("macros", [yog.energy, yog.totalCarbohydrate, yog.totalFat, yog.nutrients], [{ kcal: 130 }, { grams: 9 }, { grams: 0 }, [{ nutrient: "PROTEIN", quantity: { grams: 23 } }]]);
// Dinner at 6:30 pm is later than now (4 pm): it goes in before now instead, never in the future.
const dinner = first.send.find((s) => s.item === "f:f-2").body.nutritionLog;
eq("tonight's dinner isn't in the future", dinner.interval.startTime, "2026-10-22T19:45:00.000Z");

// After it's all sent, nothing new.
const synced = Object.fromEntries(first.send.map((s) => [s.item, s.name]));
const again = plan({ ...base, synced });
eq("second sync sends nothing", [again.send.length, again.remove.length], [0, 0]);

// An edit: a set added to the workout, a food amount changed.
const edited = {
  ...base,
  synced,
  account: { ...base.account, sessions: base.account.sessions.map((s) => (s.id === "a1" ? { ...s, sets: { ...s.sets, Dips: [{ w: 0, r: 12 }] } } : s)) },
  food: base.food.map((f) => (f.id === "f-2" ? { ...f, amount: 8, kcal: 373 } : f)),
};
const e = plan(edited);
eq("edits are sent again", e.send.map((s) => s.item), ["f:f-2", "w:a1"]);
eq("replacing the old versions", e.send.map((s) => s.replaces), [synced["f:f-2"], synced["w:a1"]]);
ok("under new names", e.send.every((s) => s.name !== synced[s.item]));

// Deleted in GymBuddy: taken back.
const del = plan({ ...base, synced, account: { ...base.account, sessions: base.account.sessions.filter((s) => s.id !== "a1") }, food: base.food.slice(0, 1) });
// The workout carried today's bodyweight, so that goes too.
eq("deleted items come out, with the workout's bodyweight", del.remove.map((r) => r.item).sort(), ["bw:2026-10-22", "f:f-2", "w:a1"]);
eq("nothing new sent", del.send.map((s) => s.item), []);

// Only what they allowed: a kind they didn't allow is neither sent nor taken back.
const some = plan({ ...base, synced: { "f:gone": "users/me/dataTypes/nutrition-log/dataPoints/gbf-x" }, granted: ["w"] });
eq("only workouts", some.send.map((s) => s.item), ["w:a1"]);
eq("food left alone", some.remove, []);

// Before connecting, and not yet happened.
const future = plan({ ...base, food: [{ ...base.food[0], id: "tomorrow", date: "2026-10-23" }], account: { ...base.account, weighins: [{ date: "2026-10-19", bw: 184 }] } });
ok("nothing from before connecting", !future.send.some((s) => s.item === "bw:2026-10-19" || s.item === "w:old"));
ok("nothing dated tomorrow", !future.send.some((s) => s.item === "f:tomorrow"));

// Odd workouts.
const odd = plan({ ...base, food: [], account: { program, weighins: [], sessions: [
  session("nostart", "2026-10-21", "2026-10-21T10:00:00Z", "2026-10-21T11:00:00Z", { startedAt: undefined }),
  session("days", "2026-10-21", "2026-10-18T10:00:00Z", "2026-10-21T12:00:00Z"),
  session("empty", "2026-10-21", "2026-10-21T10:00:00Z", "2026-10-21T11:00:00Z", { sets: {} }),
  session("cardio", "2026-10-21", "2026-10-21T13:00:00Z", "2026-10-21T13:30:00Z", { sets: { "Stair Climber": [{ min: 20 }] } }),
] } });
const byItem = Object.fromEntries(odd.send.map((s) => [s.item, s.body.exercise]));
eq("no start time: an hour", byItem["w:nostart"].activeDuration, "3600s");
eq("left open for days: 4 hours at most", byItem["w:days"].activeDuration, "14400s");
ok("an empty workout isn't sent", !byItem["w:empty"]);
eq("cardio only", byItem["w:cardio"].exerciseType, "CARDIO_WORKOUT");

// Secrets.
const sealed = sealToken("1//refresh-token");
ok("token is sealed", sealed.startsWith("v1.") && !sealed.includes("refresh"));
eq("and opens", openToken(sealed), "1//refresh-token");
let threw = false;
try { openToken(sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1)); } catch { threw = true; }
ok("a changed token doesn't open", threw);
const state = signState({ user: "11111111-2222-3333-4444-555555555555", since: "2026-10-22" });
eq("state reads back", readState(state), { user: "11111111-2222-3333-4444-555555555555", since: "2026-10-22" });
const [body, sig] = state.split(".");
const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url")), u: "someone-else" })).toString("base64url");
eq("a changed state is refused", readState(`${forged}.${sig}`), null);
eq("garbage is refused", readState("nope"), null);

// Requests: the old version of an edit goes first; already-there and already-gone count as done.
const calls = [];
globalThis.fetch = async (url, init) => {
  const b = JSON.parse(init.body);
  calls.push(url.endsWith(":batchDelete") ? `delete ${b.names.join(",")}` : `create ${b.name}`);
  const status = b.name === e.send[0].name ? 409 : url.endsWith(":batchDelete") && b.names[0] === synced["w:a1"] ? 404 : 200;
  return new Response("{}", { status });
};
const recorded = [];
const out = await carryOut("token", { send: e.send, remove: [{ item: "f:x", kind: "f", name: "users/me/dataTypes/nutrition-log/dataPoints/gbf-x" }] }, async (r) => recorded.push(r));
eq("request order", calls, [
  "delete users/me/dataTypes/nutrition-log/dataPoints/gbf-x",
  `delete ${synced["f:f-2"]}`, `create ${e.send[0].name}`,
  `delete ${synced["w:a1"]}`, `create ${e.send[1].name}`,
]);
eq("result", out, { sent: 2, removed: 1, more: false, error: null });
eq("recorded", recorded, [{ put: [], drop: ["f:x"] }, { put: [{ item: "f:f-2", name: e.send[0].name }], drop: [] }, { put: [{ item: "w:a1", name: e.send[1].name }], drop: [] }]);

// A failed send isn't recorded, so it goes again next time.
globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "bad" } }), { status: 400 });
const failedRec = [];
const bad = await carryOut("token", { send: first.send.slice(0, 1), remove: [] }, async (r) => failedRec.push(r));
eq("failure reported, nothing recorded", [bad.sent, bad.error, failedRec.length], [0, "bad", 0]);

// A failure inside the operation Google answers with counts as a failure; "already exists" in it is done.
globalThis.fetch = async (url, init) => new Response(JSON.stringify({ done: true, error: { code: JSON.parse(init.body).name === "n-exists" ? 6 : 3, message: "nope" } }), { status: 200 });
const opRec = [];
const op = await carryOut("token", { send: [{ item: "bw:a", kind: "bw", name: "n-bad", body: {} }, { item: "bw:b", kind: "bw", name: "n-exists", body: {} }], remove: [] }, async (r) => opRec.push(r));
eq("operation errors", [op.sent, op.error, opRec.map((r) => r.put[0].item)], [1, "nope", ["bw:b"]]);

// A long backlog goes in batches.
globalThis.fetch = async () => new Response("{}", { status: 200 });
const many = Array.from({ length: 5 }, (_, i) => ({ item: `bw:${i}`, kind: "bw", name: `n${i}`, body: {} }));
const part = await carryOut("token", { send: many, remove: [] }, async () => {}, { limit: 3 });
eq("batch of 3, more to come", [part.sent, part.more], [3, true]);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("google health: all passed");
