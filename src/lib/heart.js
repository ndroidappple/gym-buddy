import { isCardioSet } from "./util.js";

/* Heart rate during a workout, from the lifter's watch through Google Health (see googleHealth.js).
   The account keeps a summary on the workout (session.hr) and, on each set, its peak and how far
   heart rate came down before the next set (set.hr, set.hrRest). The readings themselves stay on the
   phone that fetched them, for the chart (cacheCurve). Sets know when they were done (set.t). */

export const HR_VERSION = 2; // summaries made before Google's personal zones are worked out again

/** Estimated max heart rate for an age (Tanaka: 208 - 0.7 × age), or null without one. */
export const maxHrFor = (age) => (age >= 13 && age <= 100 ? Math.round(208 - 0.7 * age) : null);

/* Google Health's four zones, lightest first. Its own thresholds (personal to the lifter's fitness
   and age) come with the readings; without them, they're estimated as a share of max heart rate. */
export const ZONES = [
  { id: "light", label: "Light", est: 0.5 },
  { id: "moderate", label: "Moderate", est: 0.64 },
  { id: "vigorous", label: "Vigorous", est: 0.77 },
  { id: "peak", label: "Peak", est: 0.9 },
];
/** The bpm each zone starts at: [light, moderate, vigorous, peak], or null. */
export const estimatedBounds = (maxHr) => (maxHr ? ZONES.map((z) => Math.round(z.est * maxHr)) : null);
/** The zone a bpm is in (0-3), or -1 below light. */
export const zoneOf = (bpm, bounds) => (bounds ? bounds.findLastIndex((b) => bpm >= b) : -1);

const GAP_MS = 15_000; // a reading stands for at most 15 s (watches read every 1-5 s while working out)
// A set's peak: from shortly before it was marked done until shortly after (heart rate climbs through
// the set and tops out just after it).
export const BEFORE_MS = 45_000, AFTER_MS = 30_000;
// Readings that reach this close to the end make the workout's data complete.
const ENDS_MS = 3 * 60_000;

const sorted = (readings) => readings.filter(([, b]) => b > 25 && b < 250).sort((a, b) => a[0] - b[0]);
const maxIn = (xs, from, to) => { let m = 0; for (const [t, b] of xs) if (t >= from && t <= to && b > m) m = b; return m || null; };
const minIn = (xs, from, to) => { let m = Infinity; for (const [t, b] of xs) if (t >= from && t <= to && b < m) m = b; return m === Infinity ? null : m; };

/** Every set that knows when it was done, in the order they were done: [{ lift, i, t }]. */
export function timedSets(session) {
  return Object.entries(session.sets || {}).flatMap(([lift, list]) => list.map((s, i) => ({ lift, i, t: s.t, set: s })))
    .filter((x) => x.t && !isCardioSet(x.set)).sort((a, b) => a.t - b.t);
}

/**
 * The workout's heart rate from readings [[ms, bpm], ...] (any order) and the zone thresholds
 * (`bounds`, bpm each zone starts at; Google's when `source` is "google"). Returns { summary, sets }
 * or null with no readings in the workout:
 *   summary: { v, avg, max, low, bounds, source, zones: { light, moderate, vigorous, peak } (minutes),
 *              hard (vigorous + peak minutes), maxHr, n, complete }
 *   sets: { lift: [{ hr, hrRest } or null, ...] } for sets that know when they were done: the set's
 *         peak, and the lowest heart rate after it before the next set started.
 */
export function summarize(readings, session, { bounds = null, source = null, maxHr = null } = {}) {
  const start = session.startedAt, end = session.finishedAt;
  if (!start || !end || end <= start) return null;
  const all = sorted(readings);
  const xs = all.filter(([t]) => t >= start && t <= end);
  if (!xs.length) return null;

  let weighted = 0, total = 0, max = 0, low = Infinity;
  const zoneMs = ZONES.map(() => 0);
  xs.forEach(([t, b], i) => {
    const dur = Math.min((xs[i + 1]?.[0] ?? end) - t, GAP_MS);
    weighted += b * dur;
    total += dur;
    max = Math.max(max, b);
    low = Math.min(low, b);
    const z = zoneOf(b, bounds);
    if (z >= 0) zoneMs[z] += dur;
  });
  const minutes = (ms) => Math.round(ms / 6000) / 10;
  const summary = {
    v: HR_VERSION,
    avg: Math.round(total ? weighted / total : xs[0][1]),
    max, low,
    ...(bounds ? {
      bounds, source,
      zones: Object.fromEntries(ZONES.map((z, i) => [z.id, minutes(zoneMs[i])])),
      hard: minutes(zoneMs[2] + zoneMs[3]),
    } : {}),
    ...(maxHr ? { maxHr } : {}),
    n: xs.length,
    complete: xs[xs.length - 1][0] >= end - ENDS_MS,
  };

  const order = timedSets(session);
  const sets = {};
  order.forEach((x, k) => {
    const hr = maxIn(all, x.t - BEFORE_MS, x.t + AFTER_MS);
    // Rest: after the peak window until the next set got going (or the end of the workout).
    const next = order[k + 1]?.t ?? end + AFTER_MS;
    const hrRest = minIn(all, x.t + 10_000, next - BEFORE_MS);
    (sets[x.lift] ||= session.sets[x.lift].map(() => null))[x.i] = hr ? { hr, ...(hrRest && hrRest < hr ? { hrRest } : {}) } : null;
  });
  return { summary, sets };
}

/** The session with its heart rate in: the summary on it, each set's peak and rest low on the set. */
export function withHeart(session, result, at = Date.now()) {
  if (!result) return { ...session, hr: { v: HR_VERSION, none: true, at } };
  const sets = Object.fromEntries(Object.entries(session.sets).map(([lift, list]) => [lift,
    result.sets[lift] ? list.map((s, i) => {
      const r = result.sets[lift][i];
      if (!r) return s;
      const { hrRest, ...rest } = s; // a rest low from an earlier, less complete read goes
      return { ...rest, ...r };
    }) : list]));
  return { ...session, sets, hr: { ...result.summary, at } };
}

/**
 * Which workouts to ask Google Health about: ended at least 2 minutes ago and within `days`, and
 * either never asked, asked before this version, or asked before their readings were complete (asked
 * again after 15 minutes, for up to a day after the workout: watches can take a while to sync).
 */
export function wanting(sessions, now = Date.now(), days = 30) {
  return sessions.filter((s) => {
    if (!s.startedAt || !s.finishedAt || s.finishedAt > now - 2 * 60_000 || s.finishedAt < now - days * 86400_000) return false;
    if (s.finishedAt - s.startedAt > 6 * 3600_000) return false;
    if (!s.hr || s.hr.v !== HR_VERSION) return true;
    if (s.hr.complete) return false;
    if (s.hr.at - s.finishedAt > 24 * 3600_000) return false; // a day on, it's as complete as it gets
    return now - s.hr.at > 15 * 60_000;
  }).sort((a, b) => b.finishedAt - a.finishedAt);
}

/** The lift whose sets pushed heart rate highest (by average set peak), or null: { lift, avg }. */
export function hardestLift(session) {
  const lifts = Object.entries(session.sets || {}).map(([lift, list]) => {
    const peaks = list.map((s) => s.hr).filter(Boolean);
    return peaks.length ? { lift, avg: Math.round(peaks.reduce((a, b) => a + b, 0) / peaks.length) } : null;
  }).filter(Boolean);
  return lifts.length > 1 ? lifts.sort((a, b) => b.avg - a.avg)[0] : null;
}

/** A workout's heart rate in a few words, for the coaches. */
export function heartLine(s) {
  const h = s.hr;
  if (!h || h.none) return "";
  let line = `heart rate avg ${h.avg}, peak ${h.max}`;
  if (h.zones) {
    const zone = ZONES[zoneOf(h.max, h.bounds)]?.label;
    line += ` (${zone ? `${zone.toLowerCase()} zone` : "below light"}; zones ${h.source === "google" ? "from Google Health" : "estimated from age"}: moderate ${h.bounds[1]}+, vigorous ${h.bounds[2]}+, peak ${h.bounds[3]}+)`;
    line += `, minutes light/moderate/vigorous/peak ${ZONES.map((z) => h.zones[z.id]).join("/")}`;
  }
  return line;
}

/* ── the readings, on this phone only, for the chart ── */

const CURVES = "gymbuddy-hr-curves";
const KEEP = 40; // workouts' readings kept on the phone

/** Readings down to one per 5 s (the chart's resolution), as [[ms, bpm], ...]. */
export function thin(readings) {
  const steps = new Map();
  for (const [t, b] of sorted(readings)) { const k = Math.floor(t / 5000) * 5000; const s = steps.get(k) || [0, 0]; steps.set(k, [s[0] + b, s[1] + 1]); }
  return [...steps].map(([t, [sum, n]]) => [t, Math.round(sum / n)]);
}
const readCurves = () => { try { return JSON.parse(localStorage.getItem(CURVES)) || {}; } catch { return {}; } };
/** Keeps a workout's readings on this phone (the newest KEEP workouts). */
export function cacheCurve(id, readings) {
  const all = readCurves();
  all[id] = { at: Date.now(), r: thin(readings) };
  const keep = Object.fromEntries(Object.entries(all).sort(([, a], [, b]) => b.at - a.at).slice(0, KEEP));
  try { localStorage.setItem(CURVES, JSON.stringify(keep)); } catch {}
}
export const cachedCurve = (id) => readCurves()[id]?.r || null;
