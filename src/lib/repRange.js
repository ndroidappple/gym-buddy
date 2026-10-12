import { LIBRARY, PROGRAM, isCardio, baseOf } from "../data/program.js";
import { isIsolation } from "./util.js";

/* What rep range suits a lift, so a range far outside it can be flagged. The set coach works inside
   whatever range the program gives a lift; this is the outside check that the range itself is sane.

   Bands are what hypertrophy coaches broadly agree on for each kind of lift, kept wide on purpose:
   growth happens anywhere from about 5 to 30 reps taken close to failure, so a band says where a
   lift is practical and safe, not the one right answer.
   - heavy barbell lifts (squat, deadlift, bench, overhead press, barbell row): 3-10. Low reps are
     fine with a bar and a rack; past 10 the lower back or breathing gives out before the target.
   - other compound lifts (machine and DB presses, rows, pulldowns, pull-ups, leg press, lunges,
     RDLs, hip thrusts): 5-12, with bodyweight lifts often higher.
   - isolation (curls, extensions, flys, leg curls and extensions, shrugs): 8-15. Very low reps
     load the elbows and knees more than the muscle.
   - small muscles that do best light (side and rear delts, face pulls, calves, hip ab/adduction,
     forearms): 12-20. Heavy sets turn into a swing or a shrug.
   - core (crunches, leg raises, rollouts): 8-20.
   A range is flagged only when it misses the band clearly: its top more than 2 reps under the band,
   or its bottom more than 5 over (high reps are inefficient, not risky, so they get more room). */

const BANDS = {
  heavy: { lo: 3, hi: 10, suggest: [5, 8], kind: "heavy barbell lift" },
  compound: { lo: 5, hi: 12, suggest: [8, 12], kind: "compound lift" },
  isolation: { lo: 8, hi: 15, suggest: [10, 15], kind: "isolation lift" },
  light: { lo: 12, hi: 20, suggest: [15, 20], kind: "small-muscle lift" },
  core: { lo: 8, hi: 20, suggest: [10, 15], kind: "core lift" },
};

const TIMED = /plank|hold\b|carry|hang\b|wall sit/i; // seconds, not reps: no rep range to judge
const CORE = /crunch|leg raise|knee raise|ab wheel|rollout|pallof|twist|sit-?up|hollow|woodchop|dead ?bug|v-?up|toes to bar/i;
const LIGHT = /lateral raise|side raise|rear delt|reverse (pec|fly)|face ?pull|y-?raise|calf|calves|adduct|abduct|wrist|forearm|band pull/i;
// Multi-joint lifts the shared compound test (util.js) doesn't name.
const ALSO_COMPOUND = /push-?ups?|step-?ups?|split squat|lunge|leg press|sled/i;
const HEAVY = /\bdeadlift\b(?!.*(romanian|stiff|single))|^(back |front |barbell )?squat\b|\b(back|front) squat\b|(barbell|flat|incline|decline)?\s*bench press|^bench\b|overhead press \(barbell\)|military press|barbell row|pendlay|power clean|snatch/i;

/** The kind of lift, judged from its name: heavy | compound | isolation | light | core, or null (cardio, timed). */
export function liftKind(name) {
  const n = baseOf(String(name || ""));
  if (!n || isCardio(n) || TIMED.test(n)) return null;
  if (CORE.test(n)) return "core";
  if (LIGHT.test(n)) return "light";
  if (HEAVY.test(n) && !/romanian|\brdl\b|stiff/i.test(n)) return "heavy";
  return isIsolation(n) && !ALSO_COMPOUND.test(n) ? "isolation" : "compound";
}

// The app's own defaults: a lift it knows suggests the range it would start that lift on.
const KNOWN = new Map([...LIBRARY, ...Object.values(PROGRAM).flatMap((d) => d.exercises)]
  .filter((e) => !isCardio(e.n)).map((e) => [e.n.toLowerCase(), e.reps]));

/** The band a lift's range is judged against, and the range to suggest: { lo, hi, suggest, kind } or null. */
export function typicalRange(name) {
  const k = liftKind(name);
  if (!k) return null;
  const band = BANDS[k];
  const known = KNOWN.get(String(name).toLowerCase());
  // A known lift's own default, unless it's somehow outside its band.
  const suggest = known && known[0] <= band.hi && known[1] >= band.lo ? known : band.suggest;
  return { ...band, suggest, category: k };
}

const WHY = {
  heavy: { low: "singles and doubles test strength more than they build muscle", high: "that many reps with a heavy bar wears out your lower back and breathing before the muscle" },
  compound: { low: "near-max singles and doubles test strength more than they build muscle", high: "the last reps become a cardio test; a bit more weight builds more" },
  isolation: { low: "very heavy isolation sets load the elbows and knees more than the muscle", high: "the last reps become an endurance test; a bit more weight builds more" },
  light: { low: "heavy sets on a small muscle turn into a swing or shrug and strain the joint", high: "past 25 or so the burn stops you before the muscle does" },
  core: { low: "very low reps rarely train the core well", high: "past 20 a harder version or added weight works better" },
};

/**
 * Checks a program lift's rep range. Returns null when it's in the ballpark (or can't be judged),
 * else { dir: "low" | "high", suggest: [lo, hi], line } where line says it in a sentence.
 */
export function checkRange(ex) {
  if (!ex || !Array.isArray(ex.reps) || ex.warmup) return null;
  const t = typicalRange(ex.n);
  if (!t) return null;
  const [lo, hi] = ex.reps.map(Number);
  if (!(lo > 0 && hi >= lo)) return null;
  const dir = hi < t.lo - 2 ? "low" : lo > t.hi + 5 ? "high" : null;
  if (!dir) return null;
  const [sLo, sHi] = t.suggest;
  return {
    dir, suggest: [sLo, sHi],
    line: `${lo}–${hi} is ${dir === "low" ? "low" : "high"} for ${baseOf(ex.n)}: as ${/^[aeiou]/i.test(t.kind) ? "an" : "a"} ${t.kind} it usually goes ${sLo}–${sHi}, because ${WHY[t.category][dir]}.`,
  };
}
