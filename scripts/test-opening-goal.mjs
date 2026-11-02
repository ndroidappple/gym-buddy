/* Checks the goal the coach opens a lift with (lib/setCoach.js openingAdvice): it carries a `goal` for
   the lift's badge, so the badge, the pre-filled first set and the coach's line name the same target,
   even when the coach builds on an older session done at the same point in the workout.
   Run: npm run test:coach   (exits 1 on any failure) */
import { openingAdvice } from "../src/lib/setCoach.js";
import { DEFAULT_K } from "../src/lib/fatigue.js";

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};
const S = (...xs) => xs.map(([w, r]) => ({ w, r }));
const press = { n: "Seated DB Shoulder Press", sets: 4, reps: [8, 12] };

// Fresh today; the latest session came after 6 shoulder sets, the one before it was fresh.
const history = [S([30, 10], [30, 8], [30, 8], [30, 7]), S([30, 13], [30, 9], [30, 6], [25, 8])];
const fresh = openingAdvice({ ex: press, history, firstLift: true, fatigue: { k: DEFAULT_K, now: 0, past: [6, 0] } });
eq("builds on the fresh session", [fresh.w, fresh.r], [30, 12]);
eq("badge goal matches the first set", fresh.goal, { w: 30, r: 12, sets: 2 });
eq("line names the sets", fresh.line.endsWith("Beat that: 30 × 12 on 2 sets."), true);

// No fatigue difference: the plain goal from the latest session, same in badge and first set.
const plain = openingAdvice({ ex: press, history, firstLift: false });
eq("plain goal", plain.goal, { w: 30, r: 11, sets: 1 });
eq("plain first set", [plain.w, plain.r], [30, 11]);

// A short night: match last time's best, and the badge says Match.
const easy = openingAdvice({ ex: press, history, firstLift: false, easy: "Short night." });
eq("easy: match", easy.goal, { w: 30, r: 10, sets: 1, match: true });

// Every return with numbers carries a goal that agrees with them (walkthrough weight aside).
for (const [name, o] of [["fresh", fresh], ["plain", plain], ["easy", easy],
  ["layoff", openingAdvice({ ex: press, history, firstLift: false, daysSince: 25 })],
  ["long layoff", openingAdvice({ ex: press, history, firstLift: false, daysSince: 50 })]]) {
  eq(`${name}: goal agrees`, [o.goal?.w, o.goal?.r], [o.w, o.r]);
}

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("opening goal: all checks passed");
