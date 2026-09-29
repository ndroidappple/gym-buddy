import { lifting, bestE1rm, byDateAsc } from "./util.js";
import { overlap, muscleOf, MUSCLE_LABEL } from "./busy.js";
import { isCardio } from "../data/program.js";

/* Fatigue-aware comparisons. A lift done after other work for the same muscle performs worse than
   the same lift done fresh; that's fatigue, not lost strength. So every result gets:
   - `load`: the work done before it that session on the same muscle (1 per set) or a helper muscle
     (0.5 per set: triceps before a chest press, biceps before a row);
   - a fresh-equivalent estimated max: e1RM / (1 - k × load), where k is how much each earlier set
     costs this lifter on this lift. k is learned from their own history once there's enough spread
     in how late they've done it; until then about 1.2% a set. The cut is capped at 20%.
   Sessions saved since lift order was recorded use the real order; older ones use the order their
   lifts were logged in (the program order), which is the best guess there is. */

export const DEFAULT_K = 0.012;
const MAX_CUT = 0.2;

/** Lift names in the order they were done that session. */
export function doneOrder(session) {
  const names = Object.keys(session.sets || {});
  if (!session.order?.length) return names;
  const seen = session.order.map((o) => o.n).filter((n) => names.includes(n));
  return [...seen, ...names.filter((n) => !seen.includes(n))];
}

/** Fatigue load before `lift` from lifts done earlier, given as [{ n, sets }] (sets: logged work sets). */
export function loadFrom(earlier, lift) {
  let load = 0;
  for (const { n, sets } of earlier) {
    if (n === lift || isCardio(n)) continue;
    const o = overlap(lift, n);
    if (o) load += (o === 2 ? 1 : 0.5) * lifting(sets).length;
  }
  return load;
}

/** Fatigue load before `lift` in a saved session. */
export function loadIn(session, lift) {
  const order = doneOrder(session);
  const i = order.indexOf(lift);
  return loadFrom(order.slice(0, Math.max(0, i)).map((n) => ({ n, sets: session.sets[n] })), lift);
}

/** Share of strength left after `load` (1 = fresh). */
export const freshness = (load, k = DEFAULT_K) => 1 - Math.min(MAX_CUT, Math.max(0, k * load));
/** An estimated max as if done fresh. */
export const freshMax = (orm, load, k = DEFAULT_K) => orm / freshness(load, k);

/**
 * How much each earlier set costs this lifter on this lift: fitted from their history (least squares
 * of e1RM against load over the last 12 sessions), when there are 4+ sessions and the load has
 * varied by 3+ sets. Otherwise the default. Clamped to 0-2.5% a set.
 */
export function learnK(sessions, lift) {
  const pts = [...sessions].sort(byDateAsc).filter((s) => lifting(s.sets?.[lift]).length)
    .slice(-12).map((s) => ({ x: loadIn(s, lift), y: bestE1rm(s.sets[lift]) }));
  if (pts.length < 4) return DEFAULT_K;
  const xs = pts.map((p) => p.x);
  if (Math.max(...xs) - Math.min(...xs) < 3) return DEFAULT_K;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const den = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  if (!den || !my) return DEFAULT_K;
  const slope = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / den;
  const intercept = my - slope * mx; // e1RM when fresh
  return Math.min(0.025, Math.max(0, -slope / intercept));
}

/** A lift's history with its load and fresh-equivalent max per session, oldest first. */
export function adjustedSeries(sessions, lift, k = learnK(sessions, lift)) {
  return [...sessions].sort(byDateAsc).filter((s) => lifting(s.sets?.[lift]).length).map((s) => {
    const orm = bestE1rm(s.sets[lift]);
    const load = loadIn(s, lift);
    return { id: s.id, date: s.date, orm, load, fresh: freshMax(orm, load, k) };
  });
}

/** "after 9 chest sets" / "after 4 triceps sets" for the note on a late lift (null when fresh-ish). */
export function loadNote(load, lift) {
  if (load < 3) return null;
  return `after ${Math.round(load)} ${MUSCLE_LABEL[muscleOf(lift)]} set${Math.round(load) === 1 ? "" : "s"}`;
}

/** Reps you'd likely get at weight w with `load` behind you, from a fresh-equivalent max. */
export function repsWithLoad(freshOrm, w, load, k = DEFAULT_K) {
  if (!(w > 0)) return null;
  const max = freshOrm * freshness(load, k);
  return Math.max(1, Math.floor(30 * (max / w - 1) + 1e-9));
}

