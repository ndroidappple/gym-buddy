/* Checks the "after N … sets" note on a late lift (lib/fatigue.js): it names the sets actually done,
   so curls after rows and pulldowns say "after 10 back sets", not "after 5 biceps sets".
   Run: npm run test:coach   (exits 1 on any failure) */
import { loadParts, loadNote } from "../src/lib/fatigue.js";
import { nextSetAdvice } from "../src/lib/setCoach.js";
import { e1rm } from "../src/lib/util.js";

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};
const sets = (n, w = 100, r = 10) => Array.from({ length: n }, () => ({ w, r }));

// A pull day up to the curls: no biceps lift yet, only back work that uses the biceps.
const pull = [
  { n: "Lat Pulldown (Wide Grip)", sets: sets(4) },
  { n: "Seated Cable Row (Close Grip)", sets: sets(3) },
  { n: "Seated Row (Machine)", sets: sets(3) },
];
const curl = loadParts(pull, "Seated DB Curl");
eq("back sets count half toward biceps fatigue", curl.load, 5);
eq("but are kept as back sets", curl.sets, { back: 10 });
eq("the note names them", loadNote(curl.load, "Seated DB Curl", curl.sets), "after 10 back sets");

// Real biceps work before: the lift's own muscle comes first.
const both = loadParts([...pull, { n: "Hammer Curl", sets: sets(3) }], "Seated DB Curl");
eq("own muscle first, then helpers", loadNote(both.load, "Seated DB Curl", both.sets), "after 3 biceps sets and 10 back sets");

// Same muscle only: unchanged wording.
const chest = loadParts([{ n: "Flat DB Press", sets: sets(3) }, { n: "Incline Barbell / Smith Press", sets: sets(4) }], "Machine Pec Dec");
eq("same-muscle sets", loadNote(chest.load, "Machine Pec Dec", chest.sets), "after 7 chest sets");

// Unrelated work and light fatigue: no note.
const legs = loadParts([{ n: "Leg Press (Heavy)", sets: sets(4) }], "Seated DB Curl");
eq("unrelated lifts add nothing", [legs.load, legs.sets], [0, {}]);
eq("under 3 sets of load: no note", loadNote(2.5, "Seated DB Curl", { back: 5 }), null);
eq("without a breakdown, the old wording", loadNote(9, "Machine Pec Dec"), "after 9 chest sets");

// The coach's line after the first set of curls (the case from the screenshot).
const a = nextSetAdvice({ ex: { n: "Seated DB Curl", sets: 3, reps: [10, 12] }, done: [{ w: 20, r: 12 }], left: 2,
  history: [[{ w: 20, r: 10 }]], best: e1rm(20, 13), load: curl.load, loadSets: curl.sets, k: 0.012 });
eq("coach line names back sets", /After 10 back sets/.test(a.line) && !/biceps sets/.test(a.line), true);

console.log(failed ? `fatigue note: ${failed} failed` : "fatigue note: all checks passed");
process.exit(failed ? 1 : 0);
