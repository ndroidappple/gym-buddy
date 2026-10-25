import { isCardio } from "../data/program.js";
import { askCoach, workoutFocus, goalsLine } from "./coachChat.js";
import { heartLine } from "./heart.js";
import { priorSessions, byDateDesc, fmtW } from "./util.js";
import { applyChanges } from "./programChange.js";

/* The coach's walkthrough of one workout, on its recap: a few steps (overall, done well, improve,
   next time), each pointing at a part of the recap the app scrolls to and outlines. The coach picks
   from the places this workout's recap actually shows (walkPlaces), and anything else is dropped,
   so a step never points at something that isn't there. A step that recommends a change to the plan
   (rest, sets, reps, a lift's weight for next time, a swap) carries it, checked against the program,
   and the card offers it as a quiet Apply. The result is kept on the workout (session.walk) so
   replaying it is instant and free; it's stale once the workout's sets or heart rate change. */

export const WALK_VERSION = 1;
export const KINDS = {
  overall: "Overall",
  good: "Done well",
  improve: "Improve",
  next: "Next time",
};

/** Whether the recap shows heart rate for this workout (Google Health on and a summary to show). */
export const showsHeart = (session, prefs) => !!(prefs?.googleHealth?.on && session.hr && !session.hr.none);

/** The parts of this workout's recap a step can point at: [{ id, about }], in screen order. */
export function walkPlaces(session, { heart = false, sleep = false } = {}) {
  const places = [{ id: "overview", about: "Totals at the top: volume, sets and PRs" }];
  if (sleep) places.push({ id: "sleep", about: "The night before: time asleep, resting heart rate and HRV against their usual" });
  const lifts = Object.keys(session.sets || {}).filter((n) => session.sets[n]?.length);
  const h = session.hr;
  if (heart && h && !h.none) {
    places.push({ id: "heart", about: "Heart rate headline: average, peak, minutes vigorous or peak" });
    places.push({ id: "chart", about: "Heart rate chart across the workout (with lift and set, jumps to that set's peak)" });
    if (h.zones && Object.values(h.zones).some((m) => m > 0)) places.push({ id: "zones", about: "Minutes in each heart rate zone" });
    for (const n of lifts) if (session.sets[n].some((x) => x.hr)) places.push({ id: `hr:${n}`, about: `${n}: each set's heart rate peak and how far it came down` });
  }
  for (const n of lifts) {
    places.push(isCardio(n)
      ? { id: `cardio:${n}`, about: `${n}: the cardio done` }
      : { id: `lift:${n}`, about: `${n}: best set, and how it compares with last time or a record` });
  }
  return places;
}

/* The head coach's recap in the bubble on top of the recap: the workout in a sentence or two, made
   here from the numbers on the page so it's there the moment the recap opens and always fits the
   bubble. The walkthrough is the long version. Lifts come from the recap's groups (records, up, same,
   down, baseline: { n, vsLast? }), volPct is volume against last time, low a short or strained night. */
const shortName = (n) => n.split(/ \(| \/ /)[0];
export function recapLine({ name, records = [], up = [], same = [], down = [], baseline = [], volPct = null, low = false }) {
  const lifts = records.length + up.length + same.length + down.length + baseline.length;
  if (!lifts) return null;
  const compared = lifts - baseline.length;
  const pct = (x) => `${Math.abs(x).toFixed(0)}%`;
  const vol = volPct != null && Math.abs(volPct) >= 10 ? `Volume ${volPct > 0 ? "up" : "down"} ${pct(volPct)} on last time.` : "";
  if (!compared) return `First ${name} logged: ${lifts === 1 ? "a baseline" : `baselines for ${lifts} lifts`} to beat next time.`;
  if (records.length) {
    const lead = records.length === 1 ? `A PR on ${shortName(records[0].n)}` : `${records.length} PRs, led by ${shortName([...records].sort((a, b) => b.pct - a.pct)[0].n)}`;
    return `${lead}${low ? ", even after a rough night" : ""}.${vol ? ` ${vol}` : up.length ? ` ${up.length} more ${up.length === 1 ? "lift" : "lifts"} up on last time.` : ""}`;
  }
  if (up.length > down.length) {
    return `${up.length === compared ? "Every lift" : `${up.length} of ${compared} lifts`} up on last time${low ? ", even after a rough night" : ""}.${vol ? ` ${vol}` : ""}`;
  }
  if (down.length > up.length) {
    const worst = Math.max(...down.map((x) => Math.abs(x.vsLast || 0)));
    const who = down.length === compared ? "Every lift" : `${down.length} of ${compared} lifts`;
    const lead = low ? `${who} dipped after a rough night. Expect that.`
      : worst < 5 ? `${who} dipped a few percent: an off day, not a stall.` : `${who} dipped on last time.`;
    return `${lead}${vol ? ` ${vol}` : ""}`;
  }
  return `Matched last time${up.length ? `, ${up.length} up and ${down.length} down` : " across the board"}.${vol ? ` ${vol}` : ""}`;
}

const str = (x, max) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");

const CHANGE_KEYS = ["action", "day", "exercise", "weight", "new_exercise", "sets", "rep_min", "rep_max", "rest_seconds"];
/** A step's change, if it's one the app can make to this workout's day of `program`; else null. */
export function cleanChange(change, program, session) {
  if (!change || typeof change !== "object" || !["update", "weight", "replace", "add", "remove"].includes(change.action)) return null;
  const c = Object.fromEntries(CHANGE_KEYS.filter((k) => change[k] != null && change[k] !== "").map((k) => [k, change[k]]));
  c.day = session.day; // only ever this workout's day
  const r = program?.[session.day] && applyChanges(program, [c]);
  if (!r?.lines.length) return null;
  // The lift's name exactly as in the plan ("shoulder press" → "Seated DB Shoulder Press").
  if (c.action !== "add") {
    const d = changeDiff(program[c.day], r.program[c.day]);
    const n = d.changed[0]?.n || d.removed[0]?.e.n;
    if (n) c.exercise = n;
  }
  return c;
}

const rest = (sec) => (sec % 60 ? `${sec}s` : `${sec / 60} min`);
/** A change in a few words for the Apply row: "Rest 90s → 2 min", "Start at 35 lb next time". */
export function changeLabel(program, c) {
  const ex = program?.[c.day]?.exercises?.find((e) => e.n.toLowerCase() === String(c.exercise || "").toLowerCase());
  if (c.action === "weight") return `Start at ${fmtW(c.weight)} lb next time`;
  if (c.action === "replace") return `Swap for ${c.new_exercise}`;
  if (c.action === "add") return `Add ${c.exercise} to ${program[c.day].name}`;
  if (c.action === "remove") return `Take off ${program[c.day].name}`;
  if (!ex) return applyChanges(program, [c]).lines[0] || "";
  const bits = [];
  if (c.rest_seconds != null && c.rest_seconds !== ex.rest) bits.push(`Rest ${rest(ex.rest)} → ${rest(c.rest_seconds)}`);
  if (c.sets != null && c.sets !== ex.sets) bits.push(`${ex.sets} → ${c.sets} sets`);
  const lo = c.rep_min ?? ex.reps[0], hi = c.rep_max ?? ex.reps[1];
  if (lo !== ex.reps[0] || hi !== ex.reps[1]) bits.push(`Reps ${ex.reps[0]}–${ex.reps[1]} → ${Math.min(lo, hi)}–${Math.max(lo, hi)}`);
  return bits.join(", ") || applyChanges(program, [c]).lines[0] || "";
}
/**
 * What applying a change did to one day's lifts, enough to take just that back later even after
 * other changes: lifts it added, lifts it took off (and where), and lifts as they were before.
 */
export function changeDiff(before, after) {
  const b = new Set(before.exercises.map((e) => e.n)), a = new Set(after.exercises.map((e) => e.n));
  return {
    added: after.exercises.filter((e) => !b.has(e.n)).map((e) => e.n),
    removed: before.exercises.map((e, i) => ({ e, i })).filter(({ e }) => !a.has(e.n)),
    changed: before.exercises.filter((e) => a.has(e.n) && JSON.stringify(e) !== JSON.stringify(after.exercises.find((x) => x.n === e.n))),
  };
}
/** `program` with one change (its changeDiff) taken back on `day`, leaving everything else as it is now. */
export function undoDiff(program, day, d) {
  const cur = program[day];
  if (!cur) return program;
  let xs = cur.exercises.filter((e) => !d.added.includes(e.n)).map((e) => d.changed.find((x) => x.n === e.n) || e);
  for (const { e, i } of d.removed) if (!xs.some((x) => x.n === e.n)) xs = [...xs.slice(0, i), e, ...xs.slice(i)];
  return { ...program, [day]: { ...cur, exercises: xs } };
}

/** The lift a change is about, for the Apply row's first words. */
export const changeLift = (c) => (c.action === "add" ? null : String(c.exercise || ""));

/**
 * What the coach sent, made safe to show: known kinds, targets from `places` (else the overview), a
 * chart moment only for a set that knows when it was done, a change only if it applies to this day's
 * plan (at most 3), at most 6 steps. Null when nothing's left.
 */
export function cleanWalk(input, places, session, program = null) {
  const ids = new Set(places.map((p) => p.id));
  const raw = Array.isArray(input?.steps) ? input.steps : [];
  const steps = raw.flatMap((s) => {
    const text = str(s?.text, 360);
    if (!text) return [];
    const kind = KINDS[s.kind] ? s.kind : "good";
    let target = typeof s.target === "string" ? s.target.trim() : "";
    // A lift's name on its own: its row.
    if (!ids.has(target) && ids.has(`lift:${target}`)) target = `lift:${target}`;
    if (!ids.has(target)) target = "overview";
    const step = { kind, target, title: str(s.title, 48) || KINDS[kind], text };
    if (target === "chart") {
      const lift = typeof s.lift === "string" ? s.lift.trim() : "";
      const n = Number(s.set);
      if (session.sets?.[lift]?.[n - 1]?.t) Object.assign(step, { lift, set: n });
    }
    const change = cleanChange(s.change, program, session);
    if (change) step.change = change;
    return [step];
  }).slice(0, 6);
  let changes = 0;
  for (const st of steps) if (st.change && ++changes > 3) delete st.change;
  return steps.length ? steps : null;
}

/** What a walkthrough was written from: the sets as logged and the heart rate summary. */
export function walkBasis(session) {
  const sets = Object.entries(session.sets || {}).map(([n, v]) => `${n}:${v.map((x) => `${x.w ?? ""}x${x.r ?? ""}${x.rir != null ? `@${x.rir}` : ""}`).join(",")}`).join("|");
  const src = `${sets}#${session.hr ? `${session.hr.at || ""}${session.hr.none ? "n" : ""}` : ""}`;
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** The workout's walkthrough, if it's still about the workout as it is now. */
export const freshWalk = (session) => {
  const w = session.walk;
  return w && w.v === WALK_VERSION && Array.isArray(w.steps) && w.steps.length && w.basis === walkBasis(session) ? w : null;
};

/** What the coach reads: the workout in full, the plan for that day, earlier heart rate, the places. */
export function walkContext({ session, sessions, program, profile, notes, places, recovery = null }) {
  const { walk: _w, ...s } = session;
  const lines = workoutFocus(s, sessions, program, recovery).split("\n").slice(1); // not the chat's opening line
  const plan = program[s.day];
  if (plan?.exercises?.length) {
    lines.push(`Plan for ${plan.name} (day key ${s.day}; sets x rep range, rest between sets): ${plan.exercises.map((e) => `${e.n} ${e.sets}x${e.reps[0]}-${e.reps[1]}${isCardio(e.n) ? " min" : ""}, ${e.rest}s${e.next ? `, already set to start at ${e.next.w} lb next time` : ""}`).join("; ")}.`);
  }
  if (profile?.doneAt) lines.push(goalsLine(profile));
  if (notes?.length) lines.push("Your notes on the lifter:", ...notes.map((n) => `- ${n}`));
  if (heartLine(s)) {
    const earlier = priorSessions(sessions, s).filter((p) => p.hr && !p.hr.none).sort(byDateDesc).slice(0, 5);
    if (earlier.length) lines.push("Heart rate in earlier workouts:", ...earlier.map((p) => `- ${p.date} ${program[p.day]?.name || p.day}: ${heartLine(p)}`));
  }
  lines.push("Places on the recap (target ids):", ...places.map((p) => `- ${p.id}: ${p.about}`));
  return lines.join("\n");
}

/**
 * Asks the head coach for the walkthrough. Resolves to the walk to keep on the workout:
 * { v, basis, coach, at, heart, steps }. Throws like askCoach (kind "empty" when nothing usable came back).
 */
export async function requestWalk({ coach = "tank", session, sessions, program, profile, notes, heart, recovery = null, sleep = false, signal }) {
  const places = walkPlaces(session, { heart, sleep });
  const context = walkContext({ session, sessions, program, profile, notes, places, recovery: sleep ? recovery : null });
  const ask = () => askCoach({
    coach, mode: "walk", signal, onText: () => {},
    messages: [{ role: "user", content: "Walk me through this workout: what went well and what to improve." }],
    context,
  });
  let r = await ask().catch((e) => (e.kind === "empty" && !e.capped ? ask() : Promise.reject(e)));
  let steps = cleanWalk(r.walk, places, session, program);
  if (!steps) { r = await ask(); steps = cleanWalk(r.walk, places, session, program); }
  if (!steps) throw Object.assign(new Error("empty"), { kind: "empty" });
  // `heart`: written with anything from Google Health (heart rate or sleep), so disconnecting deletes it.
  return { v: WALK_VERSION, basis: walkBasis(session), coach, at: Date.now(), heart: !!heart || !!sleep, steps };
}
