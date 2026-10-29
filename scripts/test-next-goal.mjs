/* Checks for the goal the planner builds on (src/lib/util.js nextGoal, workingSet): it anchors on the
   heaviest weight worked in range, not on a lighter set whose extra reps score a higher estimated max.
   Run: node scripts/test-next-goal.mjs   (exits 1 on any failure) */
import { nextGoal, workingSet } from "../src/lib/util.js";

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};
const S = (...xs) => xs.map(([w, r]) => ({ w, r }));
const pulldown = { n: "Lat Pulldown (Wide Grip)", sets: 4, reps: [8, 12] };

// 110 × 14 outscores 120 × 10 on estimated max (161 vs 160); the goal still builds on 120.
const ramp = S([110, 14], [120, 10], [120, 9], [120, 9]);
eq("ramp: working set is the best at 120", workingSet(pulldown, ramp), { w: 120, r: 10 });
eq("ramp: goal is 120 × 11 on set 2", nextGoal(pulldown, ramp), { w: 120, r: 11, idx: 1, sets: 1 });

// At the top of the range at 120: the next set at the top is the light one.
const top = S([110, 14], [120, 12], [120, 12], [120, 10]);
eq("top: one more set at 120 × 12, on set 1", nextGoal(pulldown, top), { w: 120, r: 12, idx: 0, sets: 3 });

// A heavier set below the range isn't the working weight; the weight that held the range is.
const tooHeavy = S([130, 5], [120, 10], [120, 9]);
eq("too heavy: builds on 120", nextGoal(pulldown, tooHeavy), { w: 120, r: 11, idx: 1, sets: 1 });

// Nothing in range: the heaviest weight still leads.
const short = S([130, 6], [120, 7]);
eq("short: builds on 130", nextGoal(pulldown, short), { w: 130, r: 7, idx: 0, sets: 1 });

// Straight sets behave as before.
eq("straight sets", nextGoal(pulldown, S([120, 10], [120, 9])), { w: 120, r: 11, idx: 0, sets: 1 });
eq("bodyweight", nextGoal({ n: "Pull-Up", sets: 3, reps: [6, 10] }, S([0, 8], [0, 7])), { w: 0, r: 9, idx: 0, sets: 1 });

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("next goal: all checks passed");
