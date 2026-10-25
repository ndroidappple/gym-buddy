import { LIBRARY } from "./program.js";

/* Six coaches, one per training area, so every lift (including ones added later) has a coach.
   `body` is the coach's outline in Coach.jsx; `color` tints the body and the coach's speech. */
export const COACHES = {
  tank: { name: "Tank", group: "Chest & triceps", body: "clover", color: "#5BD68A" },
  wings: { name: "Wings", group: "Back & biceps", body: "ghost", color: "#B9A6FF" },
  boulder: { name: "Boulder", group: "Shoulders", body: "rock", color: "#FFC93D" },
  piston: { name: "Piston", group: "Legs", body: "hex", color: "#FF9A4D" },
  brick: { name: "Brick", group: "Core", body: "square", color: "#6FA8FF" },
  dash: { name: "Dash", group: "Cardio", body: "heart", color: "#FF6F91" },
};
export const COACH_ORDER = ["tank", "wings", "boulder", "piston", "brick", "dash"];

/* The head coach is the one the lifter talks to: the whole plan, food included, in one conversation
   with one memory. Picked at sign-up; the others stay as the crew that coaches each lift in the gym.
   `vibe` is how each one coaches, shown when picking (api/coach.js has the matching voice). */
export const VIBES = {
  tank: "Tough love. Keeps you honest.",
  wings: "Calm and technical. Lives for good form.",
  boulder: "Steady and patient. Slow gains are still gains.",
  piston: "All energy. Never skips leg day, won't let you either.",
  brick: "No-nonsense. Short answers, solid plans.",
  dash: "Upbeat. Big on habits and showing up.",
};
// What each coach says when they come up in the picker, in their own voice.
export const HELLOS = {
  tank: "Excuses don't lift. You do.",
  wings: "Slow it down. Feel every rep.",
  boulder: "No rush. We build this one rep at a time.",
  piston: "Leg day? Every day. LET'S GO!",
  brick: "Show up. Lift. Go home.",
  dash: "Showing up is the win. Let's make it a habit!",
};
export const headCoach = (prefs) => (COACHES[prefs?.headCoach] ? prefs.headCoach : "tank");

/* Checked in order: the more specific muscle wins (Leg Press is legs before "press" is chest,
   Face Pulls is shoulders before "pull" is back). */
const RULES = [
  ["brick", /crunch|plank|leg raise|\bab\b|rollout|pallof|russian twist/],
  ["piston", /squat|leg press|lunge|step-up|leg extension|calf|leg curl|romanian|\brdl\b|deadlift|good morning|hip thrust|nordic|abduction|adduction/],
  ["dash", /treadmill|bike|cycl|rower|rowing|stair|elliptical|\brun\b|incline walk|jog|sprint|jump rope|swim|sled/],
  ["tank", /tricep|skull|pushdown|close-grip|dips \(upright\)|extension/],
  ["wings", /curl/],
  ["boulder", /shoulder|lateral|rear delt|face pull|upright row|overhead press|arnold|front raise|reverse pec|y-raise/],
  ["wings", /pulldown|row|pull-up|chin-up|pullover|shrug|straight-arm/],
  ["tank", /press|fly|pec|bench|dip|push-up|crossover/],
];
const GROUP_FALLBACK = { Chest: "tank", Back: "wings", Shoulders: "boulder", Arms: "wings", Legs: "piston", Core: "brick", Cardio: "dash" };

const cache = new Map();
export function coachFor(exercise) {
  if (cache.has(exercise)) return cache.get(exercise);
  const n = exercise.toLowerCase();
  let id = RULES.find(([, re]) => re.test(n))?.[0];
  if (!id) id = GROUP_FALLBACK[LIBRARY.find((l) => l.n === exercise)?.g] || "tank";
  cache.set(exercise, id);
  return id;
}

/** Distinct coaches for a list of exercises, in order of first appearance. */
export const coachesFor = (names) => [...new Set(names.map(coachFor))];
