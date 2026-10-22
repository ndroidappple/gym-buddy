import { isCardioSet } from "./util.js";

/* Heart rate during a workout, from the lifter's watch through Google Health (see googleHealth.js).
   The readings aren't kept: a workout keeps a summary (session.hr) and each set its peak (set.hr),
   worked out here. Sets know when they were done (set.t, from when that was recorded). */

/** Estimated max heart rate for an age (Tanaka: 208 - 0.7 × age), or null without one. */
export const maxHrFor = (age) => (age >= 13 && age <= 100 ? Math.round(208 - 0.7 * age) : null);

// Zones as a share of max heart rate: 50-60, 60-70, 70-80, 80-90, 90+ %.
export const ZONES = [0.5, 0.6, 0.7, 0.8, 0.9];
export const HARD = 0.8; // "hard" minutes: at or above 80 % of max

const GAP_MS = 15_000; // a reading stands for at most 15 s (watches read every 1-5 s while working out)
// A set's peak: from shortly before the lift was marked done until shortly after (heart rate climbs
// through the set and tops out just after it).
const BEFORE_MS = 45_000, AFTER_MS = 30_000;
// Readings that reach this close to the end make the workout's data complete.
const ENDS_MS = 3 * 60_000;

const round = (x) => Math.round(x);

/**
 * The workout's heart rate from readings [[ms, bpm], ...] (any order). Returns
 * { summary, sets } or null with no readings in the workout:
 *   summary: { avg, max, low, hard, zones, maxHr, n, complete }: hard and zones in minutes (zones
 *            and hard only with a max heart rate), `complete` once readings reach the end.
 *   sets: { lift: [peak or null, ...] } for sets that know when they were done.
 */
export function summarize(readings, session, maxHr = null) {
  const start = session.startedAt, end = session.finishedAt;
  if (!start || !end || end <= start) return null;
  const xs = readings.filter(([t, b]) => t >= start && t <= end && b > 25 && b < 250).sort((a, b) => a[0] - b[0]);
  if (!xs.length) return null;

  let weighted = 0, total = 0, max = 0, low = Infinity;
  const zoneMs = ZONES.map(() => 0);
  let hardMs = 0;
  xs.forEach(([t, b], i) => {
    const dur = Math.min((xs[i + 1]?.[0] ?? end) - t, GAP_MS);
    weighted += b * dur;
    total += dur;
    max = Math.max(max, b);
    low = Math.min(low, b);
    if (maxHr) {
      const z = ZONES.findLastIndex((f) => b >= f * maxHr);
      if (z >= 0) zoneMs[z] += dur;
      if (b >= HARD * maxHr) hardMs += dur;
    }
  });
  const minutes = (ms) => Math.round(ms / 6000) / 10;
  const summary = {
    avg: round(total ? weighted / total : xs[0][1]),
    max, low,
    ...(maxHr ? { maxHr, hard: minutes(hardMs), zones: zoneMs.map(minutes) } : {}),
    n: xs.length,
    complete: xs[xs.length - 1][0] >= end - ENDS_MS,
  };

  const sets = {};
  for (const [lift, list] of Object.entries(session.sets || {})) {
    if (!list?.some((s) => s.t)) continue;
    sets[lift] = list.map((s) => {
      if (!s.t || isCardioSet(s)) return null;
      const near = readings.filter(([t]) => t >= s.t - BEFORE_MS && t <= s.t + AFTER_MS);
      return near.length ? Math.max(...near.map(([, b]) => b)) : null;
    });
  }
  return { summary, sets };
}

/** The session with its heart rate in: the summary on it, each set's peak on the set. */
export function withHeart(session, result, at = Date.now()) {
  if (!result) return { ...session, hr: { none: true, at } };
  const sets = Object.fromEntries(Object.entries(session.sets).map(([lift, list]) => [lift,
    result.sets[lift] ? list.map((s, i) => (result.sets[lift][i] != null ? { ...s, hr: result.sets[lift][i] } : s)) : list]));
  return { ...session, sets, hr: { ...result.summary, at } };
}

/**
 * Which workouts to ask Google Health about: ended at least 2 minutes ago and within `days`, and
 * either never asked, or asked before their readings were complete (asked again after 15 minutes,
 * for up to a day after the workout: watches can take a while to sync).
 */
export function wanting(sessions, now = Date.now(), days = 30) {
  return sessions.filter((s) => {
    if (!s.startedAt || !s.finishedAt || s.finishedAt > now - 2 * 60_000 || s.finishedAt < now - days * 86400_000) return false;
    if (s.finishedAt - s.startedAt > 6 * 3600_000) return false;
    if (!s.hr) return true;
    if (s.hr.complete) return false;
    if (s.hr.at - s.finishedAt > 24 * 3600_000) return false; // a day on, it's as complete as it gets
    return now - s.hr.at > 15 * 60_000;
  }).sort((a, b) => b.finishedAt - a.finishedAt);
}

/** A workout's heart rate in a few words, for the coaches: "heart rate avg 128, peak 171 (91% of est. max 186), 14 min hard". */
export function heartLine(s) {
  const h = s.hr;
  if (!h || h.none) return "";
  const bits = [`heart rate avg ${h.avg}, peak ${h.max}`];
  if (h.maxHr) bits[0] += ` (${Math.round((h.max / h.maxHr) * 100)}% of est. max ${h.maxHr})`;
  if (h.hard != null) bits.push(`${h.hard} min at 80%+ of max`);
  return bits.join(", ");
}
