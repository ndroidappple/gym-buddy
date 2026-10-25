import { CUES, refreshCues } from "./cues.js";

/* Program definition — imported from Week2_Running_Log.xlsx. Cues live in cues.js. */
const BASE_PROGRAM = {
  push: { name: "Push", detail: "Chest + Triceps", exercises: [
    { n: "Incline Barbell / Smith Press", sets: 4, reps: [6,10], rest: 150 },
    { n: "Flat DB Press", sets: 3, reps: [8,12], rest: 90 },
    { n: "Machine Pec Dec", sets: 3, reps: [10,15], rest: 90 },
    { n: "Cable Fly (Low to High)", sets: 3, reps: [12,15], rest: 60 },
    { n: "Tricep Pushdown (Rope)", sets: 3, reps: [10,15], rest: 60 },
    { n: "Overhead Tricep Extension", sets: 3, reps: [10,15], rest: 60 },
  ]},
  pull: { name: "Pull", detail: "Back + Biceps", exercises: [
    { n: "Lat Pulldown (Wide Grip)", sets: 4, reps: [8,12], rest: 120 },
    { n: "Seated Cable Row (Close Grip)", sets: 3, reps: [8,12], rest: 90 },
    { n: "Seated Row (Machine)", sets: 3, reps: [10,12], rest: 90 },
    { n: "Straight-Arm Pulldown", sets: 3, reps: [12,15], rest: 60 },
    { n: "Face Pulls", sets: 3, reps: [15,20], rest: 60 },
    { n: "Seated DB Curl", sets: 3, reps: [10,12], rest: 60 },
    { n: "Hammer Curl", sets: 3, reps: [10,12], rest: 60 },
  ]},
  legs: { name: "Legs", detail: "Quads + Hams + Glutes", exercises: [
    { n: "Leg Press (Heavy)", sets: 4, reps: [8,12], rest: 120 },
    { n: "Romanian Deadlift", sets: 3, reps: [10,12], rest: 120 },
    { n: "Bulgarian Split Squat", sets: 3, reps: [8,10], rest: 90 },
    { n: "Leg Extension", sets: 3, reps: [12,15], rest: 60 },
    { n: "Leg Curl", sets: 3, reps: [12,15], rest: 60 },
    { n: "Leg Adduction", sets: 2, reps: [15,20], rest: 60 },
  ]},
  shoulders: { name: "Shoulders", detail: "Delts + Arms", exercises: [
    { n: "Seated DB Shoulder Press", sets: 4, reps: [8,12], rest: 90 },
    { n: "Lateral Raise (Cable)", sets: 4, reps: [12,20], rest: 60 },
    { n: "Rear Delt Fly", sets: 3, reps: [15,20], rest: 60 },
    { n: "Upright Row (Cable)", sets: 3, reps: [12,15], rest: 60 },
    { n: "Incline DB Curl", sets: 3, reps: [10,12], rest: 60 },
    { n: "Skull Crushers", sets: 3, reps: [10,12], rest: 60 },
  ]},
};
/* A custom workout: starts empty, lifts are added for that session only. It lives in the program so
   names and colours resolve like any day, but it's never edited as a day, and it doesn't use up a
   day in the rotation (see nextDayAfter). */
export const CUSTOM = "custom";
const CUSTOM_DAY = { name: "Custom", detail: "Your pick of lifts", exercises: [], virtual: true };

/* The most rest a lift ever gets, in seconds. The timer, the program editor, setup styles and coach
   changes all stop here, and a saved program over it is brought down when it loads. */
export const MAX_REST = { "Incline Barbell / Smith Press": 150 };
export const capRest = (n, sec) => (MAX_REST[n] != null && sec > MAX_REST[n] ? MAX_REST[n] : sec);
/** `program` with every lift's rest within its MAX_REST (the same object when nothing was over). */
function capRests(program) {
  const over = (ex) => capRest(ex.n, ex.rest) !== ex.rest;
  if (!Object.values(program).some((p) => p.exercises?.some(over))) return program;
  return Object.fromEntries(Object.entries(program).map(([day, p]) => [day,
    p.exercises?.some(over) ? { ...p, exercises: p.exercises.map((ex) => (over(ex) ? { ...ex, rest: capRest(ex.n, ex.rest) } : ex)) } : p]));
}

/** Normalises a saved program: current cues, rests within their max, and the custom day present. */
export const normalizeProgram = (p) => { const q = capRests(refreshCues(p)); return q[CUSTOM] ? q : { ...q, [CUSTOM]: CUSTOM_DAY }; };

export const PROGRAM = normalizeProgram(BASE_PROGRAM);
/** The four built-in day slots. A day can be switched off (`off: true`), e.g. a 3-day split. */
export const DAYS = ["push", "pull", "legs", "shoulders"];
/** Extra slots, only present in a program that uses them (a pasted-in program with 5+ workouts).
    Each has its own colour in styles.css. */
export const EXTRA_DAYS = ["day5", "day6", "day7"];
export const MAX_DAYS = DAYS.length + EXTRA_DAYS.length;
/** Every day slot this program has, in rotation order (never the custom workout). */
export const allDays = (program) => [...DAYS, ...EXTRA_DAYS.filter((d) => program?.[d])];
/** The days in the rotation right now, in order. */
export const activeDays = (program) => allDays(program).filter((d) => program?.[d] && !program[d].off);

/* A cardio warm-up: any cardio done at the start of a day, e.g. "Stair Climber (Warm-up)". It's its own
   entry so a day can open with 5 easy minutes and still finish on the same machine: sessions key sets
   by name, and the warm-up's history stays separate from the finisher's. */
export const WARMUP_SUFFIX = " (Warm-up)";
export const WARMUP_MIN = 5;
export const WARMUP_CUE = "Easy pace, you could hold a conversation. Just getting warm, not a workout.";
export const isWarmup = (name) => typeof name === "string" && name.endsWith(WARMUP_SUFFIX);
/** "Stair Climber (Warm-up)" → "Stair Climber". */
export const baseOf = (name) => (isWarmup(name) ? name.slice(0, -WARMUP_SUFFIX.length) : name);
/** The program entry for a warm-up on this cardio machine. */
export const warmupOf = (cardioName) => ({
  n: baseOf(cardioName) + WARMUP_SUFFIX, kind: "cardio", warmup: true,
  sets: 1, reps: [WARMUP_MIN, WARMUP_MIN], rest: 0, cue: WARMUP_CUE,
});

/** Cardio entries log minutes (+ optional miles) instead of weight × reps. Warm-ups are cardio too. */
export const isCardio = (name) => CARDIO.has(baseOf(name));
/** Cardio that isn't a warm-up: a finisher or a cardio day. */
export const isFinisherCardio = (name) => isCardio(name) && !isWarmup(name);
/** The library's cardio machines, for picking a warm-up. */
export const cardioLibrary = () => LIBRARY.filter((e) => e.kind === "cardio");

/* Searchable library for adding lifts. Defaults are starting points — edit on add. */
const BASE_LIBRARY = [
  // Chest
  { n: "Flat Barbell Bench Press", g: "Chest", sets: 4, reps: [6,10], rest: 120 },
  { n: "Incline DB Press", g: "Chest", sets: 3, reps: [8,12], rest: 90 },
  { n: "Decline Press", g: "Chest", sets: 3, reps: [8,12], rest: 90 },
  { n: "Cable Fly (High to Low)", g: "Chest", sets: 3, reps: [12,15], rest: 60 },
  { n: "Cable Crossover", g: "Chest", sets: 3, reps: [12,15], rest: 60 },
  { n: "Chest Press (Machine)", g: "Chest", sets: 3, reps: [8,12], rest: 90 },
  { n: "Dips (Chest Lean)", g: "Chest", sets: 3, reps: [8,12], rest: 90 },
  { n: "Push-Up", g: "Chest", sets: 3, reps: [12,20], rest: 60 },
  // Back
  { n: "Pull-Up", g: "Back", sets: 4, reps: [6,10], rest: 120 },
  { n: "Chin-Up", g: "Back", sets: 3, reps: [6,10], rest: 120 },
  { n: "Barbell Row", g: "Back", sets: 4, reps: [8,10], rest: 120 },
  { n: "Single-Arm DB Row", g: "Back", sets: 3, reps: [8,12], rest: 90 },
  { n: "T-Bar Row", g: "Back", sets: 3, reps: [8,12], rest: 90 },
  { n: "Chest-Supported Row", g: "Back", sets: 3, reps: [10,12], rest: 90 },
  { n: "Lat Pulldown (Neutral Grip)", g: "Back", sets: 3, reps: [8,12], rest: 90 },
  { n: "Lat Pulldown (Underhand)", g: "Back", sets: 3, reps: [8,12], rest: 90 },
  { n: "Straight-Arm Pulldown", g: "Back", sets: 3, reps: [12,15], rest: 60 },
  { n: "Pullover (Cable or DB)", g: "Back", sets: 3, reps: [10,15], rest: 60 },
  { n: "Shrugs", g: "Back", sets: 3, reps: [10,15], rest: 60 },
  { n: "Deadlift", g: "Back", sets: 3, reps: [4,6], rest: 180 },
  // Shoulders
  { n: "Overhead Press (Barbell)", g: "Shoulders", sets: 4, reps: [6,10], rest: 120 },
  { n: "Arnold Press", g: "Shoulders", sets: 3, reps: [8,12], rest: 90 },
  { n: "Lateral Raise (DB)", g: "Shoulders", sets: 4, reps: [12,20], rest: 60 },
  { n: "Lateral Raise (Machine)", g: "Shoulders", sets: 3, reps: [12,20], rest: 60 },
  { n: "Front Raise", g: "Shoulders", sets: 3, reps: [12,15], rest: 60 },
  { n: "Reverse Pec Dec", g: "Shoulders", sets: 3, reps: [15,20], rest: 60 },
  { n: "Cable Y-Raise", g: "Shoulders", sets: 3, reps: [12,15], rest: 60 },
  // Arms
  { n: "Barbell Curl", g: "Arms", sets: 3, reps: [8,12], rest: 60 },
  { n: "EZ-Bar Curl", g: "Arms", sets: 3, reps: [8,12], rest: 60 },
  { n: "Preacher Curl", g: "Arms", sets: 3, reps: [10,12], rest: 60 },
  { n: "Cable Curl", g: "Arms", sets: 3, reps: [10,15], rest: 60 },
  { n: "Concentration Curl", g: "Arms", sets: 3, reps: [10,12], rest: 60 },
  { n: "Reverse Curl", g: "Arms", sets: 3, reps: [12,15], rest: 60 },
  { n: "Close-Grip Bench Press", g: "Arms", sets: 3, reps: [8,10], rest: 90 },
  { n: "Tricep Pushdown (Bar)", g: "Arms", sets: 3, reps: [10,15], rest: 60 },
  { n: "Single-Arm Cable Extension", g: "Arms", sets: 3, reps: [12,15], rest: 60 },
  { n: "Dips (Upright)", g: "Arms", sets: 3, reps: [8,12], rest: 90 },
  { n: "Wrist Curl", g: "Arms", sets: 3, reps: [15,20], rest: 45 },
  // Legs
  { n: "Back Squat", g: "Legs", sets: 4, reps: [6,10], rest: 180 },
  { n: "Front Squat", g: "Legs", sets: 3, reps: [6,10], rest: 150 },
  { n: "Hack Squat", g: "Legs", sets: 3, reps: [8,12], rest: 120 },
  { n: "Goblet Squat", g: "Legs", sets: 3, reps: [10,15], rest: 90 },
  { n: "Walking Lunge", g: "Legs", sets: 3, reps: [10,12], rest: 90 },
  { n: "Step-Up", g: "Legs", sets: 3, reps: [10,12], rest: 90 },
  { n: "Hip Thrust", g: "Legs", sets: 3, reps: [8,12], rest: 120 },
  { n: "Good Morning", g: "Legs", sets: 3, reps: [10,12], rest: 90 },
  { n: "Seated Leg Curl", g: "Legs", sets: 3, reps: [12,15], rest: 60 },
  { n: "Lying Leg Curl", g: "Legs", sets: 3, reps: [12,15], rest: 60 },
  { n: "Nordic Curl", g: "Legs", sets: 3, reps: [6,10], rest: 90 },
  { n: "Leg Abduction", g: "Legs", sets: 3, reps: [15,20], rest: 60 },
  { n: "Standing Calf Raise", g: "Legs", sets: 4, reps: [12,20], rest: 60 },
  { n: "Seated Calf Raise", g: "Legs", sets: 3, reps: [15,20], rest: 60 },
  // Cardio: logged as minutes + miles instead of weight × reps. reps = the minutes target.
  { n: "Treadmill Run", g: "Cardio", kind: "cardio", sets: 1, reps: [20, 30], rest: 0 },
  { n: "Incline Walk", g: "Cardio", kind: "cardio", sets: 1, reps: [20, 30], rest: 0 },
  { n: "Outdoor Run", g: "Cardio", kind: "cardio", sets: 1, reps: [20, 40], rest: 0 },
  { n: "Stationary Bike", g: "Cardio", kind: "cardio", sets: 1, reps: [15, 30], rest: 0 },
  { n: "Rower", g: "Cardio", kind: "cardio", sets: 1, reps: [10, 20], rest: 0 },
  { n: "Stair Climber", g: "Cardio", kind: "cardio", sets: 1, reps: [10, 20], rest: 0 },
  { n: "Elliptical", g: "Cardio", kind: "cardio", sets: 1, reps: [15, 30], rest: 0 },
  { n: "Jump Rope", g: "Cardio", kind: "cardio", sets: 1, reps: [5, 15], rest: 0 },
  // Core
  { n: "Cable Crunch", g: "Core", sets: 3, reps: [12,20], rest: 60 },
  { n: "Hanging Leg Raise", g: "Core", sets: 3, reps: [10,15], rest: 60 },
  { n: "Plank", g: "Core", sets: 3, reps: [30,60], rest: 60 },
  { n: "Ab Wheel Rollout", g: "Core", sets: 3, reps: [8,12], rest: 60 },
  { n: "Pallof Press", g: "Core", sets: 3, reps: [12,15], rest: 60 },
  { n: "Russian Twist", g: "Core", sets: 3, reps: [15,20], rest: 45 },
];
export const LIBRARY = BASE_LIBRARY.map((e) => (CUES[e.n] ? { ...e, cue: CUES[e.n] } : e));

/* Each day wears an IWF competition-plate color. Color identifies the day only — never good/bad. */
export const PLATES = {
  push: { kg: 25, short: "Push" },
  pull: { kg: 20, short: "Pull" },
  legs: { kg: 15, short: "Legs" },
  shoulders: { kg: 10, short: "Shldr" },
};

const CARDIO = new Set(LIBRARY.filter((e) => e.kind === "cardio").map((e) => e.n));

const minRange = (r) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`);
/** "4 × 8–12 · 90s rest" for lifts, "Cardio · 20–30 min" for cardio, "Warm-up · 5 min" for a warm-up. */
export const specLine = (ex) => (isWarmup(ex.n) ? `Warm-up · ${minRange(ex.reps)} min`
  : isCardio(ex.n) ? `Cardio · ${minRange(ex.reps)} min`
  : `${ex.sets} × ${ex.reps[0]}–${ex.reps[1]} · ${ex.rest}s rest`);
