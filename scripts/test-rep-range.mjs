/* Checks for the rep-range sanity check (src/lib/repRange.js): which kind each lift is, that every
   range the app ships with passes, and that ranges clearly off for a lift are flagged.
   Run: npm run test:range   (exits 1 on any failure) */
import { liftKind, checkRange } from "../src/lib/repRange.js";
import { LIBRARY, PROGRAM } from "../src/data/program.js";

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

// Kinds.
const KINDS = {
  heavy: ["Deadlift", "Back Squat", "Front Squat", "Flat Barbell Bench Press", "Overhead Press (Barbell)", "Barbell Row", "Close-Grip Bench Press"],
  compound: ["Romanian Deadlift", "Leg Press (Heavy)", "Lat Pulldown (Wide Grip)", "Pull-Up", "Push-Up", "Step-Up", "Bulgarian Split Squat", "Hack Squat", "Goblet Squat", "Seated DB Shoulder Press", "Incline Barbell / Smith Press", "Hip Thrust", "Upright Row (Cable)"],
  isolation: ["Seated DB Curl", "Skull Crushers", "Leg Extension", "Leg Curl", "Machine Pec Dec", "Straight-Arm Pulldown", "Shrugs", "Single-Arm Cable Crossover"],
  light: ["Face Pulls", "Lateral Raise (Cable)", "Rear Delt Fly", "Reverse Pec Dec", "Standing Calf Raise", "Leg Adduction", "Wrist Curl"],
  core: ["Cable Crunch", "Hanging Leg Raise", "Ab Wheel Rollout"],
};
for (const [kind, names] of Object.entries(KINDS)) for (const n of names) eq(`${n} is ${kind}`, liftKind(n), kind);
eq("cardio has no kind", liftKind("Stair Climber"), null);
eq("a cardio warm-up has no kind", liftKind("Stair Climber (Warm-up)"), null);
eq("a timed hold has no kind", liftKind("Plank"), null);

// Everything the app ships with passes: the library, the default program, and this lifter's
// program as of Oct 2026 (the sanity check that started this).
const shipped = [...LIBRARY, ...Object.values(PROGRAM).flatMap((d) => d.exercises)];
for (const e of shipped) eq(`${e.n} ${e.reps.join("–")} passes`, checkRange(e), null);
const MINE = [
  ["Incline Barbell / Smith Press", 6, 10], ["Flat DB Press", 8, 12], ["Machine Pec Dec", 10, 15], ["Single-Arm Cable Crossover", 12, 15],
  ["Tricep Pushdown (Rope)", 10, 15], ["Overhead Tricep Extension", 10, 15], ["Lat Pulldown (Wide Grip)", 8, 12], ["Seated Cable Row (Close Grip)", 8, 12],
  ["Seated Row (Machine)", 10, 12], ["Straight-Arm Pulldown", 12, 15], ["Face Pulls", 15, 20], ["Seated DB Curl", 10, 12], ["Hammer Curl", 10, 12],
  ["Leg Press (Heavy)", 8, 12], ["Romanian Deadlift", 10, 12], ["Bulgarian Split Squat", 8, 10], ["Leg Extension", 12, 15], ["Leg Curl", 12, 15],
  ["Leg Adduction", 15, 20], ["Seated DB Shoulder Press", 8, 12], ["Lateral Raise (Cable)", 12, 20], ["Rear Delt Fly", 15, 20],
  ["Upright Row (Cable)", 12, 15], ["Incline DB Curl", 10, 12], ["Skull Crushers", 10, 12],
];
for (const [n, lo, hi] of MINE) eq(`mine: ${n} ${lo}–${hi} passes`, checkRange({ n, reps: [lo, hi] }), null);

// Reasonable personal choices aren't flagged.
for (const [n, lo, hi] of [["Lat Pulldown (Wide Grip)", 6, 8], ["Face Pulls", 10, 12], ["Seated DB Curl", 6, 8], ["Deadlift", 1, 3], ["Leg Press (Heavy)", 15, 20], ["Lateral Raise (Cable)", 20, 30], ["Push-Up", 15, 25]]) {
  eq(`${n} ${lo}–${hi} is fine`, checkRange({ n, reps: [lo, hi] }), null);
}

// Clearly off: flagged, with the suggestion.
const flag = (n, lo, hi) => { const c = checkRange({ n, reps: [lo, hi] }); return c && [c.dir, c.suggest]; };
eq("Face Pulls 4–6", flag("Face Pulls", 4, 6), ["low", [15, 20]]);
eq("Lateral Raise 5–8", flag("Lateral Raise (Cable)", 5, 8), ["low", [12, 20]]);
eq("Leg Extension 3–5", flag("Leg Extension", 3, 5), ["low", [12, 15]]);
eq("unknown curl 2–4 gets the isolation default", flag("Spider Curl", 2, 4), ["low", [10, 15]]);
eq("Deadlift 20–25", flag("Deadlift", 20, 25), ["high", [4, 6]]);
eq("Barbell Curl 25–30", flag("Barbell Curl", 25, 30), ["high", [8, 12]]);
eq("Lat Pulldown 1–2", flag("Lat Pulldown (Wide Grip)", 1, 2), ["low", [8, 12]]);
eq("the line reads", checkRange({ n: "Face Pulls", reps: [4, 6] }).line,
  "4–6 is low for Face Pulls: as a small-muscle lift it usually goes 15–20, because heavy sets on a small muscle turn into a swing or shrug and strain the joint.");
eq("an before a vowel", /as an isolation lift/.test(checkRange({ n: "Barbell Curl", reps: [25, 30] }).line), true);

// Not judged.
eq("warm-up", checkRange({ n: "Stair Climber (Warm-up)", reps: [5, 5], warmup: true }), null);
eq("cardio minutes", checkRange({ n: "Stair Climber", reps: [40, 60] }), null);
eq("bad range", checkRange({ n: "Face Pulls", reps: [6, 4] }), null);

console.log(failed ? `rep range: ${failed} failed` : "rep range: all checks passed");
process.exit(failed ? 1 : 0);
