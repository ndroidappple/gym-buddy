import { totals, byDate, addDays, GOALS } from "./nutrition.js";
import { today, weekDates, daysBetween } from "./util.js";

/* Nutrition over time, for Progress → Nutrition: how what the lifter ate compares with their targets,
   and whether it's doing what the goal needs. The rules match the week in review (weekReview.js) so the
   two never disagree: a day under 45% of the calorie target is most likely only partly logged and is
   left out of every average; calories within 10% of target are on target; protein at 90%+ is a hit.
   Today is never counted: it isn't over yet. */

export const PARTIAL = 0.45;
export const KCAL_BAND = 0.1;
export const PROTEIN_HIT = 0.9;
const LB_KCAL = 3500;

/* ── Targets over time ──
   Targets change (a new goal, a bulk or cut), and an old day should be judged against the targets it
   was eaten under. Each save adds { from, kcal, protein, carbs, fat, rate } to nutrition.history. Days
   before the first saved entry fall back to the earliest known targets. */

const TARGET_KEYS = ["kcal", "protein", "carbs", "fat", "burn", "rate"];
const pickTargets = (t) => Object.fromEntries(TARGET_KEYS.filter((k) => t?.[k] != null).map((k) => [k, t[k]]));

/** The nutrition prefs to save: `next`, with its targets added to the history from `date` on. */
export function withTargetHistory(prev, next, date = today()) {
  const history = (prev?.history || []).filter((h) => h.from !== date);
  if (!next?.targets) return { ...next, history };
  const last = history[history.length - 1];
  const t = pickTargets(next.targets);
  const same = last && TARGET_KEYS.every((k) => last[k] === t[k]);
  return { ...next, history: same ? history : [...history, { from: date, ...t }].slice(-60) };
}

/** The targets in force on `date`: the latest saved on or before it, else the earliest known, else current. */
export function targetsOn(n, date) {
  const h = (n?.history || []).filter((x) => x.from <= date);
  if (h.length) return h[h.length - 1];
  return n?.history?.[0] || n?.targets || null;
}

/** Whether any day in from..to is judged against targets saved later than it (they weren't kept then). */
export const targetsBackfilled = (n, from) => !n?.history?.length || n.history[0].from > from;

/** Which side of the calorie target works against the goal: over for a cut, under for a bulk, both to maintain. */
export function wrongSide(n, t) {
  const rate = t?.rate ?? GOALS.find((g) => g.id === n?.goal)?.rate ?? 0;
  return rate < 0 ? "over" : rate > 0 ? "under" : "both";
}

/* ── Days ── */

/** One row per day from..to: what was eaten, the day's targets, and how it compares. */
export function dailyRows(entries, n, from, to) {
  const m = byDate(entries);
  const rows = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const de = m[d] || [];
    const x = totals(de);
    const t = targetsOn(n, d);
    const logged = de.length > 0;
    const partial = logged && !!t && x.kcal < t.kcal * PARTIAL;
    const full = logged && !partial;
    const kcalOff = full && t ? (x.kcal - t.kcal) / t.kcal : null;
    rows.push({
      date: d, logged, partial, full, t,
      kcal: Math.round(x.kcal), protein: Math.round(x.protein), carbs: Math.round(x.carbs), fat: Math.round(x.fat),
      kcalStatus: kcalOff == null ? null : kcalOff > KCAL_BAND ? "over" : kcalOff < -KCAL_BAND ? "under" : "on",
      proteinHit: full && t ? x.protein >= t.protein * PROTEIN_HIT : null,
    });
  }
  return rows;
}

const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
const round = (x, to = 1) => (x == null ? null : Math.round(x / to) * to);

/**
 * The period in numbers. Averages are over fully logged days only; targets are averaged the same way, so
 * a period that spans a target change compares like with like.
 */
export function summarize(rows) {
  const full = rows.filter((r) => r.full);
  const avg = (k) => round(mean(full.map((r) => r[k])));
  const avgT = (k) => round(mean(full.map((r) => r.t?.[k]).filter((v) => v != null)));
  const kcal = avg("kcal"), targetKcal = avgT("kcal");
  return {
    days: rows.length, logged: rows.filter((r) => r.logged).length, full: full.length,
    partial: rows.filter((r) => r.partial).length,
    kcal, targetKcal, kcalDiff: kcal != null && targetKcal != null ? kcal - targetKcal : null,
    protein: avg("protein"), targetProtein: avgT("protein"),
    carbs: avg("carbs"), targetCarbs: avgT("carbs"), fat: avg("fat"), targetFat: avgT("fat"),
    kcalOn: full.filter((r) => r.kcalStatus === "on").length,
    kcalOver: full.filter((r) => r.kcalStatus === "over").length,
    kcalUnder: full.filter((r) => r.kcalStatus === "under").length,
    proteinHit: full.filter((r) => r.proteinHit).length,
  };
}

/** Sunday-first weeks over the rows, newest first: each week's averages and how many days were logged. */
export function weekRows(rows) {
  const weeks = new Map();
  for (const r of rows) {
    const start = weekDates(new Date(r.date + "T12:00:00"))[0];
    if (!weeks.has(start)) weeks.set(start, []);
    weeks.get(start).push(r);
  }
  return [...weeks.entries()].map(([start, rs]) => ({ start, end: rs[rs.length - 1].date, ...summarize(rs) }))
    .filter((w) => w.logged).reverse();
}

/**
 * Where the eating differs: weekends against weekdays, and training against rest days, in average
 * calories over fully logged days. Only a gap of 100+ kcal with 2+ days on each side is worth saying.
 */
export function patterns(rows, sessions = []) {
  const full = rows.filter((r) => r.full);
  const trained = new Set(sessions.map((s) => s.date));
  const weekday = (d) => new Date(d + "T12:00:00").getDay();
  const split = (id, test, a, b) => {
    const yes = full.filter(test), no = full.filter((r) => !test(r));
    if (yes.length < 2 || no.length < 2) return null;
    const ya = round(mean(yes.map((r) => r.kcal))), na = round(mean(no.map((r) => r.kcal)));
    return Math.abs(ya - na) >= 100 ? { id, a, b, aKcal: ya, bKcal: na, diff: ya - na, aDays: yes.length, bDays: no.length } : null;
  };
  return [
    split("weekend", (r) => [0, 6].includes(weekday(r.date)), "Weekends", "weekdays"),
    split("training", (r) => trained.has(r.date), "Training days", "rest days"),
  ].filter(Boolean);
}

/**
 * Is it working: the bodyweight trend over the period (a least-squares line through the weigh-ins,
 * lb/week) against the goal's pace, the daily burn the food log and the scale imply together (average
 * intake minus the trend's calories), and from that burn the daily calories that would hold the goal's
 * pace (`needs`). The trend needs 3+ weights spanning 10+ days; the burn also needs 10+ fully logged
 * days. Without a measured burn, `impliedRate` is what the eating points to by the setup's estimate.
 */
export function outcome(rows, bw, n) {
  const from = rows[0]?.date, to = rows[rows.length - 1]?.date;
  const pts = (bw || []).filter((p) => p.date >= from && p.date <= to);
  const s = summarize(rows);
  const t = targetsOn(n, to);
  const goalRate = t?.rate ?? null;
  let perDay = null; // lb a day, unrounded
  if (pts.length >= 3 && daysBetween(pts[0].date, pts[pts.length - 1].date) >= 10) {
    const xs = pts.map((p) => daysBetween(from, p.date)), ys = pts.map((p) => p.bw);
    const mx = mean(xs), my = mean(ys);
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    if (den) perDay = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den;
  }
  const rate = perDay == null ? null : Math.round(perDay * 7 * 10) / 10;
  const burn = perDay != null && s.full >= 10 && s.kcal != null ? round(s.kcal - perDay * LB_KCAL, 10) : null;
  const needs = burn != null && goalRate != null ? round(burn + (goalRate / 7) * LB_KCAL, 10) : null;
  const impliedRate = burn == null && t?.burn && s.kcal != null ? Math.round(((s.kcal - t.burn) * 7 / LB_KCAL) * 10) / 10 : null;
  return { rate, goalRate, weights: pts.length, burn, estimatedBurn: t?.burn ?? null, needs, impliedRate };
}

/** The foods that brought the most calories over the rows' dates: name, times logged, kcal a day, share. */
export function topFoods(entries, rows, k = 5) {
  const from = rows[0]?.date, to = rows[rows.length - 1]?.date;
  const days = rows.filter((r) => r.logged).length || 1;
  const es = entries.filter((e) => e.date >= from && e.date <= to);
  const all = totals(es).kcal || 1;
  const m = {};
  for (const e of es) {
    const key = (e.name || "").trim().toLowerCase();
    const f = (m[key] ||= { name: (e.name || "").trim(), times: 0, kcal: 0 });
    f.times++; f.kcal += +e.kcal || 0;
  }
  return Object.values(m).sort((a, b) => b.kcal - a.kcal).slice(0, k)
    .map((f) => ({ name: f.name, times: f.times, perDay: Math.round(f.kcal / days), share: Math.round((f.kcal / all) * 100) }));
}

/** The period to look at: `days` days ending yesterday, starting no earlier than the first logged day. */
export function periodRange(entries, days, end = addDays(today(), -1)) {
  const first = entries.reduce((a, e) => (!a || e.date < a ? e.date : a), null);
  const from = addDays(end, -(days - 1));
  return { from: first && first > from ? first : from, to: end };
}
