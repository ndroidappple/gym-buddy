import { addDays } from "./nutrition.js";
import { bestE1rm, lifting, byDateAsc } from "./util.js";

/* Sleep and recovery from Google Health, kept on the account (state.recovery) as one small entry per
   morning: { "2026-10-22": { sleep: { asleep, inBed, awake, deep?, rem?, light?, start, end }, rhr, hrv } }.
   The date is the day the night ended, so a workout's night before is recovery[workout.date].
   Everything here judges a night against the lifter's own usual (the median of the 4 weeks before),
   never a textbook 8 hours: GymBuddy only speaks up when a night is off for them. Wrist sleep is
   rough, especially the stages, so the judgments lean on time asleep, resting heart rate and HRV. */

export const KEEP_DAYS = 120;
const USUAL_DAYS = 28;
const MIN_NIGHTS = 5;

/** "6h40", "45 min". */
export const hm = (min) => (min == null ? "" : min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`);

/** The night GymBuddy counts for a morning: the main sleep, else the longest that isn't a nap. */
function mainNight(nights) {
  const real = nights.filter((n) => !n.nap);
  return real.find((n) => n.main) || real.sort((a, b) => b.asleep - a.asleep)[0] || null;
}

/**
 * Folds what Google Health sent for from..to into the kept entries: each date's main night, resting
 * heart rate and HRV. Dates with nothing new keep what they had. Entries older than KEEP_DAYS before
 * `to` are dropped.
 */
export function mergeRecovery(kept = {}, { nights = [], rhr = {}, hrv = {} } = {}, to) {
  const out = { ...kept };
  const byDate = {};
  for (const n of nights) (byDate[n.date] ||= []).push(n);
  const dates = new Set([...Object.keys(byDate), ...Object.keys(rhr), ...Object.keys(hrv)]);
  for (const d of dates) {
    const e = { ...(out[d] || {}) };
    const n = byDate[d] && mainNight(byDate[d]);
    if (n) {
      const { date: _d, nap: _n, main: _m, ...sleep } = n;
      e.sleep = Object.fromEntries(Object.entries(sleep).filter(([, v]) => v != null));
    }
    if (rhr[d] > 0) e.rhr = rhr[d];
    if (hrv[d] > 0) e.hrv = hrv[d];
    if (Object.keys(e).length) out[d] = e;
  }
  const oldest = to ? addDays(to, -KEEP_DAYS) : null;
  if (oldest) for (const d of Object.keys(out)) if (d < oldest) delete out[d];
  return out;
}

const median = (xs) => {
  if (xs.length < MIN_NIGHTS) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The lifter's usual in the 4 weeks before `date`: { asleep, rhr, hrv } (each null until 5 nights). */
export function usual(rec = {}, date) {
  const from = addDays(date, -USUAL_DAYS);
  const days = Object.entries(rec).filter(([d]) => d >= from && d < date).map(([, e]) => e);
  const asleep = median(days.map((e) => e.sleep?.asleep).filter((x) => x > 0));
  const rhr = median(days.map((e) => e.rhr).filter((x) => x > 0));
  const hrv = median(days.map((e) => e.hrv).filter((x) => x > 0));
  return { asleep: asleep && Math.round(asleep), rhr: rhr && Math.round(rhr), hrv: hrv && Math.round(hrv) };
}

/**
 * How the night before `date` compares with the lifter's usual. short: under 5 hours, or an hour+
 * and 15%+ under their usual. strained: resting heart rate 5+ above usual and HRV 20%+ below (the
 * two together; either alone is noise). low: either, the cue to match last time rather than chase a
 * PR. Null when there's nothing for that morning.
 */
export function readiness(rec = {}, date) {
  const e = rec[date];
  if (!e) return null;
  const u = usual(rec, date);
  const asleep = e.sleep?.asleep ?? null;
  const short = asleep != null && (asleep < 300 || (u.asleep != null && asleep <= u.asleep - 60 && asleep < u.asleep * 0.85));
  const rhrUp = e.rhr != null && u.rhr != null && e.rhr >= u.rhr + 5;
  const hrvDown = e.hrv != null && u.hrv != null && e.hrv <= u.hrv * 0.8;
  const strained = rhrUp && hrvDown;
  return { date, entry: e, usual: u, asleep, short, rhrUp, hrvDown, strained, low: short || strained };
}

/** One line for the lifter when a night is off, else null: "Short night (5h40, usually 7h20)." */
export function lowLine(r) {
  if (!r?.low) return null;
  if (r.short) return `Short night (${hm(r.asleep)}${r.usual.asleep ? `, usually ${hm(r.usual.asleep)}` : ""}).`;
  return `Resting heart rate up (${r.entry.rhr}, usually ${r.usual.rhr}) and HRV down (${Math.round(r.entry.hrv)} ms, usually ${r.usual.hrv}).`;
}

/** The night before a workout for a coach: sleep, stages, resting heart rate and HRV against the lifter's usual. */
export function nightLine(rec = {}, date) {
  const r = readiness(rec, date);
  if (!r) return "";
  const { entry: e, usual: u } = r;
  const bits = [];
  if (e.sleep) {
    const s = e.sleep;
    let t = `slept ${hm(s.asleep)}${u.asleep ? ` (their usual ${hm(u.asleep)})` : ""}`;
    const stages = [s.deep != null && `${hm(s.deep)} deep`, s.rem != null && `${hm(s.rem)} REM`, s.awake != null && `awake ${hm(s.awake)}`].filter(Boolean);
    if (stages.length) t += `, ${stages.join(", ")}`;
    bits.push(t);
  }
  if (e.rhr) bits.push(`resting heart rate ${e.rhr}${u.rhr ? ` (usual ${u.rhr})` : ""}`);
  if (e.hrv) bits.push(`HRV ${Math.round(e.hrv)} ms${u.hrv ? ` (usual ${u.hrv})` : ""}`);
  const flag = r.short && r.strained ? " A short night and under-recovered." : r.short ? " A short night for them." : r.strained ? " Under-recovered (resting heart rate up and HRV down together)." : "";
  return bits.length ? `${bits.join("; ")}.${flag}` : "";
}

/** The last `days` mornings for the head coach, newest first, one line each. */
export function recoveryLines(rec = {}, today, days = 14) {
  const lines = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, -i);
    const line = nightLine(rec, d);
    if (line) lines.push(`- ${d}: ${line}`);
  }
  return lines;
}

/**
 * Sleep across a week (dates start..end) against the 4 weeks before: nights tracked, average asleep,
 * short nights, and average resting heart rate and HRV. Null with no nights.
 */
export function weekSleep(rec = {}, start, end) {
  const inWeek = Object.entries(rec).filter(([d]) => d >= start && d <= end);
  const asleep = inWeek.map(([, e]) => e.sleep?.asleep).filter((x) => x > 0);
  if (!asleep.length) return null;
  const before = Object.entries(rec).filter(([d]) => d >= addDays(start, -28) && d < start).map(([, e]) => e);
  const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    nights: asleep.length,
    avgAsleep: mean(asleep),
    usualAsleep: mean(before.map((e) => e.sleep?.asleep).filter((x) => x > 0)),
    short: inWeek.filter(([d]) => readiness(rec, d)?.short).length,
    avgRhr: mean(inWeek.map(([, e]) => e.rhr).filter((x) => x > 0)),
    usualRhr: mean(before.map((e) => e.rhr).filter((x) => x > 0)),
    avgHrv: mean(inWeek.map(([, e]) => e.hrv).filter((x) => x > 0)),
    usualHrv: mean(before.map((e) => e.hrv).filter((x) => x > 0)),
  };
}

/**
 * How the lifter's lifting goes after short nights vs their other nights: each workout scored by how
 * its lifts' best estimated max compares with the 3 workouts of that lift before it, then averaged
 * per group. Null until there are at least 3 workouts in each group.
 * { short: { n, pct }, rest: { n, pct }, diff } with pct as % above or below their recent level.
 */
export function sleepPattern(sessions = [], rec = {}) {
  const sorted = [...sessions].sort(byDateAsc);
  const groups = { short: [], rest: [] };
  sorted.forEach((s, i) => {
    const r = readiness(rec, s.date);
    if (!r || r.asleep == null) return;
    const scores = [];
    for (const n of Object.keys(s.sets || {})) {
      if (!lifting(s.sets[n]).length) continue;
      const prev = sorted.slice(0, i).filter((x) => lifting(x.sets?.[n] || []).length).slice(-3);
      if (prev.length < 2) continue;
      const ref = prev.reduce((a, x) => a + bestE1rm(x.sets[n]), 0) / prev.length;
      if (ref > 0) scores.push(bestE1rm(s.sets[n]) / ref - 1);
    }
    if (scores.length) groups[r.short ? "short" : "rest"].push(scores.reduce((a, b) => a + b, 0) / scores.length);
  });
  if (groups.short.length < 3 || groups.rest.length < 3) return null;
  const pct = (xs) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 10;
  const short = { n: groups.short.length, pct: pct(groups.short) }, rest = { n: groups.rest.length, pct: pct(groups.rest) };
  return { short, rest, diff: Math.round((rest.pct - short.pct) * 10) / 10 };
}
