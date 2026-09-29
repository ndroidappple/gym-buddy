/* Stress test for the in-workout coach (src/lib/setCoach.js).
   Run: node scripts/stress-set-coach.mjs          (curated scenarios + fuzz, exits 1 on any violation)
        node scripts/stress-set-coach.mjs --verbose (also prints every curated call)
   Invariants every call must hold are checked on curated workouts and on thousands of random ones. */
import { nextSetAdvice, openingAdvice } from "../src/lib/setCoach.js";
import { e1rm, weightStep } from "../src/lib/util.js";

const verbose = process.argv.includes("--verbose");
const LIFTS = {
  bench: { n: "Flat Barbell Bench Press", sets: 4, reps: [6, 10] },
  squat: { n: "Back Squat", sets: 4, reps: [6, 10] },
  deadlift: { n: "Deadlift", sets: 3, reps: [4, 6] },
  strength: { n: "Overhead Press (Barbell)", sets: 4, reps: [3, 5] },
  row: { n: "Seated Cable Row (Close Grip)", sets: 3, reps: [8, 12] },
  lateral: { n: "Lateral Raise (DB)", sets: 4, reps: [12, 20] },
  curl: { n: "Hammer Curl", sets: 3, reps: [10, 12] },
  legpress: { n: "Leg Press (Heavy)", sets: 4, reps: [8, 12] },
  pullup: { n: "Pull-Up", sets: 4, reps: [6, 10] },
  lean: { n: "Leg Extension", sets: 3, reps: [14, 25] },
};

const problems = [];
const bad = (label, msg, input, out) => problems.push({ label, msg, input, out });

/** Rules any call must follow, whatever the inputs. */
function check(label, ex, args, out) {
  const s = args.done[args.done.length - 1];
  const w = +s.w, r = +s.r;
  const [lo, hi] = ex.reps;
  if (!out || typeof out.line !== "string") return bad(label, "no advice", args, out);
  if (/NaN|undefined|Infinity|null|\[object/.test(out.line)) bad(label, "broken text", args, out);
  if (out.line.length > 260) bad(label, `line too long (${out.line.length})`, args, out);
  if (args.left <= 0) { if (out.kind !== "done") bad(label, "no wrap-up after last set", args, out); return; }
  if (out.w == null || out.r == null) return bad(label, "no next set", args, out);
  if (!Number.isFinite(out.w) || !Number.isFinite(out.r)) bad(label, "non-numeric target", args, out);
  if (out.r < 1 || out.r > Math.max(hi, r)) bad(label, `target reps ${out.r} outside 1..${hi}`, args, out);
  if (w > 0 && out.w <= 0) bad(label, "weighted lift dropped to 0", args, out);
  if (w === 0 && out.w !== 0) bad(label, "bodyweight lift given a load", args, out);
  if (out.kind === "check") return; // a suspected typo: the call keeps the previous plan
  if (w > 0 && out.w > Math.max(w + 2 * weightStep(ex.n), w * 1.1) + 1e-9 && !(args.asked && out.w === +args.asked.w)) bad(label, `jump too big ${w} -> ${out.w}`, args, out);
  if (w > 0 && out.w < Math.min(w - weightStep(ex.n), w * 0.8) - 1e-9) bad(label, `drop too big ${w} -> ${out.w}`, args, out);
  if (out.kind === "down" && !(out.w < w)) bad(label, "'down' without a lower weight", args, out);
  if (out.kind === "up" && !(out.w > w)) bad(label, "'up' without a higher weight", args, out);
  if (out.kind === "hold" && w > 0 && out.w !== w && out.kind !== "down") bad(label, "'hold' changed the weight", args, out);
  // Never ask for more than they just did at the same weight, unless they had reps in reserve (fatigue is real).
  const rir = s.rir ?? null;
  if (out.w === w && r > 0 && out.r > r + (rir != null ? Math.max(0, rir - 1) : 0) + (r === lo - 1 ? 1 : 0)) bad(label, `asks ${out.r} after ${r} at the same weight`, args, out);
  // Well under the range at a real weight should never be told to hold.
  if (w > 0 && r <= lo - 3 && out.w >= w && !/lightest/.test(out.line)) bad(label, `${r} reps (range ${lo}-${hi}) but no drop`, args, out);
  // Way past the range should never be told to stay.
  if (w > 0 && r >= hi + 3 && out.w <= w && !/lightest/.test(out.line)) bad(label, `${r} reps (range ${lo}-${hi}) but no increase`, args, out);
  // A lower weight should come with at least as many reps.
  if (w > 0 && out.w < w && out.r < Math.min(r, lo)) bad(label, "lighter weight but fewer reps", args, out);
}

const run = (label, liftKey, args) => {
  const ex = LIFTS[liftKey] || liftKey;
  const full = { history: [], best: 0, pr: false, ...args };
  const out = nextSetAdvice({ ex, ...full });
  check(label, ex, full, out);
  if (verbose) console.log(`\n[${label}] ${ex.n} ${ex.reps.join("-")} done=${full.done.map((x) => `${x.w}x${x.r}${x.rir != null ? `@${x.rir}` : ""}`).join(",")} asked=${full.asked ? `${full.asked.w}x${full.asked.r}` : "-"} left=${full.left}\n   -> ${out.w != null ? `${out.w} x ${out.r} (${out.kind})` : out.kind}: ${out.line}`);
  return out;
};
const bestOf = (hist) => Math.max(0, ...hist.flat().map((s) => e1rm(s.w, s.r)));

const expectKind = (label, out, kind) => { if (out.kind !== kind) bad(label, `expected '${kind}', got '${out.kind}'`, {}, out); };
/* ── Curated scenarios ── */
const benchH = [[{ w: 185, r: 8 }, { w: 185, r: 7 }, { w: 185, r: 7 }, { w: 185, r: 6 }], [{ w: 185, r: 7 }, { w: 185, r: 7 }, { w: 185, r: 6 }, { w: 175, r: 8 }]];
run("bench: PR attempt hit", "bench", { done: [{ w: 185, r: 9 }], asked: { w: 185, r: 9 }, left: 3, history: benchH, best: bestOf(benchH), pr: true });
run("bench: PR attempt missed by 1", "bench", { done: [{ w: 185, r: 8 }], asked: { w: 185, r: 9 }, left: 3, history: benchH, best: bestOf(benchH) });
run("bench: missed badly on set 1", "bench", { done: [{ w: 185, r: 4 }], asked: { w: 185, r: 9 }, left: 3, history: benchH, best: bestOf(benchH) });
run("bench: failed at 1 rep", "bench", { done: [{ w: 185, r: 1 }], asked: { w: 185, r: 9 }, left: 3, history: benchH, best: bestOf(benchH) });
run("bench: 0 reps logged", "bench", { done: [{ w: 185, r: 0 }], asked: { w: 185, r: 9 }, left: 3, history: benchH, best: bestOf(benchH) });
expectKind("typo reps", run("bench: typo 80 reps", "bench", { done: [{ w: 185, r: 80 }], asked: { w: 185, r: 9 }, left: 3, history: benchH, best: bestOf(benchH) }), "check");
expectKind("typo weight", run("bench: typo 1850 lb", "bench", { done: [{ w: 1850, r: 8 }], asked: { w: 185, r: 9 }, left: 3, history: benchH, best: bestOf(benchH) }), "check");
run("bench: lifter chose heavier weight", "bench", { done: [{ w: 195, r: 6 }], asked: { w: 185, r: 9 }, left: 3, history: benchH, best: bestOf(benchH), pr: true });
run("bench: lifter chose lighter weight", "bench", { done: [{ w: 165, r: 10 }], asked: { w: 185, r: 9 }, left: 3, history: benchH, best: bestOf(benchH) });
run("bench: RIR 0 at 6", "bench", { done: [{ w: 185, r: 6, rir: 0 }], asked: { w: 185, r: 9 }, left: 3, history: benchH, best: bestOf(benchH) });
run("bench: RIR 4 at 8", "bench", { done: [{ w: 185, r: 8, rir: 4 }], asked: { w: 185, r: 8 }, left: 3, history: benchH, best: bestOf(benchH) });
run("bench: reps went UP set to set", "bench", { done: [{ w: 185, r: 7 }, { w: 185, r: 9 }], asked: { w: 185, r: 6 }, left: 2, history: benchH, best: bestOf(benchH) });
run("bench: extra set past plan", "bench", { done: [{ w: 185, r: 8 }, { w: 185, r: 7 }, { w: 185, r: 7 }, { w: 185, r: 6 }, { w: 185, r: 6 }], left: 1, history: benchH, best: bestOf(benchH) });
run("squat: first time ever", "squat", { done: [{ w: 135, r: 10 }], left: 3 });
run("squat: first time, too light", "squat", { done: [{ w: 135, r: 15 }], left: 3 });
run("squat: first time, too heavy", "squat", { done: [{ w: 225, r: 3 }], left: 3 });
run("deadlift: 4-6 range at 6", "deadlift", { done: [{ w: 315, r: 6 }], left: 2, history: [[{ w: 315, r: 5 }, { w: 315, r: 5 }, { w: 315, r: 4 }]], best: e1rm(315, 5) });
run("deadlift: 4-6 range at 3", "deadlift", { done: [{ w: 315, r: 3 }], left: 2, history: [[{ w: 315, r: 5 }, { w: 315, r: 5 }, { w: 315, r: 4 }]], best: e1rm(315, 5) });
run("strength 3-5: 5 reps @ RIR 2", "strength", { done: [{ w: 135, r: 5, rir: 2 }], left: 3 });
run("lateral: 5 lb at 20", "lateral", { done: [{ w: 5, r: 20 }], left: 3 });
run("lateral: 5 lb at 8 (too heavy, can't go lighter)", "lateral", { done: [{ w: 5, r: 8 }], left: 3 });
run("lateral: 10 lb at 9", "lateral", { done: [{ w: 10, r: 9 }], left: 3 });
run("lateral: 25 lb at 30", "lateral", { done: [{ w: 25, r: 30 }], left: 3 });
run("curl: 2.5 lb plates", "curl", { done: [{ w: 27.5, r: 12 }], left: 2 });
run("curl: narrow 10-12 at 11", "curl", { done: [{ w: 30, r: 11 }], left: 2, history: [[{ w: 30, r: 12 }, { w: 30, r: 10 }, { w: 30, r: 10 }]], best: e1rm(30, 12) });
run("leg press: 10 lb step, 25 reps", "legpress", { done: [{ w: 360, r: 25 }], left: 3 });
run("leg press: off day", "legpress", { done: [{ w: 360, r: 7 }], asked: { w: 360, r: 11 }, left: 3, history: [[{ w: 360, r: 10 }, { w: 360, r: 10 }]], best: e1rm(400, 10) });
run("pull-up: bodyweight 3 reps", "pullup", { done: [{ w: 0, r: 3 }], left: 3 });
run("pull-up: bodyweight 15 reps", "pullup", { done: [{ w: 0, r: 15 }], left: 3 });
run("pull-up: 1 rep", "pullup", { done: [{ w: 0, r: 1 }], left: 3 });
run("pull-up: weighted 25 lb x 12", "pullup", { done: [{ w: 25, r: 12 }], left: 2 });
run("lean 14-25 at 26", "lean", { done: [{ w: 90, r: 26 }], left: 2 });
run("last set wrap-up, mixed weights", "bench", { done: [{ w: 185, r: 8 }, { w: 185, r: 6 }, { w: 175, r: 7 }, { w: 175, r: 7 }], left: 0, history: benchH, best: bestOf(benchH) });
run("last set wrap-up, bodyweight", "pullup", { done: [{ w: 0, r: 8 }, { w: 0, r: 7 }, { w: 0, r: 6 }, { w: 0, r: 6 }], left: 0 });
run("pyramid history (warm-ups logged)", "bench", { done: [{ w: 185, r: 8 }], left: 3, history: [[{ w: 95, r: 10 }, { w: 135, r: 8 }, { w: 185, r: 8 }, { w: 185, r: 7 }]], best: e1rm(185, 8) });

run("bench: big fall-off between sets", "bench", { done: [{ w: 185, r: 9 }, { w: 185, r: 5 }], left: 2, history: benchH, best: bestOf(benchH) });
run("bench: went lighter, hit top", "bench", { done: [{ w: 165, r: 11 }], asked: { w: 185, r: 9 }, left: 3, history: benchH, best: bestOf(benchH) });
run("pec deck after 9 chest sets", { n: "Machine Pec Dec", sets: 3, reps: [10, 15] }, { done: [{ w: 100, r: 11 }], asked: { w: 100, r: 13 }, left: 2, history: [[{ w: 100, r: 14 }]], best: e1rm(100, 14), load: 9, k: 0.012 });
run("pec deck PR after 9 chest sets", { n: "Machine Pec Dec", sets: 3, reps: [10, 15] }, { done: [{ w: 100, r: 15 }], left: 2, history: [[{ w: 100, r: 14 }]], best: e1rm(100, 14), load: 9, k: 0.012, pr: true });
for (const [label, ex, hist, first, days] of [["opening after 4 weeks off", "bench", benchH, true, 28], ["opening after 8 weeks off", "bench", benchH, true, 56],["opening bench", "bench", benchH, true], ["opening first-ever", "squat", [], true], ["opening bodyweight", "pullup", [[{ w: 0, r: 8 }, { w: 0, r: 7 }]], true], ["opening lateral 5 lb", "lateral", [[{ w: 5, r: 15 }]], false]]) {
  const o = openingAdvice({ ex: LIFTS[ex], history: hist, firstLift: first, daysSince: days ?? null });
  if (verbose) console.log(`\n[${label}] -> ${o ? `${o.w} x ${o.r}: ${o.line}` : "none"}`);
  if (o && /NaN|undefined|Infinity/.test(o.line)) bad(label, "broken opening text", { hist }, o);
  if (o && LIFTS[ex] && hist[0]?.[0]?.w === 0 && /BW × \d+, then/.test(o.line)) bad(label, "warm-ups on a bodyweight lift", { hist }, o);
}

/* ── Fuzz: random workouts, the coach's call fed back as the next ask ── */
let seed = +(process.argv.find((a) => a.startsWith("--seed="))?.slice(7) || 42);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (a) => a[Math.floor(rand() * a.length)];
let calls = 0;
const RUNS = +(process.argv.find((a) => a.startsWith("--runs="))?.slice(7) || 4000);
for (let t = 0; t < RUNS; t++) {
  const ex = LIFTS[pick(Object.keys(LIFTS))];
  const bodyweight = ex.n === "Pull-Up" && rand() < 0.5;
  const base = bodyweight ? 0 : Math.round((20 + rand() * 300) / 5) * 5;
  const hist = rand() < 0.3 ? [] : [Array.from({ length: ex.sets }, (_, i) => ({ w: base, r: Math.max(1, ex.reps[0] + Math.floor(rand() * 5) - 2 - i) }))];
  const best = bestOf(hist);
  const done = [];
  // Sometimes done late in the workout, with a personal fatigue rate anywhere in the learned range.
  const load = rand() < 0.4 ? Math.floor(rand() * 15) : 0;
  const k = rand() * 0.025;
  let asked = hist[0]?.[0] ? { w: base, r: hist[0][0].r + 1 } : null;
  let w = base;
  const total = ex.sets + (rand() < 0.2 ? 1 : 0);
  for (let i = 0; i < total; i++) {
    // The lifter mostly does what's asked, give or take; sometimes wildly off.
    const target = asked?.r ?? ex.reps[0] + 2;
    const r = Math.max(0, rand() < 0.08 ? Math.floor(rand() * 40) : target + Math.floor(rand() * 5) - 3);
    const rir = rand() < 0.3 ? Math.floor(rand() * 5) : null;
    done.push({ w, r, ...(rir != null ? { rir } : {}) });
    const args = { done: [...done], asked, left: total - done.length, history: hist, best, pr: best > 0 && e1rm(w, r) > best, load, k };
    const out = nextSetAdvice({ ex, ...args });
    calls++;
    check(`fuzz#${t}.${i}`, ex, args, out);
    if (out.w != null) { w = out.w; asked = { w: out.w, r: out.r }; }
  }
}

const byMsg = {};
for (const p of problems) (byMsg[p.msg.replace(/\d+(\.\d+)?/g, "#")] ||= []).push(p);
console.log(`\n${calls} fuzzed calls + curated scenarios. ${problems.length} violations.`);
for (const [msg, list] of Object.entries(byMsg)) {
  const p = list[0];
  console.log(`\n✗ ${msg} ×${list.length}\n  e.g. [${p.label}] done=${JSON.stringify(p.input.done)} asked=${JSON.stringify(p.input.asked)} left=${p.input.left}\n  -> ${JSON.stringify(p.out)}`);
}
process.exit(problems.length ? 1 : 0);
