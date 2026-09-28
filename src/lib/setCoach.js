import { e1rm, fmtW, weightStep, isIsolation, nextGoal, readyToIncrease, lifting } from "./util.js";

/* The in-workout coach: after every logged set, what the next set should be and why.
   Runs on the phone (instant, works on gym wifi), from rules a good hypertrophy coach uses:

   - Double progression inside the lift's rep range: reps first, then weight.
   - Work sets should end about 1-2 reps short of failure (RIR 1-2). Too easy means go heavier;
     well short of the range means the weight is too heavy, so drop it and get quality reps.
   - Reps fall off set to set at the same weight. How much is learned from this lifter's own
     history on this lift (default 1), so "7 after 8" isn't read as a failure.
   - Today's form matters: the best set so far is compared with the all-time best (estimated
     1-rep max), so a PR is only chased on a day it's on, and an off day gets told to bank
     quality sets instead of grinding.
   Weights are predicted with Epley (e1RM = w × (1 + r/30)) and rounded to the lift's plate step. */

const round = (w, step) => Math.max(0, Math.round(w / step) * step);
const floorTo = (w, step) => Math.max(0, Math.floor(w / step) * step);
/** Reps you'd get at weight w, given an estimated 1-rep max (Epley, inverted). */
const repsAt = (max, w) => (w > 0 ? Math.floor(30 * (max / w - 1) + 1e-9) : 0);
/** The weight that should give `r` reps for an estimated 1-rep max. */
const weightFor = (max, r) => max / (1 + r / 30);

/** Typical rep drop between back-to-back sets at the same weight, from this lift's history (0-3, default 1). */
export function fatigueDrop(history) {
  const drops = [];
  for (const sets of history.slice(0, 6)) {
    const l = lifting(sets);
    for (let i = 1; i < l.length; i++) if (l[i].w === l[i - 1].w && l[i].w > 0) drops.push(l[i - 1].r - l[i].r);
  }
  if (drops.length < 3) return 1;
  const avg = drops.reduce((a, d) => a + d, 0) / drops.length;
  return Math.min(3, Math.max(0, Math.round(avg)));
}

/** Reps left in the tank for a set: the lifter's RIR if given, else unknown (null). */
const rirOf = (s) => (s.rir != null && s.rir !== "" && Number.isFinite(+s.rir) ? +s.rir : null);

/**
 * Advice before the first set: last time's numbers, the goal for today, and warm-ups for the first
 * heavy lift of the day. Returns { w, r, line } or null for a first-ever lift.
 */
export function openingAdvice({ ex, history, firstLift }) {
  const last = history[0];
  if (!last?.length) return null;
  const l = lifting(last);
  const bump = readyToIncrease(ex, last);
  const goal = bump ? { w: bump.to, r: ex.reps[0] } : nextGoal(ex, last);
  if (!goal) return null;
  const lastLine = `Last time ${fmtW(l[0].w)} × ${l.map((s) => s.r).join(", ")}.`;
  const aim = bump
    ? `You earned it: ${fmtW(bump.to)} lb today. Aim for ${ex.reps[0]}+ on set 1.`
    : `Beat it by one: ${fmtW(goal.w)} × ${goal.r}${goal.sets > 1 ? ` on ${goal.sets} sets` : ""}.`;
  // Warm-ups: the first compound lift of the day at a real load.
  const warm = firstLift && !isIsolation(ex.n) && goal.w >= 60
    ? ` Warm up first: ${fmtW(round(goal.w * 0.5, weightStep(ex.n)))} × 8, then ${fmtW(round(goal.w * 0.75, weightStep(ex.n)))} × 4.`
    : "";
  return { w: goal.w, r: goal.r, line: `${lastLine} ${aim}${warm}` };
}

/**
 * What the next set should be, after a set is logged.
 *   ex:       the program entry ({ n, sets, reps: [lo, hi] })
 *   done:     today's logged sets for this lift, in order ({ w, r, rir? }), the new one last
 *   asked:    what the coach had asked for on that set ({ w, r }), if anything
 *   left:     sets still to do after this one
 *   history:  earlier sessions' sets for this lift, newest first (arrays of { w, r })
 *   best:     all-time best estimated 1-rep max before today (0 if none)
 *   pr:       whether the set just logged was a PR
 * Returns { w, r, line, kind } for the next set, or, when no sets are left, { line, kind: "done" }.
 */
export function nextSetAdvice({ ex, done, asked, left, history = [], best = 0, pr = false }) {
  const [lo, hi] = ex.reps;
  const s = done[done.length - 1];
  const w = +s.w, r = +s.r;
  const rir = rirOf(s);
  const step = weightStep(ex.n);
  const drop = fatigueDrop(history);
  const lastTime = lifting(history[0] || []);
  const same = lastTime[done.length - 1]; // this set, last session
  const next = lastTime[done.length]; // next set, last session
  const bodyweight = w === 0;
  const todayBest = Math.max(...done.map((x) => e1rm(+x.w, +x.r)));
  const form = best > 0 && !bodyweight ? todayBest / best : null; // 1.00 = matching your best
  // An effort estimate for this set, counting reps left in the tank when the lifter logs RIR.
  const max = e1rm(w, r + (rir ?? 1));

  // What was said about the set just done.
  const vsAsk = asked && +asked.w === w && asked.r ? r - asked.r : null;
  const vsLast = same && same.w === w ? r - same.r : null;
  let said;
  if (pr) said = `PR: ${fmtW(w)} × ${r}!`;
  else if (vsAsk != null && vsAsk >= 0) said = vsAsk > 0 ? `${r}, ${vsAsk} past the target.` : `${r}, right on target.`;
  else if (vsAsk != null) said = `${r}, ${-vsAsk} short of ${asked.r}.`;
  else if (vsLast != null) said = vsLast > 0 ? `${r}, ${vsLast} more than last time.` : vsLast === 0 ? `${r}, same as last time.` : `${r} today vs ${same.r} last time.`;
  else said = `${fmtW(w)} × ${r}.`;

  // No sets left: wrap up with what next time should be.
  if (left <= 0) {
    const earned = done.length >= ex.sets && readyToIncrease(ex, done.map((x) => ({ w: +x.w, r: +x.r })));
    const goal = nextGoal(ex, done.map((x) => ({ w: +x.w, r: +x.r })));
    // "80 × 8, 7, 7" when the weight held; "80×6, 80×4, 70×7" when it changed.
    const sameW = done.every((x) => +x.w === +done[0].w);
    const reps = sameW ? `${fmtW(+done[0].w)} × ${done.map((x) => x.r).join(", ")}` : done.map((x) => `${fmtW(+x.w)}×${x.r}`).join(", ");
    const tail = earned ? `Every set at ${hi}: go up to ${fmtW(earned.to)} lb next time.`
      : goal ? `Next time: ${fmtW(goal.w)} × ${goal.r}${goal.sets > 1 ? ` on ${goal.sets} sets` : " on set 1"}.` : "";
    return { kind: "done", line: `${said} Done: ${reps}. ${tail}`.trim() };
  }

  const lastSet = left === 1;
  const finisher = lastSet ? " Last set: take it to 1 rep short of failure." : "";
  const offDay = form != null && form < 0.9 && done.length === 1;
  const onFire = form != null && form >= 0.98;

  // Bodyweight lifts progress by reps only.
  if (bodyweight) {
    const target = Math.max(1, r - drop + (rir != null && rir >= 3 ? 1 : 0));
    return { w: 0, r: target, kind: "hold", line: `${said} Aim for ${target} next.${finisher}` };
  }

  // Way too light: past the top of the range with reps to spare. Go heavier.
  if (r >= hi + 2 || (rir != null && r + rir >= hi + 2)) {
    const up = round(Math.max(w + step, weightFor(max, Math.max(lo, hi - 2)) ), step);
    const target = Math.min(hi, Math.max(lo, repsAt(max, up) - (rir == null ? 1 : 0)));
    return { w: up, r: target, kind: "up", line: `${said} Too light to grow from. Go ${fmtW(up)} and get ${target}.${finisher}` };
  }

  // At the top of the range: hold the weight; every set up here earns more weight next time.
  if (r >= hi) {
    const target = Math.max(lo, hi - (lastSet ? 0 : Math.min(drop, 1)));
    const aim = target === hi ? `get ${hi} again` : `aim for ${hi} again (${target} is still a good set)`;
    return { w, r: target, kind: "hold", line: `${said} Top of the range. Stay at ${fmtW(w)} and ${aim}: every set at ${hi} means more weight next time.${finisher}` };
  }

  // Well under the range: the weight's too heavy for quality reps. Drop to land back in range.
  if (r < lo - 1 || (r < lo && rir === 0)) {
    const down = Math.min(w - step, floorTo(weightFor(e1rm(w, r), lo + 1), step));
    const target = Math.max(lo, Math.min(hi, repsAt(e1rm(w, r), down) - 1));
    return { w: down, r: target, kind: "down", line: `${said} Below your ${lo}–${hi}. Drop to ${fmtW(down)} and get ${target} clean reps.${finisher}` };
  }

  // In range (or one short of it). Expect the usual drop, pushed a rep when there's room.
  let target = r - drop;
  if (rir != null && rir >= 2) target += 1; // they had more in them
  if (onFire && !lastSet && next && next.w === w) target = Math.max(target, next.r + 1); // a day to beat last time
  if (lastSet) target = Math.max(target, r - drop + 1); // the last set goes closer to failure
  target = Math.max(lo, Math.min(hi, target));
  let why;
  if (offDay) why = `You're about ${Math.round((1 - form) * 100)}% under your best today. Normal off day: hold ${fmtW(w)}, own every rep, don't chase numbers.`;
  else if (vsAsk != null && vsAsk < 0 && done.length === 1) why = `Not a PR day, and that's fine. Stay at ${fmtW(w)} and bank ${target} solid reps.`;
  else if (vsAsk != null && vsAsk < 0) why = `Fatigue's normal. Stay at ${fmtW(w)} and get ${target}.`;
  else if (onFire && !lastSet) why = `You're strong today. Stay at ${fmtW(w)} and push for ${target}.`;
  else if (r < lo) why = `One short of your range. Stay at ${fmtW(w)} and fight for ${lo}; if it's a grind, drop to ${fmtW(w - step)}.`;
  else why = `Stay at ${fmtW(w)} and get ${target}.`;
  return { w, r: r < lo ? lo : target, kind: "hold", line: `${said} ${why}${finisher}` };
}
