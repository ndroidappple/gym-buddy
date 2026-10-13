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

/**
 * What was done before `lift`, given as [{ n, sets }] (sets: logged work sets): the fatigue load,
 * and the sets behind it by muscle ({ biceps: 3, back: 10 }), so a note can name the real work.
 */
export function loadParts(earlier, lift) {
  let load = 0;
  const sets = {};
  for (const { n, sets: logged } of earlier) {
    if (n === lift || isCardio(n)) continue;
    const o = overlap(lift, n);
    const count = lifting(logged).length;
    if (!o || !count) continue;
    load += (o === 2 ? 1 : 0.5) * count;
    const m = muscleOf(n);
    sets[m] = (sets[m] || 0) + count;
  }
  return { load, sets };
}

/** Fatigue load before `lift` from lifts done earlier, given as [{ n, sets }]. */
export const loadFrom = (earlier, lift) => loadParts(earlier, lift).load;

/** What was done before `lift` in a saved session ({ load, sets }, as loadParts). */
export function partsIn(session, lift) {
  const order = doneOrder(session);
  const i = order.indexOf(lift);
  return loadParts(order.slice(0, Math.max(0, i)).map((n) => ({ n, sets: session.sets[n] })), lift);
}

/** Fatigue load before `lift` in a saved session. */
export const loadIn = (session, lift) => partsIn(session, lift).load;

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
    const { load, sets } = partsIn(s, lift);
    return { id: s.id, date: s.date, orm, load, before: sets, fresh: freshMax(orm, load, k) };
  });
}

/**
 * The note on a late lift (null when fresh-ish), naming the sets actually done: "after 9 chest
 * sets", or for curls after rows and pulldowns "after 10 back sets", not "4 biceps sets" (a set
 * for a helper muscle counts half in the load, but the lifter did 10 back sets, not 4 curls).
 * `sets` is the breakdown from loadParts; without it, the load is named for the lift's own muscle.
 */
export function loadNote(load, lift, sets = null) {
  if (load < 3) return null;
  const own = muscleOf(lift);
  // The lift's own muscle first, then the helpers, most sets first.
  const parts = sets && Object.keys(sets).length
    ? Object.entries(sets).sort(([a, x], [b, y]) => (b === own) - (a === own) || y - x)
    : [[own, Math.round(load)]];
  const say = ([m, n]) => `${n} ${MUSCLE_LABEL[m] || m} set${n === 1 ? "" : "s"}`;
  return `after ${parts.length > 1 ? `${parts.slice(0, -1).map(say).join(", ")} and ${say(parts.at(-1))}` : say(parts[0])}`;
}

/** Reps you'd likely get at weight w with `load` behind you, from a fresh-equivalent max. */
export function repsWithLoad(freshOrm, w, load, k = DEFAULT_K) {
  if (!(w > 0)) return null;
  const max = freshOrm * freshness(load, k);
  return Math.max(1, Math.floor(30 * (max / w - 1) + 1e-9));
}

