import { DAYS, EXTRA_DAYS, PROGRAM, allDays, LIBRARY, activeDays, isCardio, isFinisherCardio, capRest } from "../data/program.js";
import { CUES } from "../data/cues.js";
import { COACH_ORDER, coachFor, headCoach } from "../data/coaches.js";

/* First-run setup with the coaches. Tank asks about goals, weight and training days; every coach
   then lets the lifter pick their lifts. All of it is plain functions over the program, so the
   chat only shows what will change and the lifter confirms it. */

export const GOALS = [
  { id: "muscle", label: "Build muscle" },
  { id: "strength", label: "Get stronger" },
  { id: "lean", label: "Lose fat / get lean" },
  { id: "general", label: "General fitness & health" },
];
export const DAY_CHOICES = [2, 3, 4, 5, 6];

/** Where each coach's new lifts go. Core and cardio go at the end of every day instead. */
const HOME = { tank: "push", wings: "pull", boulder: "shoulders", piston: "legs" };
export const EVERY_DAY = new Set(["brick", "dash"]);
const FINISHER = "Incline Walk";

/** One training style from the goals: strength or lean when that's the clear aim, else as programmed. */
export function styleFor(goals = []) {
  const g = new Set(goals);
  if (g.has("strength") && !g.has("muscle")) return "strength";
  if (g.has("lean") && !g.has("strength") && !g.has("muscle")) return "lean";
  return "standard";
}

/* Styles are applied from each lift's original numbers (kept in `base`), so redoing setup or
   switching goals never compounds. */
function styled(ex, style) {
  if (isCardio(ex.n)) return ex;
  const base = ex.base || { reps: ex.reps, rest: ex.rest };
  const [lo, hi] = base.reps;
  if (style === "strength") return { ...ex, base, reps: [Math.max(3, lo - 4), Math.max(Math.max(3, lo - 4) + 2, hi - 4)], rest: capRest(ex.n, Math.min(180, base.rest + 30)) };
  if (style === "lean") return { ...ex, base, reps: [lo + 2, Math.min(25, hi + 3)], rest: Math.max(45, base.rest - 15) };
  const { base: _, ...plain } = ex; // eslint-disable-line no-unused-vars
  return { ...plain, reps: base.reps, rest: base.rest };
}

const lib = (n) => { const e = LIBRARY.find((x) => x.n === n); if (!e) return null; const { g, ...ex } = e; return { ...ex, cue: CUES[n] || e.cue }; }; // eslint-disable-line no-unused-vars

/** Three training days: Shoulders sits out and its two key lifts each join Push and Pull. */
function toThreeDays(program) {
  if (program.shoulders.off) return program;
  const moved = { push: [], pull: [] };
  for (const ex of program.shoulders.exercises) {
    const coach = coachFor(ex.n);
    const to = coach === "wings" || /rear delt/i.test(ex.n) ? "pull" : "push";
    if (moved[to].length < 2 && !program[to].exercises.some((e) => e.n === ex.n)) moved[to].push({ ...ex, from: "shoulders" });
  }
  return {
    ...program,
    shoulders: { ...program.shoulders, off: true },
    push: { ...program.push, detail: "Chest, shoulders + triceps", exercises: [...program.push.exercises, ...moved.push] },
    pull: { ...program.pull, detail: "Back, rear delts + biceps", exercises: [...program.pull.exercises, ...moved.pull] },
  };
}
function toFourDays(program) {
  if (!program.shoulders.off) return program;
  const strip = (d, detail) => ({ ...program[d], detail, exercises: program[d].exercises.filter((e) => e.from !== "shoulders") });
  return { ...program, shoulders: { ...program.shoulders, off: false }, push: strip("push", "Chest + Triceps"), pull: strip("pull", "Back + Biceps") };
}

/** The program Tank's setup would give: split for the days, rep style for the goals, cardio finisher
    when getting lean. Returns { program, lines } where lines describe every change in plain English. */
export function planFor(program, { goals = [], days = 4 } = {}) {
  // A pasted-in program (redoing setup and asking Tank to build one instead) starts from the built-in
  // split, with any extra days out of the rotation. "Keep mine" keeps the pasted one.
  const pasted = activeDays(program).some((d) => program[d].orig);
  let start = program;
  if (pasted) {
    start = { ...program };
    for (const d of DAYS) start[d] = PROGRAM[d];
    for (const d of EXTRA_DAYS) if (start[d]) start[d] = { ...start[d], off: true };
  }
  let next = days <= 3 ? toThreeDays(start) : toFourDays(start);
  const lines = pasted ? [`Swap your pasted program for GymBuddy's ${days <= 3 ? "Push, Pull, Legs" : "Push, Pull, Legs, Shoulders"} split.`] : [];
  if (!pasted && next.shoulders.off !== program.shoulders.off) {
    lines.push(next.shoulders.off
      ? "3-day split: Push, Pull, Legs. Your key shoulder lifts move into Push and Pull."
      : "4-day split: Push, Pull, Legs, Shoulders.");
  }
  const style = styleFor(goals);
  const finisher = style === "lean";
  let restyled = 0;
  for (const d of allDays(next)) {
    const exercises = next[d].exercises
      .filter((e) => finisher || !e.finisher)
      .map((e) => { const s = styled(e, style); if (s.reps[0] !== e.reps[0] || s.rest !== e.rest) restyled++; return s; });
    if (finisher && !next[d].off && !exercises.some((e) => isFinisherCardio(e.n))) exercises.push({ ...lib(FINISHER), sets: 1, reps: [10, 15], finisher: true });
    next = { ...next, [d]: { ...next[d], exercises } };
  }
  if (restyled) {
    const eg = next.push.exercises.find((e) => !isCardio(e.n));
    lines.push({
      strength: "Lower reps and longer rest on every lift, to build strength",
      lean: "A few more reps and shorter rest on every lift, to keep the pace up",
      standard: "Rep ranges back to the standard muscle-building ranges",
    }[style] + (eg ? ` (e.g. ${eg.n}: ${eg.sets} × ${eg.reps[0]}–${eg.reps[1]}, ${eg.rest}s rest).` : "."));
  }
  const hadFinisher = allDays(program).some((d) => program[d].exercises.some((e) => e.finisher));
  if (finisher && !hadFinisher) lines.push("A 10–15 min incline walk at the end of each day.");
  if (!finisher && hadFinisher) lines.push("Drop the incline-walk finisher.");
  return { program: next, lines };
}

/** The lifts a coach owns in the current rotation, as { day, n }. */
export function coachLifts(program, coach) {
  return activeDays(program).flatMap((day) => program[day].exercises.filter((e) => coachFor(e.n) === coach).map((e) => ({ day, n: e.n })));
}

/** Library lifts a coach could add (core and cardio coaches' whole lists; others by muscle). */
export function coachOptions(program, coach) {
  const have = new Set(activeDays(program).flatMap((d) => program[d].exercises.map((e) => e.n)));
  return LIBRARY.filter((e) => coachFor(e.n) === coach && !have.has(e.n)).map((e) => e.n);
}

/** Applies a coach's checklist: `drop` lifts ({day, n}) come off; `add` names join the coach's day,
    or the end of every day for core and cardio. Returns { program, lines }. */
export function applyPicks(program, coach, { drop = [], add = [] }) {
  let next = program;
  const lines = [];
  for (const { day, n } of drop) {
    next = { ...next, [day]: { ...next[day], exercises: next[day].exercises.filter((e) => e.n !== n) } };
    lines.push(`Remove ${n} from ${next[day].name}`);
  }
  const home = HOME[coach] && !next[HOME[coach]]?.off ? HOME[coach] : "push";
  const targets = EVERY_DAY.has(coach) ? activeDays(next) : [home];
  for (const n of add) {
    const ex = lib(n) || { n, sets: 3, reps: [8, 12], rest: 60, custom: true };
    for (const day of targets) {
      if (next[day].exercises.some((e) => e.n === n)) continue;
      next = { ...next, [day]: { ...next[day], exercises: [...next[day].exercises, { ...ex }] } };
    }
    lines.push(EVERY_DAY.has(coach) ? `Add ${n} to the end of every day` : `Add ${n} to ${next[home].name}`);
  }
  return { program: next, lines };
}

/** Coaches still to meet, in order. */
export const coachesLeft = (setup = {}) => COACH_ORDER.filter((id) => !setup[id]);

/** The head coach also counts as unmet until the goals part is done. */
export const needsSetup = (prefs, id) => !prefs?.coachSetup?.[id] || (id === headCoach(prefs) && !prefs?.profile?.doneAt);
/** The next coach to meet, head coach first, or null when everyone is set up. */
export const nextCoachToMeet = (prefs) => { const h = headCoach(prefs); return needsSetup(prefs, h) ? h : COACH_ORDER.find((id) => needsSetup(prefs, id)) || null; };

/** Adds the 10-15 min incline-walk finisher to the end of every active day without cardio. Returns { program, lines }. */
export function addFinisher(program) {
  let next = program;
  for (const d of activeDays(program)) {
    if (program[d].exercises.some((e) => isFinisherCardio(e.n))) continue; // a warm-up isn't a finisher
    next = { ...next, [d]: { ...next[d], exercises: [...next[d].exercises, { ...lib(FINISHER), sets: 1, reps: [10, 15], finisher: true }] } };
  }
  return { program: next, lines: next === program ? [] : ["A 10–15 min incline walk at the end of each day."] };
}
