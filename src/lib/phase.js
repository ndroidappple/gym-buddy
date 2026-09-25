import { bodyweightSeries, daysBetween, today, num, bestE1rm } from "./util.js";

/* Bulk and cut phases: a short-term bodyweight goal with a start, an end and a weekly rate.
   Pace comes from the weight trend (least-squares slope since the start), never one weigh-in,
   and there's no verdict until the trend has enough points to mean something. */

export const PHASE_TYPES = { bulk: { label: "Bulk", verb: "gain" }, cut: { label: "Cut", verb: "lose" } };
/** Sensible weekly change as a share of bodyweight. Outside it the coach warns but doesn't block. */
export const RATE_BOUNDS = { bulk: [0.0025, 0.005], cut: [0.005, 0.01] };
export const DEFAULT_WEEKS = { bulk: 12, cut: 8 };
/** During a phase the weigh-in nudge comes back after this many days (2-3 times a week). */
export const PHASE_WEIGH_EVERY = 3;

const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const round1 = (x) => Math.round(x * 10) / 10;

/** Builds a phase from either a target weight or a weekly rate (lb/week, signed). */
export function planPhase({ type, start, startWeight, weeks, target, rate }) {
  const w = Number(weeks) || DEFAULT_WEEKS[type];
  let r = rate != null && rate !== "" ? Number(rate) : null;
  let t = target != null && target !== "" ? Number(target) : null;
  if (r != null) r = type === "cut" ? -Math.abs(r) : Math.abs(r);
  if (t == null && r != null) t = round1(startWeight + r * w);
  if (r == null && t != null) r = round1((t - startWeight) / w * 100) / 100;
  if (t == null || r == null) return null;
  return { type, start, startWeight, target: t, rate: Math.round(r * 100) / 100, weeks: w, end: addDays(start, w * 7) };
}

/** Plain-English check of a rate against the sensible range, or null when it's fine. */
export function rateWarning(type, rate, weight) {
  if (!weight || !rate) return null;
  const pct = Math.abs(rate) / weight;
  const [lo, hi] = RATE_BOUNDS[type];
  const wrongWay = type === "cut" ? rate > 0 : rate < 0;
  if (wrongWay) return `A ${PHASE_TYPES[type].label.toLowerCase()} should ${PHASE_TYPES[type].verb} weight.`;
  if (pct > hi) return `That's ${(Math.ceil(pct * 1000) / 10).toFixed(1)}% of your bodyweight a week. Over ${hi * 100}% tends to cost ${type === "cut" ? "muscle and strength" : "extra fat"}.`;
  if (pct < lo / 2) return `That's a slow ${type}. Fine if you're patient; it'll be hard to see on the scale.`;
  return null;
}

/** Least-squares slope in lb/week over the points since `start`, or null with too little data. */
function trendRate(points) {
  if (points.length < 3) return null;
  const t0 = points[0].date;
  const xs = points.map((p) => daysBetween(t0, p.date) / 7), ys = points.map((p) => p.bw);
  const span = xs[xs.length - 1] - xs[0];
  if (span < 1) return null; // under a week of data says nothing
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const num_ = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0), den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return den ? num_ / den : null;
}

/** Where a phase stands today. status: "early" | "on" | "ahead" | "behind" | "fast" (cut too quick) | "done". */
export function phaseStatus(phase, sessions, weighins, on = today()) {
  const days = Math.max(0, daysBetween(phase.start, on));
  const week = Math.min(phase.weeks, Math.floor(days / 7) + 1);
  const points = bodyweightSeries(sessions, weighins).filter((p) => p.date >= phase.start && p.date <= on);
  const latest = points[points.length - 1];
  const current = latest?.bw ?? phase.startWeight;
  const expected = round1(phase.startWeight + phase.rate * (days / 7));
  const pts = [{ date: phase.start, bw: phase.startWeight }, ...points.filter((p) => p.date > phase.start)];
  const actual = trendRate(pts);
  const reached = phase.type === "cut" ? current <= phase.target : current >= phase.target;
  let status = "early";
  if (on >= phase.end || reached) status = "done";
  else if (actual != null) {
    const tol = Math.max(0.25, Math.abs(phase.rate) * 0.35); // lb/week of slack either side
    const gap = (actual - phase.rate) * (phase.type === "cut" ? -1 : 1); // + = faster than planned
    const tooFast = phase.type === "cut" && Math.abs(actual) / current > RATE_BOUNDS.cut[1] * 1.25;
    status = tooFast ? "fast" : gap > tol ? "ahead" : gap < -tol ? "behind" : "on";
  }
  const behindFor = status === "behind" ? Math.floor(days / 7) : 0; // weeks of data while behind
  return { days, week, weeks: phase.weeks, current, expected, actual: actual == null ? null : Math.round(actual * 100) / 100, status, reached, behindFor, points };
}

const signed = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${num(Math.abs(x))}`;
/** One line for the phase card and the coach's check-in. */
export function statusLine(phase, s) {
  if (s.status === "done") return s.reached ? `Target hit: ${num(s.current)} lb.` : `Phase over: ${num(s.current)} lb.`;
  if (s.status === "early") return `${num(s.current)} lb. A few more weigh-ins and I can read your pace.`;
  const pace = `${signed(s.actual)} lb/wk`;
  return {
    on: `${num(s.current)} lb, on pace (${pace}).`,
    ahead: `${num(s.current)} lb, ahead of pace (${pace}).`,
    behind: `${num(s.current)} lb, behind pace (${pace} vs ${signed(phase.rate)}).`,
    fast: `${num(s.current)} lb, dropping fast (${pace}). Ease the deficit so your lifts hold.`,
  }[s.status];
}

/** The coach's single check-in line; the cardio suggestion is offered separately, once. */
export function coachNote(phase, s) {
  if (s.status === "behind") return phase.type === "cut" ? "Scale's slow. Tighten the food a little before anything else." : "Gaining slower than planned. Add a little food; training's fine.";
  if (s.status === "fast") return "Too fast. Eat a bit more so your strength holds.";
  if (s.status === "ahead") return phase.type === "bulk" ? "Gaining quicker than planned. Pull the food back slightly to keep it lean." : "Ahead of pace. Keep the heavy lifts heavy.";
  if (s.status === "on") return phase.type === "cut" ? "Right on pace. Keep the heavy lifts heavy." : "Right on pace. Keep pushing the weights up.";
  return null;
}

/** Only one program change is ever proposed: a cardio finisher on a cut that's been behind 2+ weeks. */
export const wantsFinisher = (phase, s, program) =>
  phase.type === "cut" && s.status === "behind" && s.behindFor >= 2 && !phase.finisherAsked &&
  !Object.values(program).some((d) => !d.off && d.exercises?.some((e) => e.finisher));

/** Is a weigh-in due? Weekly normally; every few days during a phase. Daily is always allowed, never nudged. */
export const weighInEvery = (phase) => (phase && !phase.endedAt ? PHASE_WEIGH_EVERY : 7);

/** End-of-phase recap: weight change and how the main lifts' est. max moved over the phase. */
export function phaseSummary(phase, sessions, weighins, on = today()) {
  const s = phaseStatus(phase, sessions, weighins, on);
  const weeks = Math.max(1, s.days / 7);
  const inPhase = sessions.filter((x) => x.date >= phase.start && x.date <= on);
  const before = sessions.filter((x) => x.date < phase.start);
  const lifts = {};
  inPhase.forEach((x) => Object.entries(x.sets).forEach(([n, sets]) => { (lifts[n] ||= []).push(bestE1rm(sets)); }));
  const moved = Object.entries(lifts).map(([n, vals]) => {
    const prior = before.filter((x) => x.sets[n]).map((x) => bestE1rm(x.sets[n]));
    const from = prior.length ? prior[prior.length - 1] : vals[0];
    return { n, from, to: vals[vals.length - 1] };
  }).filter((l) => l.from > 0).sort((a, b) => b.from - a.from).slice(0, 3);
  return { from: phase.startWeight, to: s.current, perWeek: Math.round(((s.current - phase.startWeight) / weeks) * 10) / 10, weeks: Math.round(weeks), lifts: moved };
}
