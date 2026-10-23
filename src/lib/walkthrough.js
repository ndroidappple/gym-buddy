import { isCardio } from "../data/program.js";
import { askCoach, workoutFocus, goalsLine } from "./coachChat.js";
import { heartLine } from "./heart.js";
import { priorSessions, byDateDesc } from "./util.js";

/* The coach's walkthrough of one workout, on its recap: a few steps (overall, done well, improve,
   next time), each pointing at a part of the recap the app scrolls to and outlines. The coach picks
   from the places this workout's recap actually shows (walkPlaces), and anything else is dropped,
   so a step never points at something that isn't there. The result is kept on the workout
   (session.walk) so replaying it is instant and free; it's stale once the workout's sets or heart
   rate change. */

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
export function walkPlaces(session, { heart = false } = {}) {
  const places = [{ id: "overview", about: "Totals at the top: volume, sets and PRs" }];
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

const str = (x, max) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * What the coach sent, made safe to show: known kinds, targets from `places` (else the overview), a
 * chart moment only for a set that knows when it was done, at most 6 steps. Null when nothing's left.
 */
export function cleanWalk(input, places, session) {
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
    return [step];
  }).slice(0, 6);
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
export function walkContext({ session, sessions, program, profile, notes, places }) {
  const { walk: _w, ...s } = session;
  const lines = workoutFocus(s, sessions, program).split("\n").slice(1); // not the chat's opening line
  const plan = program[s.day];
  if (plan?.exercises?.length) {
    lines.push(`Plan for ${plan.name} (sets x rep range, rest between sets): ${plan.exercises.map((e) => `${e.n} ${e.sets}x${e.reps[0]}-${e.reps[1]}${isCardio(e.n) ? " min" : ""}, ${e.rest}s`).join("; ")}.`);
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
export async function requestWalk({ coach = "tank", session, sessions, program, profile, notes, heart, signal }) {
  const places = walkPlaces(session, { heart });
  const context = walkContext({ session, sessions, program, profile, notes, places });
  const ask = () => askCoach({
    coach, mode: "walk", signal, onText: () => {},
    messages: [{ role: "user", content: "Walk me through this workout: what went well and what to improve." }],
    context,
  });
  let r = await ask().catch((e) => (e.kind === "empty" && !e.capped ? ask() : Promise.reject(e)));
  let steps = cleanWalk(r.walk, places, session);
  if (!steps) { r = await ask(); steps = cleanWalk(r.walk, places, session); }
  if (!steps) throw Object.assign(new Error("empty"), { kind: "empty" });
  return { v: WALK_VERSION, basis: walkBasis(session), coach, at: Date.now(), heart: !!heart, steps };
}
