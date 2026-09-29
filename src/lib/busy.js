import { LIBRARY, allDays, isCardio } from "../data/program.js";
import { isIsolation } from "./util.js";

/* When a machine is busy. Three tiers decide what's movable:
   - the anchor: the day's first heavy compound, the best strength measure, worth a short wait;
   - main work: the other compounds, best kept roughly in order;
   - flex: isolations, which can go wherever a machine is free.
   What to do instead, best first: a lift for a different muscle (the busy lift's muscle stays
   fresh), then a lift that only shares helpers (chest -> triceps), and only then the same muscle.
   Or swap the lift for an equivalent that trains the same muscle (cable fly for pec deck). */

/* Primary muscle by name, most specific first ("leg curl" is hamstrings before "curl" is biceps,
   "shoulder press" is shoulders before "press" is chest, "reverse pec" is rear delts). */
const RULES = [
  ["core", /crunch|plank|leg raise|\bab\b|rollout|pallof|russian twist|sit-?up/i],
  ["cardio", /treadmill|bike|cycl|rower|rowing|stair|elliptical|\brun\b|incline walk|jog|sprint|jump rope|swim|sled/i],
  ["calves", /calf/i],
  ["hamstrings", /leg curl|romanian|\brdl\b|good morning|nordic|stiff.?leg|hamstring|deadlift/i],
  ["glutes", /hip thrust|glute|abduction|kickback/i],
  ["quads", /squat|leg press|lunge|step-?up|leg extension|hack|adduction/i],
  ["shoulders", /upright row|face pull|rear delt|reverse pec/i], // before back: these rows/pulls hit delts
  ["back", /pulldown|\brows?\b|pull-?ups?|chin-?ups?|pullover|shrug|straight-arm|\blats?\b/i],
  ["triceps", /tricep|skull|pushdown|close-grip|dips \(upright\)|overhead.*extension|cable extension|kickback/i],
  ["biceps", /curl/i],
  ["shoulders", /shoulder|lateral|rear delt|face pull|reverse pec|overhead press|military|arnold|front raise|upright row|y-raise/i],
  ["chest", /press|fly|flye|pec|bench|dips?\b|push-?up|crossover/i],
];
const GROUP = { Chest: "chest", Back: "back", Shoulders: "shoulders", Arms: "biceps", Legs: "quads", Core: "core", Cardio: "cardio" };
/* Movement pattern within a muscle, so a swap moves the same way (pulldown for pull-up, fly for pec deck). */
const PATTERNS = [
  ["vertical pull", /pulldown|pull-?up|chin-?up|pullover|straight-arm/i],
  ["horizontal pull", /\brows?\b/i],
  ["fly", /fly|flye|pec|crossover/i],
  ["raise", /lateral|front raise|y-raise/i],
  ["rear delt", /rear delt|face pull|reverse pec|upright row/i],
  ["knee extension", /leg extension/i],
  ["knee curl", /leg curl|nordic/i],
  ["hinge", /deadlift|romanian|\brdl\b|good morning|hip thrust/i],
  ["press", /press|squat|hack|lunge|step-?up|dip|push-?up|bench/i],
];
export const patternOf = (name) => PATTERNS.find(([, re]) => re.test(name))?.[0] || "other";

/** Muscles that help each other's lifts: working one tires the other a little. */
const HELPERS = {
  chest: ["triceps", "shoulders"], triceps: ["chest", "shoulders"], shoulders: ["chest", "triceps"],
  back: ["biceps"], biceps: ["back"],
  quads: ["glutes"], glutes: ["quads", "hamstrings"], hamstrings: ["glutes"],
};

/** The primary muscle a lift trains. */
export function muscleOf(name) {
  const hit = RULES.find(([, re]) => re.test(name));
  if (hit) return hit[0];
  return GROUP[LIBRARY.find((l) => l.n === name)?.g] || "other";
}
/** "your chest stays" / "your quads stay". */
const PLURAL = new Set(["quads", "hamstrings", "glutes", "calves", "triceps", "biceps", "shoulders"]);
export const MUSCLE_LABEL = {
  chest: "chest", back: "back", shoulders: "shoulders", triceps: "triceps", biceps: "biceps", quads: "quads",
  hamstrings: "hamstrings", glutes: "glutes", calves: "calves", core: "core", cardio: "cardio", other: "other muscles",
};

/** 0 = a different muscle, 1 = shares a helper muscle, 2 = the same muscle. */
export function overlap(a, b) {
  const ma = muscleOf(a), mb = muscleOf(b);
  if (ma === mb) return 2;
  return (HELPERS[ma] || []).includes(mb) ? 1 : 0;
}

/** The day's anchor: its first heavy compound (not cardio, not an isolation). */
export const anchorOf = (exercises) => exercises.find((e) => !isCardio(e.n) && !isIsolation(e.n) && !e.today)?.n || null;

/**
 * What to do now instead of `busy`: the other lifts still to do today, best first, each with why.
 * Returns [{ n, overlap, why }].
 */
export function doInstead(busy, pending, anchor) {
  const mk = muscleOf(busy), m = MUSCLE_LABEL[mk], stay = PLURAL.has(mk) ? "stay" : "stays";
  return pending
    .filter((n) => n !== busy)
    .map((n, i) => ({ n, i, overlap: overlap(busy, n) }))
    // The anchor goes first whenever it's still waiting; otherwise the least overlap, in program order.
    .sort((a, b) => (b.n === anchor) - (a.n === anchor) || a.overlap - b.overlap || a.i - b.i)
    .map(({ n, overlap: o }) => ({
      n, overlap: o,
      why: n === anchor ? "Your main lift: best done fresh"
        : o === 0 ? `Different muscle: your ${m} ${stay} fresh`
        : o === 1 ? `Some overlap with your ${m}`
        : `Same muscle: expect a rep or two less on ${busy} after`,
    }));
}

/**
 * Lifts that could stand in for `busy` today: the same primary muscle, not already in the workout.
 * Same movement pattern first, then ones this lifter has done before (history to compare against),
 * then the same kind of lift (isolation for isolation, compound for compound).
 */
export function swapsFor(busy, { program, sessions, exclude = [], limit = 5 }) {
  const m = muscleOf(busy);
  const iso = isIsolation(busy);
  const pat = patternOf(busy);
  const done = new Set(sessions.flatMap((s) => Object.keys(s.sets || {})));
  const skip = new Set([busy, ...exclude]);
  const pool = new Map();
  for (const d of allDays(program)) for (const e of program[d].exercises) if (!pool.has(e.n)) pool.set(e.n, { n: e.n, sets: e.sets, reps: e.reps, rest: e.rest, cue: e.cue });
  for (const e of LIBRARY) if (!pool.has(e.n)) { const { g, ...ex } = e; pool.set(e.n, ex); } // eslint-disable-line no-unused-vars
  return [...pool.values()]
    .filter((e) => !skip.has(e.n) && !isCardio(e.n) && muscleOf(e.n) === m)
    .map((e) => ({ ...e, logged: done.has(e.n), sameKind: isIsolation(e.n) === iso, samePattern: patternOf(e.n) === pat }))
    .filter((e) => e.samePattern || e.sameKind) // a leg curl isn't swapped for a deadlift
    // Same movement first (it trains the muscle the same way), then ones with history, then the same kind.
    .sort((a, b) => b.samePattern - a.samePattern || b.logged - a.logged || b.sameKind - a.sameKind || a.n.localeCompare(b.n))
    .slice(0, limit);
}
