import { DAYS, IMPORTED } from "../data/program.js";

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

export function seedSessions() {
  const now = new Date();
  return IMPORTED.map((h) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (h.w === 1 ? 17 : 10) + DAYS.indexOf(h.d));
    const sets = {};
    Object.entries(h.s).forEach(([k, v]) => { sets[k] = v.map(([w, r]) => ({ w, r })); });
    return { id: uid(), day: h.d, date: iso(d), note: "Imported from spreadsheet", bw: null, sets };
  });
}

export const byDateAsc = (a, b) => a.date.localeCompare(b.date) || (a.finishedAt || 0) - (b.finishedAt || 0);
export const byDateDesc = (a, b) => -byDateAsc(a, b);

export const bestSet = (sets) =>
  sets?.length ? sets.reduce((b, s) => (e1rm(s.w, s.r) > e1rm(b.w, b.r) ? s : b)) : null;
export const bestE1rm = (sets) => (sets?.length ? Math.max(...sets.map((s) => e1rm(s.w, s.r))) : 0);
export const volume = (sets) => sets.reduce((a, x) => a + x.w * x.r, 0);
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
  return [...sessions].sort(byDateAsc).filter((s) => s.sets[lift]?.length).map((s) => {
    const sets = s.sets[lift];
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
  sessions.forEach((s) => (s.sets[lift] || []).forEach((x) => {
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

export function nextDayAfter(sessions) {
  const last = [...sessions].sort(byDateDesc)[0];
  if (!last) return DAYS[0];
  return DAYS[(DAYS.indexOf(last.day) + 1) % DAYS.length];
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch {}
}
