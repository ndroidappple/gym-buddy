import { DAYS, isCardio, activeDays } from "../data/program.js";

export const uid = () => Math.random().toString(36).slice(2, 10);
export const e1rm = (w, r) => (r <= 1 ? w : w * (1 + r / 30));
export const num = (n) => (Math.round(n * 10) / 10).toString();
export const fmtW = (w) => (w === 0 ? "BW" : num(w));
export const iso = (d) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const today = () => iso(new Date());
export const shortDate = (s) => new Date(s + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
export const longDate = (s) => new Date(s + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
export const mmss = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
export const compact = (n) => (n >= 10000 ? `${num(n / 1000)}k` : Math.round(n).toLocaleString());

export const byDateAsc = (a, b) => a.date.localeCompare(b.date) || (a.finishedAt || 0) - (b.finishedAt || 0);
export const byDateDesc = (a, b) => -byDateAsc(a, b);

/* Cardio entries ({ min, mi }) share the sets map with lifts; strength maths only ever sees lifting sets. */
export const isCardioSet = (x) => x?.min != null;
export const lifting = (sets) => (sets || []).filter((x) => !isCardioSet(x));
export const fmtSet = (x) => (isCardioSet(x) ? `${num(x.min)} min${x.mi != null ? ` · ${num(x.mi)} mi` : ""}` : `${fmtW(x.w)}×${x.r}`);
export const cardioTotals = (sets) => (sets || []).filter(isCardioSet).reduce((t, x) => ({ min: t.min + x.min, mi: t.mi + (x.mi || 0) }), { min: 0, mi: 0 });

export const bestSet = (sets) => {
  const l = lifting(sets);
  return l.length ? l.reduce((b, s) => (e1rm(s.w, s.r) > e1rm(b.w, b.r) ? s : b)) : null;
};
export const bestE1rm = (sets) => { const l = lifting(sets); return l.length ? Math.max(...l.map((s) => e1rm(s.w, s.r))) : 0; };
export const volume = (sets) => lifting(sets).reduce((a, x) => a + x.w * x.r, 0);
export const sessionVolume = (s) => Object.values(s.sets).reduce((a, v) => a + volume(v), 0);
export const sessionSetCount = (s) => Object.values(s.sets).reduce((a, v) => a + v.length, 0);

/** Sessions other than `current` that come before it in time. */
export function priorSessions(sessions, current) {
  return sessions.filter((s) => s.id !== current.id && byDateAsc(s, current) < 0);
}

/** Best e1RM for a lift across the given sessions. */
export function allTimeBest(sessions, lift) {
  let best = 0;
  sessions.forEach((s) => { if (s.sets[lift]) best = Math.max(best, bestE1rm(s.sets[lift])); });
  return best;
}

/** Per-session series for a lift, oldest first, with PR flags. */
export function liftSeries(sessions, lift) {
  let running = 0;
  return [...sessions].sort(byDateAsc).filter((s) => lifting(s.sets[lift]).length).map((s) => {
    const sets = lifting(s.sets[lift]);
    const orm = bestE1rm(sets);
    const pr = orm > running;
    running = Math.max(running, orm);
    return { id: s.id, date: s.date, day: s.day, sets, orm, top: Math.max(...sets.map((x) => x.w)), vol: volume(sets), pr };
  });
}

/** Best of the last k sessions vs best of the k before — smooths single-session noise. */
export function trend(values) {
  if (values.length < 2) return null;
  const k = Math.min(3, Math.floor(values.length / 2));
  const recent = Math.max(...values.slice(-k));
  const before = Math.max(...values.slice(-2 * k, -k));
  if (!before) return null;
  return ((recent - before) / before) * 100;
}

export function repPRs(sessions, lift) {
  const m = {};
  sessions.forEach((s) => lifting(s.sets[lift]).forEach((x) => {
    if (!m[x.r] || x.w > m[x.r].w) m[x.r] = { w: x.w, date: s.date };
  }));
  return Object.entries(m).map(([r, v]) => ({ r: +r, ...v })).sort((a, b) => a.r - b.r);
}

/** Monday-first dates of the current week. */
export function weekDates(ref = new Date()) {
  const d = new Date(ref);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return iso(x); });
}

/** The next day in the rotation. Custom workouts (and days since switched off) take a slot too:
    Push next, do a custom workout, and Pull is next. */
export function nextDayAfter(sessions, program) {
  const days = program ? activeDays(program) : DAYS;
  let skipped = 0;
  for (const s of [...sessions].sort(byDateDesc)) {
    const i = days.indexOf(s.day);
    if (i >= 0) return days[(i + 1 + skipped) % days.length];
    skipped++;
  }
  return days[skipped % days.length];
}

/** Bodyweight over time from weekly weigh-ins and session entries, oldest first, one point per date (a weigh-in wins). */
export function bodyweightSeries(sessions, weighins = []) {
  const m = {};
  sessions.forEach((s) => { if (s.bw != null) m[s.date] = s.bw; });
  weighins.forEach((w) => { m[w.date] = w.bw; });
  return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([date, bw]) => ({ date, bw }));
}

/** Whole days between two ISO dates. */
export const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch {}
}

/* Double progression. Each lift has its own rep range; once every planned set at your top weight
   reached the top of that range, it's time to add weight (and work back up the reps). */
const BIG_LOWER = /leg press|squat|deadlift|romanian|hip thrust|good morning/i;
export const weightStep = (lift) => (BIG_LOWER.test(lift) ? 10 : 5);

/** { from, to, sets, reps } when `sets` (one session's sets for `ex`) earned a weight increase, else null. */
export function readyToIncrease(ex, sets) {
  if (!ex || !sets?.length || isCardio(ex.n)) return null;
  const top = Math.max(...sets.map((s) => +s.w || 0));
  if (!(top > 0)) return null; // bodyweight moves progress by reps, not plates
  const hits = sets.filter((s) => +s.w === top && +s.r >= ex.reps[1]).length;
  if (hits < ex.sets) return null;
  return { from: top, to: top + weightStep(ex.n), sets: ex.sets, reps: ex.reps[1] };
}
