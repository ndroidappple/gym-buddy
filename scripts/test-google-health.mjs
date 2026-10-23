/* Checks for Google Health (api/_googleHealth.js, src/lib/heart.js): what gets sent, edited and
   taken back, the shapes Google expects, time zones, the sealed token and signed state, the order of
   requests (an edit's old version goes before the new one is sent), reading heart rate, and turning
   it into a workout's intensity.
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
const session = (id, date, start, end, extra = {}) => ({ id, day: "push", date, startedAt: at(start), finishedAt: at(end), sets: { "Bench Press": [{ w: 185, r: 8 }, { w: 185, r: 7 }] }, ...extra });
const base = {
  account: {
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

// First sync: everything from `since` to today. Workouts aren't sent (the lifter records them in Google Health).
const first = plan(base);
eq("items sent, oldest first", first.send.map((s) => s.item), ["bw:2026-10-21", "bw:2026-10-22", "f:f-1", "f:f-2"]);
eq("nothing to take back", first.remove, []);
ok("names are users/me/dataTypes/<type>/dataPoints/<4-63 of a-z 0-9 ->", first.send.every((s) => /^users\/me\/dataTypes\/(weight|nutrition-log)\/dataPoints\/[a-z0-9-]{4,63}$/.test(s.name)));
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

// An edit: the workout's bodyweight corrected, a food amount changed.
const edited = {
  ...base,
  synced,
  account: { ...base.account, sessions: base.account.sessions.map((s) => (s.id === "a1" ? { ...s, bw: 181.8 } : s)) },
  food: base.food.map((f) => (f.id === "f-2" ? { ...f, amount: 8, kcal: 373 } : f)),
};
const e = plan(edited);
eq("edits are sent again", e.send.map((s) => s.item), ["bw:2026-10-22", "f:f-2"]);
eq("replacing the old versions", e.send.map((s) => s.replaces), [synced["bw:2026-10-22"], synced["f:f-2"]]);
ok("under new names", e.send.every((s) => s.name !== synced[s.item]));

// Deleted in GymBuddy: taken back.
const del = plan({ ...base, synced, account: { ...base.account, sessions: base.account.sessions.filter((s) => s.id !== "a1") }, food: base.food.slice(0, 1) });
// The workout carried today's bodyweight, so that goes with it.
eq("deleted items come out, with the workout's bodyweight", del.remove.map((r) => r.item).sort(), ["bw:2026-10-22", "f:f-2"]);
eq("nothing new sent", del.send.map((s) => s.item), []);

// Only what they allowed: a kind they didn't allow is neither sent nor taken back. Workouts sent
// before (w:) are left alone.
const some = plan({ ...base, synced: { "f:gone": "users/me/dataTypes/nutrition-log/dataPoints/gbf-x", "w:a1": "users/me/dataTypes/exercise/dataPoints/gbw-x" }, granted: ["bw"] });
eq("only weight", some.send.map((s) => s.item), ["bw:2026-10-21", "bw:2026-10-22"]);
eq("food and old workouts left alone", some.remove, []);

// Before connecting, and not yet happened.
const future = plan({ ...base, food: [{ ...base.food[0], id: "tomorrow", date: "2026-10-23" }], account: { ...base.account, weighins: [{ date: "2026-10-19", bw: 184 }] } });
ok("nothing from before connecting", !future.send.some((s) => s.item === "bw:2026-10-19"));
ok("nothing dated tomorrow", !future.send.some((s) => s.item === "f:tomorrow"));

// Scopes: weight and food written, heart rate read; workouts never asked for.
eq("scopes asked for", gh.SCOPES.map((x) => x.split(".").slice(-2).join(".")), ["health_metrics_and_measurements.writeonly", "nutrition.writeonly", "health_metrics_and_measurements.readonly", "sleep.readonly"]);
ok("sleep is its own permission", gh.canReadSleep(gh.SLEEP_SCOPE) && !gh.canReadSleep(gh.HEART_SCOPE) && !gh.canReadHeart(gh.SLEEP_SCOPE));
eq("granted kinds", gh.grantedKinds(gh.SCOPES.join(" ")), ["bw", "f"]);
ok("heart rate allowed", gh.canReadHeart(gh.SCOPES.join(" ")) && !gh.canReadHeart(gh.SCOPES.slice(0, 2).join(" ")));

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
  const status = b.name === e.send[0].name ? 409 : url.endsWith(":batchDelete") && b.names[0] === synced["f:f-2"] ? 404 : 200;
  return new Response("{}", { status });
};
const recorded = [];
const out = await carryOut("token", { send: e.send, remove: [{ item: "f:x", kind: "f", name: "users/me/dataTypes/nutrition-log/dataPoints/gbf-x" }] }, async (r) => recorded.push(r));
eq("request order", calls, [
  "delete users/me/dataTypes/nutrition-log/dataPoints/gbf-x",
  `delete ${synced["bw:2026-10-22"]}`, `create ${e.send[0].name}`,
  `delete ${synced["f:f-2"]}`, `create ${e.send[1].name}`,
]);
eq("result", out, { sent: 2, removed: 1, more: false, error: null });
eq("recorded", recorded, [{ put: [], drop: ["f:x"] }, { put: [{ item: "bw:2026-10-22", name: e.send[0].name }], drop: [] }, { put: [{ item: "f:f-2", name: e.send[1].name }], drop: [] }]);

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

// Reading heart rate: the filter Google wants, pages followed, readings oldest first.
const asked = [];
globalThis.fetch = async (url) => {
  const u = new URL(url);
  asked.push([u.pathname, u.searchParams.get("filter"), u.searchParams.get("pageToken")]);
  const page = u.searchParams.get("pageToken") ? 2 : 1;
  const pts = page === 1
    ? [{ heartRate: { sampleTime: { physicalTime: "2026-10-22T10:00:10Z" }, beatsPerMinute: "121" } }, { heartRate: { sampleTime: { physicalTime: "2026-10-22T10:00:05Z" }, beatsPerMinute: "118" } }]
    : [{ heartRate: { sampleTime: { physicalTime: "2026-10-22T10:00:00Z" }, beatsPerMinute: "115" } }];
  return new Response(JSON.stringify({ dataPoints: pts, ...(page === 1 ? { nextPageToken: "p2" } : {}) }), { status: 200 });
};
const hr = await gh.heartRate("token", at("2026-10-22T10:00:00Z"), at("2026-10-22T11:00:00Z"));
eq("heart rate readings", hr, { ok: true, readings: [[at("2026-10-22T10:00:00Z"), 115], [at("2026-10-22T10:00:05Z"), 118], [at("2026-10-22T10:00:10Z"), 121]] });
eq("heart rate request", asked[0], ["/v4/users/me/dataTypes/heart-rate/dataPoints", 'heart_rate.sample_time.physical_time >= "2026-10-22T10:00:00.000Z" AND heart_rate.sample_time.physical_time < "2026-10-22T11:00:00.000Z"', null]);
eq("second page", asked[1][2], "p2");
globalThis.fetch = async () => new Response(JSON.stringify({ dataPoints: Array.from({ length: 4000 }, (_, i) => ({ heartRate: { sampleTime: { physicalTime: new Date(at("2026-10-22T10:00:00Z") + i * 1000).toISOString() }, beatsPerMinute: String(100 + (i % 5)) } })) }), { status: 200 });
const dense = await gh.heartRate("token", at("2026-10-22T10:00:00Z"), at("2026-10-22T12:00:00Z"));
eq("a reading a second becomes one per 5 s", [dense.readings.length, dense.readings[0]], [800, [at("2026-10-22T10:00:00Z"), 102]]);
globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Request had insufficient authentication scopes." } }), { status: 403 });
eq("not allowed", await gh.heartRate("token", 0, 1), { ok: false, status: 403, message: "Request had insufficient authentication scopes." });

// Intensity (src/lib/heart.js).
const H = await import("../src/lib/heart.js");
eq("max heart rate from age", [H.maxHrFor(30), H.maxHrFor(null), H.maxHrFor(8)], [187, null, null]);
eq("zones estimated from max", H.estimatedBounds(187), [94, 120, 144, 168]);
const B = [78, 117, 143, 175]; // Google's: light, moderate, vigorous, peak start here
eq("zone of a bpm", [70, 78, 120, 150, 180].map((b) => H.zoneOf(b, B)), [-1, 0, 1, 2, 3]);
const T0 = at("2026-10-22T10:00:00Z");
const workout = {
  id: "hw", startedAt: T0, finishedAt: T0 + 20 * 60_000,
  sets: {
    "Bench Press": [{ w: 185, r: 8, t: T0 + 5 * 60_000 }, { w: 185, r: 7, t: T0 + 10 * 60_000 }, { w: 185, r: 6 }],
    "Stair Climber": [{ min: 5, t: T0 + 18 * 60_000 }],
    Dips: [{ w: 0, r: 12 }],
  },
};
// A reading every 5 s: 110 resting, 160 around each bench set (from 30 s before the tap to 20 s after),
// and 100 in the two minutes after the first set.
const readings = [];
for (let t = T0 - 60_000; t <= T0 + 21 * 60_000; t += 5000) {
  const nearSet = workout.sets["Bench Press"].some((x) => x.t && t >= x.t - 30_000 && t <= x.t + 20_000);
  readings.push([t, nearSet ? 160 : t > T0 + 5.5 * 60_000 && t < T0 + 7.5 * 60_000 ? 100 : 110]);
}
const res = H.summarize(readings, workout, { bounds: B, source: "google" });
eq("peak and low", [res.summary.max, res.summary.low], [160, 100]);
ok("average between", res.summary.avg > 100 && res.summary.avg < 125);
eq("zones in minutes: 160 is vigorous, the rest moderate-or-below", [res.summary.zones.vigorous, res.summary.zones.peak], [1.8, 0]);
eq("hard = vigorous + peak", res.summary.hard, 1.8);
eq("bounds and source kept", [res.summary.bounds, res.summary.source, res.summary.v], [B, "google", 2]);
eq("complete", res.summary.complete, true);
eq("sets: peak, and how far it came down before the next set; cardio and untimed sets have none", res.sets, {
  "Bench Press": [{ hr: 160, hrRest: 100 }, { hr: 160, hrRest: 110 }, null],
});
const saved = H.withHeart(workout, res, 123);
eq("peaks go on the sets", saved.sets["Bench Press"].map((x) => [x.hr, x.hrRest]), [[160, 100], [160, 110], [undefined, undefined]]);
eq("summary on the workout", [saved.hr.avg, saved.hr.at, saved.sets.Dips], [res.summary.avg, 123, [{ w: 0, r: 12 }]]);
eq("no zones: no zone minutes", "zones" in H.summarize(readings, workout).summary, false);
eq("readings stop early: not complete", H.summarize(readings.filter(([t]) => t < T0 + 10 * 60_000), workout).summary.complete, false);
eq("nothing during the workout", H.summarize([[T0 - 3600_000, 90]], workout), null);
eq("no readings: marked none", H.withHeart(workout, null, 5).hr, { v: 2, none: true, at: 5 });
ok("coach line", /heart rate avg \d+, peak 160 \(vigorous zone; zones from Google Health: moderate 117\+, vigorous 143\+, peak 175\+\), minutes light\/moderate\/vigorous\/peak [\d.]+\/[\d.]+\/1\.8\/0/.test(H.heartLine(saved)));
eq("hardest lift needs two lifts with peaks", H.hardestLift(saved), null);
eq("hardest lift", H.hardestLift({ sets: { A: [{ hr: 150 }, { hr: 160 }], B: [{ hr: 170 }] } }), { lift: "B", avg: 170 });
eq("thinned to one per 5 s", H.thin([[0, 100], [1000, 110], [6000, 120]]), [[0, 105], [5000, 120]]);

// Google's zones for a day: the latest record on or before it, minimums in zone order.
globalThis.fetch = async (url) => {
  asked.push(new URL(url).searchParams.get("filter"));
  const zone = (type, min, max) => ({ heartRateZoneType: type, minBeatsPerMinute: String(min), maxBeatsPerMinute: String(max) });
  return new Response(JSON.stringify({ dataPoints: [
    { dailyHeartRateZones: { date: { year: 2026, month: 10, day: 21 }, heartRateZones: [zone("PEAK", 175, 220), zone("LIGHT", 78, 116), zone("VIGOROUS", 143, 174), zone("MODERATE", 117, 142)] } },
    { dailyHeartRateZones: { date: { year: 2026, month: 10, day: 23 }, heartRateZones: [zone("LIGHT", 1, 2), zone("MODERATE", 3, 4), zone("VIGOROUS", 5, 6), zone("PEAK", 7, 8)] } },
  ] }), { status: 200 });
};
eq("zones for a day", await gh.heartZones("token", "2026-10-22"), [78, 117, 143, 175]);
eq("zones filter", asked[asked.length - 1], 'daily_heart_rate_zones.date >= "2026-10-08" AND daily_heart_rate_zones.date < "2026-10-23"');
globalThis.fetch = async () => new Response(JSON.stringify({ dataPoints: [] }), { status: 200 });
eq("no zones", await gh.heartZones("token", "2026-10-22"), null);

// Disconnecting: heart rate off, set times kept.
eq("has heart", [H.hasHeart(saved), H.hasHeart(workout)], [true, false]);
const gone = H.withoutHeart(saved);
eq("without heart", [gone.hr, gone.sets["Bench Press"].map((x) => [x.hr, x.hrRest, x.t])], [undefined, workout.sets["Bench Press"].map((x) => [undefined, undefined, x.t])]);
eq("nothing to take off: the same workout", H.withoutHeart(workout) === workout, true);
eq("reconnecting works it out again", H.summarize(readings, gone, { bounds: B }).sets["Bench Press"][0].hr, 160);

// Which workouts to ask about.
const N = T0 + 30 * 3600_000;
const w8 = (id, endAgoMin, hr) => ({ id, startedAt: N - endAgoMin * 60_000 - 3600_000, finishedAt: N - endAgoMin * 60_000, ...(hr ? { hr } : {}) });
const list = [
  w8("new", 30), w8("justnow", 1), w8("done", 60, { complete: true, at: N - 50 * 60_000 }),
  w8("partial-recent", 60, { complete: false, at: N - 5 * 60_000 }), w8("partial-due", 60, { complete: false, at: N - 20 * 60_000 }),
  w8("none-old", 3 * 24 * 60, { none: true, at: N - 24 * 3600_000 }), w8("ancient", 40 * 24 * 60),
  w8("v1", 2 * 24 * 60, { complete: true, at: N - 47 * 3600_000 }),
].map((s) => (s.hr && s.id !== "v1" ? { ...s, hr: { ...s.hr, v: 2 } } : s));
eq("wanting (a summary from before the zones update is asked again)", H.wanting(list, N).map((s) => s.id), ["new", "partial-due", "v1"]);

/* ── sleep and recovery ── */
const R = await import("../src/lib/recovery.js");
const sleepPoint = (end, { asleep = 420, nap = false, main = true, stages = true } = {}) => ({ sleep: {
  interval: { startTime: new Date(Date.parse(end) - 8 * 3600_000).toISOString(), endTime: end, civilEndTime: { date: { year: +end.slice(0, 4), month: +end.slice(5, 7), day: +end.slice(8, 10) } } },
  type: stages ? "STAGES" : "CLASSIC", metadata: { nap, mainSleep: main },
  summary: { minutesAsleep: String(asleep), minutesInSleepPeriod: String(asleep + 30), minutesAwake: "30", stagesSummary: [{ type: "DEEP", minutes: "70" }, { type: "REM", minutes: "95" }, { type: "LIGHT", minutes: String(asleep - 165) }] },
} });
eq("a night as kept", gh.nightOf(sleepPoint("2026-10-22T13:00:00Z")), { date: "2026-10-22", start: at("2026-10-22T05:00:00Z"), end: at("2026-10-22T13:00:00Z"), asleep: 420, inBed: 450, awake: 30, deep: 70, rem: 95, light: 255, main: true });
eq("no stages on a classic night", gh.nightOf(sleepPoint("2026-10-22T13:00:00Z", { stages: false })).deep, undefined);
eq("nothing asleep isn't a night", gh.nightOf(sleepPoint("2026-10-22T13:00:00Z", { asleep: 0 })), null);
let urls = [];
globalThis.fetch = async (url) => {
  urls.push(decodeURIComponent(String(url).replace(/\+/g, " ")));
  if (String(url).includes("/sleep/")) return new Response(JSON.stringify({ dataPoints: [sleepPoint("2026-10-22T13:00:00Z"), sleepPoint("2026-10-22T21:00:00Z", { asleep: 40, nap: true, main: false })] }), { status: 200 });
  if (String(url).includes("daily-resting")) return new Response(JSON.stringify({ dataPoints: [{ dailyRestingHeartRate: { date: { year: 2026, month: 10, day: 22 }, beatsPerMinute: "56" } }] }), { status: 200 });
  return new Response(JSON.stringify({ dataPoints: [{ dailyHeartRateVariability: { date: { year: 2026, month: 10, day: 22 }, averageHeartRateVariabilityMilliseconds: 47.25 } }] }), { status: 200 });
};
const sn = await gh.sleepNights("token", "2026-10-20", "2026-10-22");
eq("sleep: both sessions, by civil end date", [sn.ok, sn.nights.length, sn.nights[1].nap], [true, 2, true]);
ok("sleep filter on the civil end date, through the end day", urls[0].includes('sleep.interval.civil_end_time >= "2026-10-20" AND sleep.interval.civil_end_time < "2026-10-23"'), urls[0]);
eq("resting heart rate by day", await gh.dailyValues("token", "daily-resting-heart-rate", "2026-10-20", "2026-10-22"), { "2026-10-22": 56 });
eq("HRV by day", await gh.dailyValues("token", "daily-heart-rate-variability", "2026-10-20", "2026-10-22"), { "2026-10-22": 47.3 });
urls = [];
globalThis.fetch = async (url) => { urls.push(decodeURIComponent(String(url).replace(/\+/g, " "))); return urls.length === 1 ? new Response("{}", { status: 400 }) : new Response(JSON.stringify({ dataPoints: [] }), { status: 200 }); };
await gh.dailyValues("token", "daily-heart-rate-variability", "2026-10-20", "2026-10-22");
ok("daily filter tried both spellings", urls[0].includes("daily_heart_rate_variability.date") && urls[1].includes("dailyHeartRateVariability.date"), urls.join(" | "));

// Kept per morning: the main night (not a nap), resting heart rate and HRV; old mornings drop off.
let rec = R.mergeRecovery({ "2026-05-01": { rhr: 60 } }, { nights: sn.nights, rhr: { "2026-10-22": 56 }, hrv: { "2026-10-22": 47.3 } }, "2026-10-22");
eq("a morning kept", rec["2026-10-22"], { sleep: { start: at("2026-10-22T05:00:00Z"), end: at("2026-10-22T13:00:00Z"), asleep: 420, inBed: 450, awake: 30, deep: 70, rem: 95, light: 255 }, rhr: 56, hrv: 47.3 });
ok("older than 120 days dropped", !rec["2026-05-01"]);
rec = R.mergeRecovery(rec, { rhr: { "2026-10-22": 57 } }, "2026-10-22");
eq("a later fetch without sleep keeps the night", [rec["2026-10-22"].sleep.asleep, rec["2026-10-22"].rhr], [420, 57]);

// Judged against their own usual.
const month = {};
for (let i = 1; i <= 20; i++) { const d = new Date(Date.parse("2026-10-22T12:00:00Z") - i * 86400_000).toISOString().slice(0, 10); month[d] = { sleep: { asleep: 440 + (i % 3) * 10 }, rhr: 55, hrv: 50 }; }
eq("usual", R.usual(month, "2026-10-22"), { asleep: 450, rhr: 55, hrv: 50 });
const on = (e) => R.readiness({ ...month, "2026-10-22": e }, "2026-10-22");
eq("an ordinary night", [on({ sleep: { asleep: 430 }, rhr: 56, hrv: 48 }).low, R.lowLine(on({ sleep: { asleep: 430 } }))], [false, null]);
eq("short for them", [on({ sleep: { asleep: 360 } }).short, R.lowLine(on({ sleep: { asleep: 360 } }))], [true, "Short night (6h00, usually 7h30)."]);
eq("under 5 hours is short whatever the usual", R.readiness({ "2026-10-22": { sleep: { asleep: 290 } } }, "2026-10-22").short, true);
eq("resting heart rate up alone isn't low", on({ sleep: { asleep: 450 }, rhr: 62, hrv: 49 }).low, false);
eq("resting heart rate up and HRV down together is", [on({ sleep: { asleep: 450 }, rhr: 61, hrv: 38 }).strained, on({ sleep: { asleep: 450 }, rhr: 61, hrv: 38 }).low], [true, true]);
ok("no usual until 5 nights", R.usual({ "2026-10-20": { sleep: { asleep: 400 } } }, "2026-10-22").asleep === null);
eq("nothing that morning", R.readiness(month, "2026-10-23"), null);
ok("coach line", R.nightLine({ ...month, "2026-10-22": { sleep: { asleep: 360, deep: 50, rem: 80, awake: 25 }, rhr: 57, hrv: 46 } }, "2026-10-22")
  === "slept 6h00 (their usual 7h30), 50 min deep, 1h20 REM, awake 25 min; resting heart rate 57 (usual 55); HRV 46 ms (usual 50). A short night for them.");
eq("head coach lines: mornings with data only, newest first", R.recoveryLines(month, "2026-10-22", 3).map((l) => l.slice(2, 12)), ["2026-10-21", "2026-10-20"]);

// The week, and lifting after short nights vs the rest.
const wk = R.weekSleep({ ...month, "2026-10-19": { sleep: { asleep: 300 } } }, "2026-10-16", "2026-10-22");
eq("week sleep", [wk.nights, wk.short, wk.usualAsleep != null], [6, 1, true]);
eq("no nights, no week", R.weekSleep({}, "2026-10-16", "2026-10-22"), null);
const ses = [], recP = {};
for (let i = 0; i < 16; i++) {
  const d = new Date(Date.parse("2026-09-01T12:00:00Z") + i * 2 * 86400_000).toISOString().slice(0, 10);
  const short = i >= 4 && i % 3 === 0;
  recP[d] = { sleep: { asleep: short ? 280 : 450 } };
  ses.push({ id: `p${i}`, date: d, sets: { Bench: [{ w: short ? 95 : 100 + i, r: 8 }] } });
}
const pat = R.sleepPattern(ses, recP);
ok("pattern: lifts lower after short nights", pat && pat.short.n >= 3 && pat.rest.n >= 3 && pat.diff > 0, JSON.stringify(pat));
eq("pattern needs 3 of each", R.sleepPattern(ses.slice(0, 6), recP), null);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("google health: all passed");
