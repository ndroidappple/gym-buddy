/* Checks nutrition over time (src/lib/nutritionTrends.js), behind Progress → Nutrition: targets kept
   per date, which days count, the period's averages against targets, weeks, patterns, the weight trend
   and the burn it implies, and the biggest calorie sources.
   Run: npm run test:nutrition   (exits 1 on any failure) */
const N = await import("../src/lib/nutritionTrends.js");
const { addDays } = await import("../src/lib/nutrition.js");

let failed = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

// Targets kept per date: a save adds them from that day on; an unchanged save adds nothing.
const T1 = { kcal: 2300, protein: 160, carbs: 270, fat: 65, burn: 2650, rate: -0.7 };
const T2 = { kcal: 2500, protein: 160, carbs: 320, fat: 65, burn: 2650, rate: -0.3 };
let n = N.withTargetHistory(null, { goal: "lose", targets: T1 }, "2026-10-01");
n = N.withTargetHistory(n, { ...n, targets: T1 }, "2026-10-05");
eq("same targets saved again: no new entry", n.history.length, 1);
n = N.withTargetHistory(n, { ...n, targets: T2 }, "2026-10-10");
eq("targets in force on a date", [N.targetsOn(n, "2026-10-09").kcal, N.targetsOn(n, "2026-10-10").kcal, N.targetsOn(n, "2026-09-20").kcal], [2300, 2500, 2300]);
eq("no history: the current targets", N.targetsOn({ targets: T1 }, "2026-10-01").kcal, 2300);
eq("days before the history are flagged", [N.targetsBackfilled(n, "2026-09-28"), N.targetsBackfilled(n, "2026-10-02")], [true, false]);
eq("which side works against the goal", [N.wrongSide(n, T1), N.wrongSide(n, { ...T1, rate: 0.5 }), N.wrongSide(n, { ...T1, rate: 0 })], ["over", "under", "both"]);

// A fortnight: on target, over, under, a partly logged day and an empty one.
const n1 = { goal: "lose", targets: T1 };
const day = (date, kcal, protein, name = "Meal") => ({ date, name, kcal, protein, carbs: 0, fat: 0 });
const entries = [
  day("2026-10-04", 2300, 165), day("2026-10-05", 2600, 150), day("2026-10-06", 2000, 170),
  day("2026-10-07", 900, 60), /* 10-08 nothing */ day("2026-10-09", 2400, 140), day("2026-10-10", 3100, 120, "Pizza"),
  day("2026-10-11", 2900, 130, "Pizza"), day("2026-10-12", 2300, 160), day("2026-10-13", 2250, 175),
];
const rows = N.dailyRows(entries, n1, "2026-10-04", "2026-10-13");
eq("statuses", rows.map((r) => r.kcalStatus), ["on", "over", "under", null, null, "on", "over", "over", "on", "on"]);
eq("partial and empty days don't count", [rows[3].partial, rows[3].full, rows[4].logged], [true, false, false]);
const s = N.summarize(rows);
eq("period summary", [s.logged, s.full, s.partial, s.kcal, s.targetKcal, s.kcalDiff, s.kcalOn, s.kcalOver, s.kcalUnder, s.proteinHit],
  [9, 8, 1, 2481, 2300, 181, 4, 3, 1, 5]);
eq("weeks, newest first", N.weekRows(rows).map((w) => [w.start, w.logged, w.kcal]), [["2026-10-11", 3, 2483], ["2026-10-04", 6, 2480]]);

// Patterns: Oct 10/11 are Sat/Sun (weekend); training on three of the days.
const p = N.patterns(rows, [{ date: "2026-10-05" }, { date: "2026-10-09" }, { date: "2026-10-13" }]);
eq("weekends and training days, each against the rest", p.map((x) => [x.id, x.aKcal, x.bKcal, x.diff]), [["weekend", 2767, 2310, 457], ["training", 2417, 2520, -103]]);
eq("too few days on a side: nothing said", N.patterns(rows.slice(0, 3)), []);

// Is it working: weights flat while eating ~180 over a 2,300 target → the burn is about what's eaten.
const bw = [{ date: "2026-10-04", bw: 181 }, { date: "2026-10-08", bw: 181.2 }, { date: "2026-10-11", bw: 180.8 }, { date: "2026-10-14", bw: 181 }];
const long = N.dailyRows([...entries, day("2026-10-14", 2400, 160), day("2026-10-15", 2500, 160)], n1, "2026-10-04", "2026-10-15");
const o = N.outcome(long, bw, n1);
eq("weight trend, the burn it implies, and what the goal's pace needs", [o.rate, o.goalRate, o.weights, o.burn, o.needs, o.impliedRate], [-0.1, -0.7, 4, 2510, 2160, null]);
eq("too few weights: no trend, the setup's estimate stands in", [N.outcome(rows, bw.slice(0, 2), n1).rate, N.outcome(rows, bw.slice(0, 2), n1).impliedRate], [null, -0.3]);

// The biggest sources.
eq("top foods", N.topFoods(entries, rows, 2).map((f) => [f.name, f.times, f.perDay]), [["Meal", 7, 1639], ["Pizza", 2, 667]]);

// The period: ends yesterday, starts no earlier than the first logged day.
eq("period range", N.periodRange(entries, 28, "2026-10-20"), { from: "2026-10-04", to: "2026-10-20" });
eq("period range, long history", N.periodRange([day("2026-08-01", 1, 1)], 14, "2026-10-20"), { from: addDays("2026-10-20", -13), to: "2026-10-20" });

if (failed) { console.error(`\n${failed} nutrition trend check(s) failed`); process.exit(1); }
console.log("nutrition trends: all checks passed");
