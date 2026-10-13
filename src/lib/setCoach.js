import { e1rm, fmtW, weightStep, isIsolation, nextGoal, readyToIncrease, lifting } from "./util.js";
import { freshness, freshMax, loadNote, DEFAULT_K } from "./fatigue.js";

/* The in-workout coach: after every logged set, what the next set should be and why.
   Runs on the phone (instant, works on gym wifi), from rules a good hypertrophy coach uses:

   - Double progression inside the lift's rep range: reps first, then weight.
   - Work sets end about 1-2 reps short of failure (RIR 1-2). Too easy means go heavier; well
     short of the range means the weight is too heavy, so drop it and get quality reps.
   - Reps fall off set to set at the same weight. How much is learned from this lifter's own
     history on this lift (default 1), so "7 after 8" isn't read as a failure. Without a reps-in-
     reserve rating the coach never asks for more reps than were just done at the same weight.
   - Today's form: the best set so far vs the all-time best (estimated 1-rep max). A PR is only
     chased on a day it's on; an off day is told to bank quality sets instead of grinding.
   - Changes between sets are small: at most about 10% (or two plate steps) up, 20% down, in the
     lift's own plate steps from the weight in use (27.5 goes to 32.5, not 35).
   - Numbers that look like typos (80 reps, 1850 lb) get "check that set", not a new plan.
   - Bodyweight lifts (pull-ups, dips, push-ups) count the lifter's bodyweight in the math, so
     added weight is judged as the real load.
   - Fatigue-aware: a lift done after other work for the same muscle is compared with a session
     where it was done at a similar point, or its targets are scaled for the difference, and "off
     day" / "strong today" are judged on fresh-equivalent numbers (see lib/fatigue.js).
   Predictions use Epley: e1RM = load × (1 + reps/30). Stress-tested by scripts/stress-set-coach.mjs. */

export const BODYWEIGHT = /pull-?ups?|chin-?ups?|\bdips?\b|push-?ups?|inverted row|muscle-?ups?/i;
/** Reps you'd get at a load, given an estimated 1-rep max (Epley, inverted). */
const repsAt = (max, load) => (load > 0 ? Math.floor(30 * (max / load - 1) + 1e-9) : 0);
/** The load that should give `r` reps for an estimated 1-rep max. */
const loadFor = (max, r) => max / (1 + r / 30);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Typical rep drop between back-to-back sets at the same weight, from this lift's history (0-3, default 1). */
export function fatigueDrop(history) {
  const drops = [];
  for (const sets of history.slice(0, 6)) {
    const l = lifting(sets);
    for (let i = 1; i < l.length; i++) if (l[i].w === l[i - 1].w && l[i].r > 0) drops.push(l[i - 1].r - l[i].r);
  }
  if (drops.length < 3) return 1;
  const avg = drops.reduce((a, d) => a + d, 0) / drops.length;
  return clamp(Math.round(avg), 0, 3);
}

/** A session's work sets: warm-ups (under 80% of the day's top weight) left out. */
export function workSets(sets) {
  const l = lifting(sets);
  const top = Math.max(0, ...l.map((s) => +s.w));
  return top > 0 ? l.filter((s) => +s.w >= top * 0.8) : l;
}

/** "80 × 8, 7, 7" when the weight held; "80×6, 80×4, 70×7" when it changed. */
const listSets = (sets) => (sets.every((x) => +x.w === +sets[0].w)
  ? `${fmtW(+sets[0].w)} × ${sets.map((x) => x.r).join(", ")}`
  : sets.map((x) => `${fmtW(+x.w)}×${x.r}`).join(", "));

const rirOf = (s) => (s.rir != null && s.rir !== "" && Number.isFinite(+s.rir) ? +s.rir : null);

/** Weight moves in the lift's plate steps from the weight in use, capped per set. */
function stepUp(w, wanted, step) {
  const cap = Math.max(w + 2 * step, w * 1.1);
  const target = Math.min(wanted, cap);
  return w + step * Math.max(1, Math.floor((target - w) / step + 1e-9));
}
function stepDown(w, wanted, step) {
  const floor = Math.min(w - step, w * 0.8);
  const target = Math.max(wanted, floor);
  // Enough steps to reach the target, but never past the floor (always at least one step).
  const steps = Math.max(1, Math.min(Math.ceil((w - target) / step - 1e-9), Math.floor((w - floor) / step + 1e-9)));
  const down = w - step * steps;
  return down > 0 ? down : null; // null: already at the lightest weight there is
}

/**
 * Advice before the first set: last time's work sets, the goal for today, and warm-ups for the first
 * heavy lift of the day. Returns { w, r, line } or null for a first-ever lift.
 */
export function openingAdvice({ ex, history, firstLift, daysSince = null, fatigue = null }) {
  if (!history[0]?.length) return null;
  // Compare like with like: the most recent of the last 6 sessions done at a similar point (within
  // 3 sets of fatigue), when that isn't simply the latest one.
  const k = fatigue?.k ?? DEFAULT_K;
  const now = fatigue?.now ?? 0;
  const past = fatigue?.past || [];
  const alike = fatigue ? past.slice(0, 6).findIndex((l) => Math.abs(l - now) <= 3) : 0;
  const idx = alike > 0 && history[alike]?.length ? alike : 0;
  const last = history[idx];
  const work = workSets(last);
  const step = weightStep(ex.n);
  // Back after a layoff: 3+ weeks means match last time (no PR hunting); 6+ weeks means start ~10% lighter.
  if (daysSince != null && daysSince >= 21 && work[0]) {
    const long = daysSince >= 42;
    const w = long && work[0].w > 0 ? Math.max(step, Math.round((work[0].w * 0.9) / step) * step) : work[0].w;
    const r = Math.max(ex.reps[0], Math.min(ex.reps[1], work[0].r));
    const weeks = Math.round(daysSince / 7);
    return { w, r, line: `Last time ${listSets(work)}, ${weeks} weeks ago. ${long ? `Ease back in: ${fmtW(w)} × ${r}, leave 2 reps in the tank.` : `Rebuild first: match ${fmtW(w)} × ${r} today, PRs next week.`}` };
  }
  const bump = readyToIncrease(ex, work);
  const goal = bump ? { w: bump.to, r: ex.reps[0] } : nextGoal(ex, work);
  if (!goal) return null;
  const note = loadNote(now, ex.n, fatigue?.nowSets);
  if (idx > 0) {
    // An older session done this late is the fair comparison.
    const when = note ? `this late (${note})` : "fresh";
    return { w: goal.w, r: goal.r, line: `Last time you did it ${when}: ${listSets(work)}. Beat that: ${fmtW(goal.w)} × ${goal.r}.` };
  }
  const then = past[0] ?? 0;
  if (fatigue && Math.abs(now - then) >= 3 && goal.w > 0 && !bump) {
    // Done at a different point than last time: scale the goal to the same effort.
    const adj = Math.max(ex.reps[0], Math.min(ex.reps[1], Math.floor(30 * ((e1rm(goal.w, goal.r) * freshness(now, k)) / freshness(then, k) / goal.w - 1) + 1e-9)));
    if (adj !== goal.r) {
      const when = now > then ? `${note} today` : "fresher today";
      return { w: goal.w, r: adj, line: `Last time ${listSets(work)}${then >= 3 ? ` (${loadNote(then, ex.n, fatigue.pastSets?.[0])})` : " (done fresh)"}. ${when[0].toUpperCase()}${when.slice(1)}, ${fmtW(goal.w)} × ${adj} is the same effort as beating it.` };
    }
  }
  const aim = bump
    ? `You earned it: ${fmtW(bump.to)} lb today. Aim for ${ex.reps[0]}+ on set 1.`
    : `Beat it by one: ${fmtW(goal.w)} × ${goal.r}${goal.sets > 1 ? ` on ${goal.sets} sets` : ""}.`;
  // Warm-ups: the first loaded compound lift of the day.
  const warm = firstLift && !isIsolation(ex.n) && !BODYWEIGHT.test(ex.n) && goal.w >= 60
    ? ` Warm up first: ${fmtW(Math.round(goal.w * 0.5 / step) * step)} × 8, then ${fmtW(Math.round(goal.w * 0.75 / step) * step)} × 4.`
    : "";
  return { w: goal.w, r: goal.r, line: `Last time ${listSets(work)}. ${aim}${warm}` };
}

/**
 * What the next set should be, after a set is logged.
 *   ex:         the program entry ({ n, sets, reps: [lo, hi] })
 *   done:       today's logged sets for this lift, in order ({ w, r, rir? }), the new one last
 *   asked:      what the coach had asked for on that set ({ w, r }), if anything
 *   left:       sets still to do after this one
 *   history:    earlier sessions' sets for this lift, newest first (arrays of { w, r })
 *   best:       all-time best estimated 1-rep max before today (0 if none)
 *   pr:         whether the set just logged was a PR
 *   bodyweight: the lifter's bodyweight in lb, for pull-ups/dips with added weight (default 180)
 *   load:       fatigue from earlier lifts today (see lib/fatigue.js); loadSets, the sets behind it by muscle
 * Returns { w, r, line, kind } for the next set (kind: up | hold | down | check), or, when no sets
 * are left, { line, kind: "done" }.
 */
export function nextSetAdvice({ ex, done, asked, left, history = [], best = 0, pr = false, bodyweight: bw = 180, load: fatigueLoad = 0, loadSets = null, k = DEFAULT_K }) {
  const [lo, hi] = ex.reps;
  const s = done[done.length - 1];
  const w = +s.w, r = +s.r;
  const rir = rirOf(s);
  const step = weightStep(ex.n);
  const drop = fatigueDrop(history);
  const lastTime = workSets(history[0] || []);
  const same = lastTime[done.length - 1]; // this set, last session
  const next = lastTime[done.length]; // next set, last session
  const extra = BODYWEIGHT.test(ex.n) ? bw : 0; // bodyweight counts in the load for pull-ups and dips
  const load = w + extra;
  const lastSet = left === 1;
  const finisher = lastSet ? " Last set: take it to 1 rep short of failure." : "";

  // Numbers that look like typos: check before planning anything around them.
  const prevW = done.length > 1 ? +done[done.length - 2].w : asked?.w ?? lastTime[0]?.w;
  const typoReps = r > Math.max(hi * 2, hi + 15);
  const typoWeight = w > 0 && prevW > 0 && w > prevW * 1.8;
  if (left > 0 && (typoReps || typoWeight)) {
    const keep = asked && +asked.w > 0 ? asked : { w: prevW > 0 ? prevW : w, r: lo };
    const kr = clamp(+keep.r, lo, hi);
    return { w: +keep.w, r: kr, kind: "check", line: `${fmtW(w)} × ${r}? That looks like a typo. Hold the set to fix it; next set stays ${fmtW(+keep.w)} × ${kr}.` };
  }

  // What was said about the set just done.
  const vsAsk = asked && +asked.w === w && asked.r ? r - asked.r : null;
  const vsLast = same && +same.w === w ? r - same.r : null;
  let said;
  const lateNote = done.length === 1 && w > 0 && r > 0 ? loadNote(fatigueLoad, ex.n, loadSets) : null;
  const freshReps = lateNote ? Math.floor(30 * (freshMax(e1rm(w, r), fatigueLoad, k) / w - 1) + 1e-9) : 0;
  if (r === 0) said = `No reps at ${fmtW(w)}.`;
  else if (pr && lateNote) said = `PR: ${fmtW(w)} × ${r}, ${lateNote}!`;
  else if (pr) said = `PR: ${fmtW(w)} × ${r}!`;
  else if (vsAsk != null && vsAsk >= 0) said = vsAsk > 0 ? `${r}, ${vsAsk} past the target.` : `${r}, right on target.`;
  else if (vsAsk != null) said = `${r}, ${-vsAsk} short of ${asked.r}.`;
  else if (vsLast != null) said = vsLast > 0 ? `${r}, ${vsLast} more than last time.` : vsLast === 0 ? `${r}, same as last time.` : `${r} today vs ${same.r} last time.`;
  else said = `${fmtW(w)} × ${r}.`;
  // A late lift: say what it's worth fresh, so a lower number isn't read as going backwards.
  if (lateNote && !pr && freshReps > r) said += ` ${lateNote[0].toUpperCase()}${lateNote.slice(1)}, that's a fresh ~${freshReps}.`;

  // No sets left: wrap up with what next time should be.
  if (left <= 0) {
    const sets = done.map((x) => ({ w: +x.w, r: +x.r })).filter((x) => x.r > 0);
    const earned = sets.length >= ex.sets && readyToIncrease(ex, sets);
    const goal = nextGoal(ex, workSets(sets));
    const tail = earned ? `Every set at ${hi}: go up to ${fmtW(earned.to)} lb next time.`
      : goal ? `Next time: ${fmtW(goal.w)} × ${goal.r}${goal.sets > 1 ? ` on ${goal.sets} sets` : " on set 1"}.` : "";
    return { kind: "done", line: `${said} Done: ${listSets(done.map((x) => ({ w: +x.w, r: +x.r })))}. ${tail}`.trim() };
  }

  // A failed rep: nothing to predict from, so take about 10% off.
  if (r === 0) {
    if (w === 0) return { w: 0, r: 1, kind: "hold", line: `${said} Rest a bit longer, then get what you can and finish with slow lowering reps.` };
    const down = stepDown(w, w * 0.9, step);
    if (!down) return { w, r: lo, kind: "hold", line: `${said} ${fmtW(w)} is the lightest here. Rest longer, then go for ${lo} with a slower lowering.` };
    return { w: down, r: lo, kind: "down", line: `${said} Missed rep, it happens. Take ${fmtW(down)} and get ${lo} clean.` };
  }

  // Effort estimate for this set: counts reps left in the tank when the lifter logs RIR (else assumes ~1).
  const max = e1rm(load, r + (rir ?? 1));
  const todayBest = Math.max(...done.map((x) => e1rm(+x.w, +x.r)));
  // 1.00 = matching your best. Today's sets are counted as if fresh (best should be fresh-equivalent too).
  const form = best > 0 && w > 0 ? freshMax(todayBest, fatigueLoad, k) / best : null;
  const offDay = form != null && form < 0.9 && done.length === 1;
  const onFire = form != null && form >= 0.98;
  // Without an RIR rating the next set never asks for more reps than this one at the same weight.
  const ceiling = rir != null && rir >= 2 ? r + 1 : r;

  // Bodyweight only: reps are the only lever.
  if (w === 0) {
    if (r >= hi + 2) {
      const t = clamp(r - drop, lo, r);
      return { w: 0, r: t, kind: "hold", line: `${said} Past your ${lo}–${hi}. Keep every rep strict and aim for ${t}; next session add a little weight.${finisher}` };
    }
    if (r < lo) {
      const t = Math.max(1, Math.min(r, r - drop + 1));
      return { w: 0, r: t, kind: "hold", line: `${said} Under your ${lo}–${hi}: get ${t}, then finish with slow lowering reps (3–5 s down) to reach ${lo}.${finisher}` };
    }
    const t = clamp(r - drop + (lastSet ? 1 : 0), Math.min(lo, r), ceiling);
    return { w: 0, r: t, kind: "hold", line: `${said} Aim for ${t} next.${finisher}` };
  }

  // Too light: past the top with reps to spare (or RIR says so). Go heavier, in plate steps.
  if (r >= hi + 2 || (rir != null && r + rir >= hi + 2)) {
    const up = stepUp(w, loadFor(max, Math.max(lo, hi - 2)) - extra, step);
    const t = clamp(repsAt(max, up + extra) - (rir == null ? 1 : 0), lo, hi);
    return { w: up, r: t, kind: "up", line: `${said} Too light to grow from. Go ${fmtW(up)} and get ${t}.${finisher}` };
  }

  // Went lighter than asked and still hit the top: the asked weight is there. Go back up.
  if (r >= hi && asked && +asked.w > w && repsAt(max, +asked.w + extra) >= lo) {
    const t = clamp(repsAt(max, +asked.w + extra) - (rir == null ? 1 : 0), lo, hi);
    return { w: +asked.w, r: t, kind: "up", line: `${said} ${r} at ${fmtW(w)} says ${fmtW(+asked.w)} is there. Go back up and get ${t}.${finisher}` };
  }

  // At the top of the range: hold; every set up here earns more weight next time.
  if (r >= hi) {
    const t = clamp(hi - (lastSet ? 0 : Math.min(drop, 1)), lo, ceiling);
    const aim = t === hi ? `get ${hi} again` : `aim for ${hi} again (${t} is still a good set)`;
    return { w, r: t, kind: "hold", line: `${said} Top of the range. Stay at ${fmtW(w)} and ${aim}: every set at ${hi} means more weight next time.${finisher}` };
  }

  // Well under the range, or under it at failure: too heavy for quality reps. Drop to land in range.
  if (r < lo - 1 || (r < lo && rir === 0)) {
    const down = stepDown(w, loadFor(e1rm(load, r), lo + 1) - extra, step);
    if (!down) return { w, r: Math.max(1, Math.min(r, lo)), kind: "hold", line: `${said} ${fmtW(w)} is the lightest here. Get ${r}, rest 15 s, then finish to ${lo} (rest-pause).${finisher}` };
    const t = clamp(repsAt(e1rm(load, r), down + extra) - 1, lo, hi);
    return { w: down, r: t, kind: "down", line: `${said} Below your ${lo}–${hi}. Drop to ${fmtW(down)} and get ${t} clean reps.${finisher}` };
  }

  // In range (or one short). Expect the usual drop; push a rep only with room to spare.
  let t = r - drop;
  if (rir != null && rir >= 2) t += 1; // they had more in them
  if (onFire && !lastSet && next && +next.w === w) t = Math.max(t, next.r + 1); // a day to beat last time
  if (lastSet) t = Math.max(t, r - drop + 1); // the last set goes closer to failure
  t = clamp(t, lo, Math.max(lo, ceiling));
  const toFailure = rir === 0 && !lastSet ? " That one was to failure; leave a rep in the tank next set." : "";
  // Reps fell off a cliff at the same weight: usually not enough rest.
  const prev = done[done.length - 2];
  const cliff = prev && +prev.w === w && +prev.r - r >= Math.max(3, drop + 2) ? " That's a big drop from the last set: rest a full 2–3 min before the next one." : "";
  let why;
  if (offDay) why = `You're about ${Math.round((1 - form) * 100)}% under your best today. Normal off day: hold ${fmtW(w)}, own every rep, don't chase numbers.`;
  else if (r < lo) why = `One short of your range. Stay at ${fmtW(w)} and fight for ${lo}; if it's a grind, drop to ${fmtW(stepDown(w, w - step, step) ?? w)}.`;
  else if (vsAsk != null && vsAsk < 0 && lateNote) why = `That's the earlier sets, not your strength. Stay at ${fmtW(w)} and bank ${t} solid reps.`;
  else if (vsAsk != null && vsAsk < 0 && done.length === 1) why = `Not a PR day, and that's fine. Stay at ${fmtW(w)} and bank ${t} solid reps.`;
  else if (vsAsk != null && vsAsk < 0) why = `Fatigue's normal. Stay at ${fmtW(w)} and get ${t}.`;
  else if (onFire && !lastSet) why = `You're strong today. Stay at ${fmtW(w)} and push for ${t}.`;
  else why = `Stay at ${fmtW(w)} and get ${t}.`;
  return { w, r: r < lo ? lo : t, kind: "hold", line: `${said} ${why}${toFailure}${cliff}${finisher}` };
}
