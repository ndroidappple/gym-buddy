/* Checks for the rep-range sanity check (src/lib/repRange.js): which kind each lift is, that every
   range the app ships with passes, and that ranges clearly off for a lift are flagged.
   Run: npm run test:range   (exits 1 on any failure) */
import { liftKind, checkRange } from "../src/lib/repRange.js";
import { LIBRARY, PROGRAM, normalizeProgram, warmupOf } from "../src/data/program.js";
import { applyChanges } from "../src/lib/programChange.js";
import { parseProgram } from "../src/lib/importProgram.js";
import { planFor } from "../src/lib/setup.js";

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
// Tops over 16 reps (MAX_TOP) are flagged with a one-tap fix; the rest of this program passes.
const OVER = { "Face Pulls": [10, 16], "Leg Adduction": [10, 16], "Lateral Raise (Cable)": [10, 16], "Rear Delt Fly": [10, 16] };
for (const [n, lo, hi] of MINE) {
  const c = checkRange({ n, reps: [lo, hi] });
  eq(`mine: ${n} ${lo}–${hi}`, c && [c.dir, c.suggest], OVER[n] ? ["high", OVER[n]] : null);
}
for (const e of shipped) if (!/plank/i.test(e.n) && !e.kind) eq(`${e.n} tops out at 16 or under`, e.reps[1] <= 16, true);

// Reasonable personal choices aren't flagged.
for (const [n, lo, hi] of [["Lat Pulldown (Wide Grip)", 6, 8], ["Face Pulls", 10, 12], ["Seated DB Curl", 6, 8], ["Deadlift", 1, 3], ["Leg Press (Heavy)", 12, 16], ["Lateral Raise (Cable)", 12, 16], ["Push-Up", 12, 16], ["Leg Extension", 12, 16]]) {
  eq(`${n} ${lo}–${hi} is fine`, checkRange({ n, reps: [lo, hi] }), null);
}

// Clearly off: flagged, with the suggestion.
const flag = (n, lo, hi) => { const c = checkRange({ n, reps: [lo, hi] }); return c && [c.dir, c.suggest]; };
eq("Face Pulls 4–6", flag("Face Pulls", 4, 6), ["low", [10, 16]]);
eq("Lateral Raise 5–7", flag("Lateral Raise (Cable)", 5, 7), ["low", [10, 16]]);
eq("Lateral Raise 12–20: over 16", flag("Lateral Raise (Cable)", 12, 20), ["high", [10, 16]]);
eq("Leg Press 15–20: over 16", flag("Leg Press (Heavy)", 15, 20), ["high", [8, 12]]);
eq("Push-Up 15–25: over 16", flag("Push-Up", 15, 25), ["high", [10, 16]]);
eq("Calf Raise 12–17: over 16", flag("Standing Calf Raise", 12, 17), ["high", [10, 16]]);
eq("Leg Extension 3–5", flag("Leg Extension", 3, 5), ["low", [12, 15]]);
eq("unknown curl 2–4 gets the isolation default", flag("Spider Curl", 2, 4), ["low", [10, 15]]);
eq("Deadlift 20–25", flag("Deadlift", 20, 25), ["high", [4, 6]]);
eq("Barbell Curl 25–30", flag("Barbell Curl", 25, 30), ["high", [8, 12]]);
eq("Lat Pulldown 1–2", flag("Lat Pulldown (Wide Grip)", 1, 2), ["low", [8, 12]]);
eq("the line reads", checkRange({ n: "Face Pulls", reps: [4, 6] }).line,
  "4–6 is low for Face Pulls: as a small-muscle lift it usually goes 10–16, because heavy sets on a small muscle turn into a swing or shrug and strain the joint.");
eq("an before a vowel", /as an isolation lift/.test(checkRange({ n: "Barbell Curl", reps: [25, 30] }).line), true);

// Not judged.
eq("warm-up", checkRange({ n: "Stair Climber (Warm-up)", reps: [5, 5], warmup: true }), null);
eq("cardio minutes", checkRange({ n: "Stair Climber", reps: [40, 60] }), null);
eq("bad range", checkRange({ n: "Face Pulls", reps: [6, 4] }), null);

// Setup styles (src/lib/setup.js): lean keeps every lift at its standard range and rest (heavy work keeps
// muscle on a cut) and adds the finisher; no style ever turns a range upside down or restyles a timed hold.
const withPlank = { ...PROGRAM, push: { ...PROGRAM.push, exercises: [...PROGRAM.push.exercises, LIBRARY.find((e) => e.n === "Plank")] } };
for (const goals of [["lean"], ["strength"], ["muscle"]]) {
  const { program } = planFor(withPlank, { goals });
  const lifts = Object.values(program).flatMap((d) => d.exercises || []);
  for (const e of lifts) if (!(e.reps[0] <= e.reps[1])) eq(`${goals}: ${e.n} range in order`, e.reps, "lo <= hi");
  eq(`${goals}: plank untouched`, lifts.find((e) => e.n === "Plank").reps, [30, 60]);
}
const lean = planFor(withPlank, { goals: ["lean"] }).program;
eq("lean keeps the push day's ranges and rests", lean.push.exercises.filter((e) => !e.finisher).map((e) => [e.reps, e.rest]), withPlank.push.exercises.map((e) => [e.reps, e.rest]));
eq("lean adds the finisher", lean.push.exercises.some((e) => e.finisher), true);
// Redoing setup as lean after an older lean program (more reps, less rest) puts the lifts back.
const oldLean = { ...PROGRAM, push: { ...PROGRAM.push, exercises: PROGRAM.push.exercises.map((e) => ({ ...e, base: { reps: e.reps, rest: e.rest }, reps: [e.reps[0] + 2, e.reps[1] + 3], rest: e.rest - 15 })) } };
eq("old lean program goes back to standard", planFor(oldLean, { goals: ["lean"] }).program.push.exercises.filter((e) => !e.finisher).map((e) => e.reps), PROGRAM.push.exercises.map((e) => e.reps));

// A saved program over 16 reps comes down when it loads (this lifter's own, as of Oct 2026); timed holds,
// cardio and warm-ups are seconds and minutes, never touched; a setup style's original range comes down too.
const saved = { ...PROGRAM, shoulders: { ...PROGRAM.shoulders, exercises: [
  { n: "Lateral Raise (Cable)", sets: 4, reps: [12, 20], rest: 60 }, { n: "Rear Delt Fly", sets: 3, reps: [15, 20], rest: 60 },
  { n: "Face Pulls", sets: 3, reps: [15, 20], rest: 60, base: { reps: [15, 20], rest: 60 } },
  { n: "Seated DB Shoulder Press", sets: 4, reps: [8, 12], rest: 90 },
  { n: "Plank", sets: 3, reps: [30, 60], rest: 60 }, { n: "Stair Climber", kind: "cardio", sets: 1, reps: [20, 30], rest: 0 },
  warmupOf("Stair Climber"), { n: "Push-Up", sets: 3, reps: [8, 25], rest: 60 }, { n: "Wall Sit Hold", sets: 3, reps: [30, 45], rest: 60 },
] } };
const loaded = normalizeProgram(saved).shoulders.exercises;
const R = (n) => loaded.find((e) => e.n === n);
eq("load: 12–20 becomes 10–16", R("Lateral Raise (Cable)").reps, [10, 16]);
eq("load: 15–20 becomes 10–16", R("Rear Delt Fly").reps, [10, 16]);
eq("load: setup style's original comes down too", R("Face Pulls").base.reps, [10, 16]);
eq("load: a low bottom stays", R("Push-Up").reps, [8, 16]);
eq("load: in range stays", R("Seated DB Shoulder Press").reps, [8, 12]);
eq("load: plank seconds stay", R("Plank").reps, [30, 60]);
eq("load: timed hold stays", R("Wall Sit Hold").reps, [30, 45]);
eq("load: cardio minutes stay", R("Stair Climber").reps, [20, 30]);
eq("load: nothing over, same program back", normalizeProgram(PROGRAM).push, PROGRAM.push);
eq("load: no flags left", loaded.filter((e) => checkRange(e)?.dir === "high").map((e) => e.n), []);

// A coach's change can't go past 16; a pasted-in program comes down too, with a note saying so.
const coached = applyChanges(PROGRAM, [{ action: "update", day: "shoulders", exercise: "Lateral Raise (Cable)", rep_min: 15, rep_max: 20 }]);
eq("coach change capped", coached.program.shoulders.exercises.find((e) => e.n === "Lateral Raise (Cable)").reps, [10, 16]);
const pasted = parseProgram("Shoulders\nLateral Raise (Cable) — 4 × 15–20\nPlank — 3 × 30–60 sec\nOverhead Press (Barbell) — 4 × 6–10");
const pl = pasted.workouts?.[0]?.exercises || [];
eq("paste capped", pl.find((e) => e.n === "Lateral Raise (Cable)")?.reps, [10, 16]);
eq("paste plank stays", pl.find((e) => e.n === "Plank")?.reps, [30, 60]);
eq("paste notes the cap", (pasted.notes || []).some((x) => /15–20 becomes 10–16/.test(x)), true);

console.log(failed ? `rep range: ${failed} failed` : "rep range: all checks passed");
process.exit(failed ? 1 : 0);
