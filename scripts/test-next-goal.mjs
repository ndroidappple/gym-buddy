/* Checks for the goal the planner builds on (src/lib/util.js nextGoal, workingSet): it anchors on the
   heaviest weight worked in range, not on a lighter set whose extra reps score a higher estimated max.
   Run: node scripts/test-next-goal.mjs   (exits 1 on any failure) */
import { nextGoal, workingSet, readyToIncrease, repsToEarn } from "../src/lib/util.js";

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

// At the top of the range at 120, the sets there holding up: the light first set comes up to 120 × 12.
const top = S([110, 14], [120, 12], [120, 12], [120, 10]);
eq("top: set 1 comes up to 120 × 12", nextGoal(pulldown, top), { w: 120, r: 12, idx: 0, sets: 1 });

/* The weight rule (readyToIncrease): the first set at the top, the rest within the usual fatigue drop
   (about 8% a set), never below the bottom of the range. */
eq("needs on 8-12", [0, 1, 2, 3].map((k) => repsToEarn(pulldown, k)), [12, 11, 10, 9]);
const lateral = { n: "Lateral Raise (Cable)", sets: 4, reps: [10, 16] };
eq("needs on 10-16", [0, 1, 2, 3].map((k) => repsToEarn(lateral, k)), [16, 14, 13, 12]);
eq("needs never under the range", repsToEarn({ n: "Leg Press (Heavy)", sets: 8, reps: [10, 12] }, 7), 10);
const earned = (ex, sets) => readyToIncrease(ex, S(...sets))?.to ?? null;
eq("12, 11, 10, 9 earns it", earned(pulldown, [[120, 12], [120, 11], [120, 10], [120, 9]]), 125);
eq("warm-ups don't count against it", earned(pulldown, [[60, 8], [90, 5], [120, 12], [120, 11], [120, 10], [120, 10]]), 125);
eq("first set short of the top: not yet", earned(pulldown, [[120, 11], [120, 11], [120, 11], [120, 11]]), null);
eq("a set fell off: not yet", earned(pulldown, [[120, 12], [120, 11], [120, 8], [120, 9]]), null);
eq("a planned set missing: not yet", earned(pulldown, [[120, 12], [120, 11], [120, 10]]), null);
eq("16, 14, 13, 12 earns it", earned(lateral, [[25, 16], [25, 14], [25, 13], [25, 12]]), 30);
eq("big leg lifts go up 10", earned({ n: "Leg Press (Heavy)", sets: 4, reps: [8, 12] }, [[300, 12], [300, 11], [300, 10], [300, 9]]), 310);
eq("bodyweight: by reps, never plates", earned({ n: "Pull-Up", sets: 3, reps: [6, 10] }, [[0, 10], [0, 10], [0, 10]]), null);

// Not there yet: the first set that fell short gets one more rep.
eq("short set gets +1", nextGoal(pulldown, S([120, 12], [120, 11], [120, 8], [120, 8])), { w: 120, r: 9, idx: 2, sets: 1, set: 3 });
eq("set number leaves warm-ups out", nextGoal(pulldown, S([60, 8], [120, 12], [120, 11], [120, 8])), { w: 120, r: 9, idx: 3, sets: 1, set: 3 });

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
