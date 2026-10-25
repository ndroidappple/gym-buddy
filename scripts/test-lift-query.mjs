/* Checks how the lift picker's box reads what's typed (src/lib/liftQuery.js): a lift's name, or what
   the lifter wants in words, understood as muscles, movement and gear, and the library ranked for it.
   Run: npm run test:coach   (exits 1 on any failure) */
const L = await import("../src/lib/liftQuery.js");
const { LIBRARY } = await import("../src/data/program.js");

let failed = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};
const ok = (name, cond, detail = "") => { if (!cond) { failed++; console.error(`✗ ${name}${detail ? `\n    ${detail}` : ""}`); } };
// As the picker reads it: anything that matches a lift's name is a search for it.
const kind = (s, o) => L.readLiftQuery(s, o ?? { known: LIBRARY.some((e) => L.liftMatch(e, s) >= 2) }).kind;
const top = (s, k = 6) => L.rankLifts(LIBRARY, L.readLiftQuery(s), k).map((x) => x.e.n);

// Names and plain words are searches.
for (const s of ["bench", "lat pulldown", "curl", "chest", "hip thrust"]) eq(`search: ${s}`, kind(s), "search");
eq("a name that reads like a request is still a name", kind("seated cable row close grip", { known: true }), "search");

// Requests in words.
for (const s of ["something for upper chest, no bench", "rows I can do at home", "back without a barbell", "bodyweight legs", "rear delts with cables", "triceps no machines"]) eq(`describe: ${s}`, kind(s), "describe");

// Understanding.
const r = L.readLiftQuery("something for upper chest, no bench");
eq("upper chest, no bench", [r.muscles, r.incline, r.bench, r.chips.map((c) => c.text)], [["chest"], true, false, ["no bench", "upper chest"]]);
const h = L.readLiftQuery("rows I can do at home");
eq("home rows", [h.pattern, h.want], ["horizontal pull", ["bodyweight", "dumbbell"]]);
eq("no equipment means bodyweight", L.readLiftQuery("chest with no equipment").want, ["bodyweight"]);

const joint = L.readLiftQuery("something for upper chest, no bench, easy on my shoulder");
eq("a joint to spare isn't a muscle to train", [joint.kind, joint.muscles, joint.chips.map((c) => c.text)], ["describe", ["chest"], ["easy on shoulder", "no bench", "upper chest"]]);
eq("a sore knee, legs", L.readLiftQuery("legs with a sore knee").muscles, ["quads", "hamstrings", "glutes"]);

// Ranking: nothing that breaks a constraint, the best fit first.
const upper = top("something for upper chest, no bench");
ok("upper chest, no bench: no bench lifts", upper.every((n) => !L.needsBench(n)), upper.join(", "));
ok("upper chest, no bench: all chest", upper.every((n) => ["Chest"].includes(LIBRARY.find((e) => e.n === n).g)), upper.join(", "));
const rows = top("rows I can do at home");
ok("home rows: a dumbbell or bodyweight row first", /Single-Arm DB Row|Row/.test(rows[0]) && !/T-Bar|Barbell|Machine|Cable/i.test(rows[0]), rows.join(", "));
const noBar = top("back without a barbell", 20);
ok("back without a barbell: no barbell", noBar.length > 0 && noBar.every((n) => !L.equipmentOf(n).includes("barbell")), noBar.join(", "));
const bw = top("bodyweight legs", 20);
ok("bodyweight legs: bodyweight only", bw.every((n) => L.equipmentOf(n).includes("bodyweight")), bw.join(", "));
const rear = top("rear delts with cables");
ok("rear delts with cables: a rear delt lift first", /face pull|reverse pec|rear delt|y-raise/i.test(rear[0]), rear.join(", "));
const home = top("biceps at home", 20);
ok("at home: no barbells, cables or machines", home.length > 0 && home.every((n) => L.equipmentOf(n).some((g) => g === "dumbbell" || g === "bodyweight")), home.join(", "));
const why = L.rankLifts(LIBRARY, L.readLiftQuery("something for upper chest, no bench"), 1)[0].why;
ok("each fit says why", why[0] === "Chest" && why.includes("no bench"), JSON.stringify(why));

// Gear and benches by name.
eq("gear", [L.equipmentOf("Lat Pulldown (Neutral Grip)"), L.equipmentOf("Push-Up"), L.equipmentOf("Incline DB Press")], [["cable"], ["bodyweight"], ["dumbbell"]]);
eq("benches", [L.needsBench("Incline DB Press"), L.needsBench("Cable Crossover")], [true, false]);
eq("names, forgivingly", [L.liftMatch({ n: "Lat Pulldown (Neutral Grip)", g: "Back" }, "pulldown") > 0, L.liftMatch({ n: "Romanian Deadlift", g: "Legs" }, "romanain") > 0], [true, true]);

if (failed) { console.error(`\n${failed} lift query check(s) failed`); process.exit(1); }
console.log("lift query: all checks passed");
