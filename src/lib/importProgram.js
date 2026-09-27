import { DAYS, EXTRA_DAYS, MAX_DAYS, LIBRARY, PROGRAM, isCardio } from "../data/program.js";
import { CUES } from "../data/cues.js";
import { COACHES, coachFor } from "../data/coaches.js";

/* Bringing in a program the lifter already runs, pasted as text (e.g. from their Notes app):

     WORKOUT 1
     Machine Chest Press — 3 × 6–10
     Lat Pulldown or Assisted Pull-Up — 3 × 8–12

   Everything is parsed here, in the app, so it's instant and free; only the optional review
   goes to a coach. Workouts fill the program's day slots in order (the slot only sets the colour):
   the four built-in ones, then extra slots for a fifth, sixth or seventh workout. */

export const MAX_PASTE = 6000; // characters; a long 4-day program with notes is ~1,500
export const MAX_WORKOUTS = MAX_DAYS;
const MAX_LIFTS = 15; // per workout
const MAX_NAME = 20; // workout name, so it fits the Today card

// "3 × 8–12", "3x10", "3 sets of 8-12 reps", "4 x 30-60 sec", "1 × 20 min", with an optional "90s rest" after.
const SPEC = /(\d{1,2})\s*(?:[x×X*]|sets?\s*(?:of|x|×)?)\s*(\d{1,3})(?:\s*(?:-|–|—|to)\s*(\d{1,3}))?\s*(reps?|min(?:utes?)?|sec(?:onds?)?|s\b)?/i;
const REST = /(\d{2,3})\s*(?:s|sec(?:onds?)?)\s*rest|rest\s*(?:[:\-–—]\s*)?(\d{2,3})\s*(?:s|sec)?|(\d(?:\.\d)?)\s*min(?:utes?)?\s*rest/i;
const BULLET = /^\s*(?:[-•*·▪◦]|\d{1,2}[.)]|[a-z][.)])\s+/i;

const clean = (s) => s.replace(/\s+/g, " ").trim();
const title = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : s);
/** Case and plural-insensitive key: "Lateral Raises" and "lateral raise" match. */
const key = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)).join(" ");

const KNOWN = new Map();
for (const ex of [...LIBRARY, ...DAYS.flatMap((d) => PROGRAM[d].exercises)]) if (!KNOWN.has(key(ex.n))) KNOWN.set(key(ex.n), ex);

/** A rest that suits the rep range when the paste doesn't say. */
const restFor = (lo) => (lo <= 6 ? 120 : lo <= 9 ? 90 : 60);

/** One lift line, or null when the line has no sets × reps. */
function parseLift(line) {
  const m = line.match(SPEC);
  if (!m) return null;
  let name = clean(line.slice(0, m.index).replace(BULLET, "").replace(/[\s—–:,(-]+$/, ""));
  if (!name) return null;
  const sets = Math.min(10, Math.max(1, +m[1]));
  let lo = +m[2], hi = m[3] ? +m[3] : +m[2];
  if (lo > hi) [lo, hi] = [hi, lo];
  lo = Math.min(60, Math.max(1, lo)); hi = Math.min(60, Math.max(lo, hi));
  const r = line.slice(m.index).match(REST);
  const rest = r ? Math.min(600, Math.max(15, r[3] ? Math.round(+r[3] * 60) : +(r[1] || r[2]))) : null;
  return { name, sets, reps: [lo, hi], rest };
}

/** Turns the lifter's name for a lift into a program entry. "A or B" keeps A (logging one lift
    under two names would mix their weights). A name the app knows picks up its cue and cardio type. */
function toExercise({ name, sets, reps, rest, guess }, notes, seen) {
  const [first, ...alts] = name.split(/\s+or\s+/i);
  const typed = clean(first).slice(0, 60);
  if (alts.length) notes.push(`${typed} (you listed ${alts.map(clean).join(" / ")} as the other option)`);
  const known = KNOWN.get(key(typed));
  // One spelling per lift across workouts ("Triceps Pushdown" and "Triceps Pushdowns"), so its history is one line.
  const n = known ? known.n : seen.get(key(typed)) || typed;
  seen.set(key(n), n);
  if (guess) {
    notes.push(`${n}: no sets or reps found, so it starts at ${known ? `${known.sets} × ${known.reps[0]}–${known.reps[1]}` : "3 × 8–12"}`);
    if (known) ({ sets, reps } = known);
  }
  const ex = { n, sets, reps, rest: rest ?? (known && !isCardio(known.n) ? known.rest : restFor(reps[0])) };
  if (known && isCardio(known.n)) Object.assign(ex, { sets: 1, rest: 0 });
  const cue = CUES[ex.n] || known?.cue;
  if (cue) ex.cue = cue;
  return ex;
}

/** What a workout trains, from its lifts: "Chest & triceps · Back & biceps", or "Full body". */
export function detailFor(exercises) {
  const counts = {};
  for (const e of exercises) { const c = coachFor(e.n); counts[c] = (counts[c] || 0) + 1; }
  const groups = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c]) => COACHES[c].group);
  if (!groups.length) return "No lifts yet";
  return groups.length > 3 ? "Full body" : groups.join(" · ");
}

/**
 * Parses pasted program text. Returns { workouts: [{ name, exercises }], notes, errors }.
 * A line with sets × reps is a lift; any other line starts a new workout when it looks like a
 * heading (first line, after a blank line, ALL CAPS, or ending in ":"). A plain line inside a
 * workout is a lift with no numbers, given 3 × 8–12 and noted.
 */
export function parseProgram(text) {
  const notes = [], errors = [];
  const workouts = [];
  let cur = null, blank = true;
  const lines = String(text || "").slice(0, MAX_PASTE).split(/\r?\n/);
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) { blank = true; continue; }
    const lift = parseLift(line);
    if (lift) {
      if (!cur) { cur = { name: `Workout ${workouts.length + 1}`, lifts: [] }; workouts.push(cur); }
      cur.lifts.push(lift);
    } else {
      const heading = !cur || blank || /:$/.test(line) || (line === line.toUpperCase() && /[A-Z]/.test(line));
      if (heading) {
        // Two headings in a row (e.g. "WEEK 1" then "Day 1"): the nearer one names the workout.
        if (cur && !cur.lifts.length) cur.name = line;
        else { cur = { name: line, lifts: [] }; workouts.push(cur); }
      } else {
        const name = line.replace(BULLET, "");
        cur.lifts.push({ name, sets: 3, reps: [8, 12], rest: null, guess: true });
      }
    }
    blank = false;
  }

  const out = [], seen = new Map();
  for (const w of workouts.filter((x) => x.lifts.length)) {
    const exercises = [];
    for (const l of w.lifts.slice(0, MAX_LIFTS)) {
      const ex = toExercise(l, notes, seen);
      // Same lift twice in one workout (e.g. "Lateral Raises" as two lines): keep the first.
      if (!exercises.some((e) => key(e.n) === key(ex.n))) exercises.push(ex);
    }
    if (w.lifts.length > MAX_LIFTS) notes.push(`${w.name}: kept the first ${MAX_LIFTS} lifts`);
    const name = title(clean(w.name.replace(/:$/, ""))).slice(0, MAX_NAME) || `Workout ${out.length + 1}`;
    out.push({ name, exercises });
  }
  if (!out.length) errors.push("I couldn't find any lifts. Put each one on its own line with sets × reps, like \"Leg Press — 3 × 8–12\".");
  if (out.length > MAX_WORKOUTS) errors.push(`That's ${out.length} workouts. A rotation can have up to ${MAX_WORKOUTS}, one for each day of the week. Trim it and paste again.`);
  return { workouts: out, notes, errors };
}

/** The program with the pasted workouts in the day slots, in order. Unused slots go out of the
    rotation (an extra slot is kept rather than deleted, so past sessions logged under it keep
    their name). Each day keeps its imported lifts as `orig`, so "Restore" goes back to them. */
export function programFromImport(program, workouts) {
  const next = { ...program };
  [...DAYS, ...EXTRA_DAYS].forEach((d, i) => {
    const w = workouts[i];
    if (w) next[d] = { ...next[d], name: w.name, detail: detailFor(w.exercises), exercises: w.exercises, orig: w.exercises, off: false };
    else if (next[d]) next[d] = { ...next[d], off: true };
  });
  return next;
}

/** "3 × 6–10" per lift, one line per lift, for the check card. */
export const liftLine = (ex) => (isCardio(ex.n) ? `${ex.n} · ${ex.reps[0]}–${ex.reps[1]} min` : `${ex.n} · ${ex.sets} × ${ex.reps[0]}–${ex.reps[1]}`);
