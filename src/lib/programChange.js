import { LIBRARY, isCardio, DAYS, activeDays } from "../data/program.js";
import { CUES } from "../data/cues.js";

/* Program changes a coach proposes in chat (lifts, sets/reps/rest, and workout names). Nothing here touches saved data: applyChanges returns
   the would-be program plus plain-English lines for the confirm card, and errors for anything that
   doesn't match the lifter's actual program (so a confused model can't make a silent edit). */

const int = (v, lo, hi) => (v == null || v === "" || !Number.isFinite(+v) ? undefined : Math.min(hi, Math.max(lo, Math.round(+v))));
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const words = (s) => String(s || "").toLowerCase().replace(/\bdeck\b/g, "dec").match(/[a-z0-9]+/g) || [];
/** Index in `list` of `name`: exact, else the only lift containing every word ("pec deck" → Machine Pec Dec). */
function findIn(list, name) {
  const exact = list.findIndex((e) => same(e.n, name));
  if (exact >= 0) return exact;
  const want = words(name);
  if (!want.length) return -1;
  const loose = list.map((e, i) => [words(e.n), i]).filter(([have]) => want.every((w) => have.includes(w)));
  return loose.length === 1 ? loose[0][1] : -1;
}
const fromLibrary = (name) => {
  const hit = LIBRARY[findIn(LIBRARY, name)];
  if (!hit) return null;
  const { g, ...ex } = hit; // eslint-disable-line no-unused-vars
  return ex;
};
const spec = (ex) => `${ex.sets} × ${ex.reps[0]}–${ex.reps[1]}${isCardio(ex.n) ? " min" : ""}, ${ex.rest}s rest`;

/** Resolves "push", "Push" or a renamed day's name to its key. */
function dayKey(program, day) {
  const keys = DAYS.filter((k) => program[k]); // never the custom workout
  return keys.find((k) => same(k, day) || same(program[k].name, day)) || null;
}

function withSpec(base, c) {
  let lo = int(c.rep_min, 1, 60) ?? base.reps[0];
  let hi = int(c.rep_max, 1, 60) ?? base.reps[1];
  if (lo > hi) [lo, hi] = [hi, lo];
  const ex = { ...base, sets: int(c.sets, 1, 10) ?? base.sets, reps: [lo, hi], rest: int(c.rest_seconds, 15, 600) ?? base.rest };
  if (!ex.cue && CUES[ex.n]) ex.cue = CUES[ex.n];
  return ex;
}

/** Applies coach-proposed `changes` to `program`. Returns { program, lines, errors }. */
export function applyChanges(program, changes) {
  let next = program;
  const lines = [];
  const errors = [];
  for (const c of Array.isArray(changes) ? changes : []) {
    const key = dayKey(next, c?.day);
    if (!key) { errors.push(`There's no "${c?.day}" day in your program.`); continue; }
    const day = next[key];
    if (c.action === "rename") {
      const name = String(c.new_name || "").replace(/\s+/g, " ").trim().slice(0, 20);
      if (!name) { errors.push(`Rename ${day.name} to what?`); continue; }
      if (same(name, day.name)) { errors.push(`${day.name} already has that name.`); continue; }
      const taken = DAYS.find((k) => k !== key && next[k] && !next[k].off && same(next[k].name, name));
      if (taken) { errors.push(`Another workout is already called ${next[taken].name}.`); continue; }
      next = { ...next, [key]: { ...day, name } };
      lines.push(`Rename ${day.name} to ${name}`);
      continue;
    }
    const xs = day.exercises;
    const i = findIn(xs, c.exercise);
    const put = (list) => { next = { ...next, [key]: { ...day, exercises: list } }; };

    if (c.action === "add") {
      const name = String(c.exercise || "").trim();
      if (!name) { errors.push("A lift to add needs a name."); continue; }
      const ex = withSpec(fromLibrary(name) || { n: name, sets: 3, reps: [8, 12], rest: 90, custom: true }, c);
      const dup = i >= 0 ? i : xs.findIndex((e) => same(e.n, ex.n));
      if (dup >= 0) { errors.push(`${xs[dup].n} is already on ${day.name}.`); continue; }
      put([...xs, ex]);
      lines.push(`Add ${ex.n} to ${day.name}: ${spec(ex)}`);
    } else if (i < 0) {
      errors.push(`${c.exercise || "That lift"} isn't on ${day.name}.`);
    } else if (c.action === "remove") {
      put(xs.filter((_, j) => j !== i));
      lines.push(`Remove ${xs[i].n} from ${day.name}`);
    } else if (c.action === "replace") {
      const name = String(c.new_exercise || "").trim();
      if (!name) { errors.push(`Swap ${xs[i].n} for what?`); continue; }
      const old = xs[i];
      const ex = withSpec(fromLibrary(name) || { n: name, sets: old.sets, reps: old.reps, rest: old.rest, custom: true }, c);
      if (xs.some((e, j) => j !== i && same(e.n, ex.n))) { errors.push(`${ex.n} is already on ${day.name}.`); continue; }
      put(xs.map((e, j) => (j === i ? ex : e)));
      lines.push(`Swap ${old.n} for ${ex.n} on ${day.name}: ${spec(ex)}`);
    } else if (c.action === "update") {
      const old = xs[i];
      const ex = withSpec(old, c);
      if (spec(ex) === spec(old)) { errors.push(`${old.n} already is ${spec(old)}.`); continue; }
      put(xs.map((e, j) => (j === i ? ex : e)));
      lines.push(`${old.n} on ${day.name}: ${spec(old)} → ${spec(ex)}`);
    } else {
      errors.push("The coach sent a change the app doesn't understand.");
    }
  }
  return { program: next, lines, errors };
}

/** One line per day, for the coach's context: day key, name, and each lift's plan. */
export function describeProgram(program) {
  return activeDays(program).map((k) => [k, program[k]]).map(([k, d]) =>
    `${k} (${d.name}): ${d.exercises.map((e) => `${e.n} ${e.sets}x${e.reps[0]}-${e.reps[1]}${isCardio(e.n) ? "min" : ""} ${e.rest}s`).join("; ")}`,
  ).join("\n");
}
