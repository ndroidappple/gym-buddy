/* Workouts done outside GymBuddy: a timed video workout, a class, a run, recorded in Google Health
   from the watch (api/google-health.js, action "workouts"). Today offers each one GymBuddy didn't log
   itself, and counting it saves an ordinary session with no sets: its day (Legs, say) moves the
   rotation on like any other, it fills the week, and its heart rate comes in the usual way
   (lib/heart.js). What Google knows about it rides along as `ext`; the lifter's own rating of how
   hard it was is `effort` (1-10), since Google doesn't share the watch's. */

export const OUTSIDE_DAYS = 7; // how far back Today looks for workouts to count
const PAD_MS = 5 * 60_000; // the watch's recording of a GymBuddy workout starts or ends a little apart from it
const MIN_MINS = 5;
// The watch records walks on its own; offering every one would bury the real workouts.
const PASSIVE = new Set(["WALKING"]);

/**
 * The recorded workouts still to ask about, newest first: not already counted, not skipped, long
 * enough, not a walk, and not the watch's own recording of a workout logged in GymBuddy (it overlaps one).
 */
export function pendingOutside(workouts = [], sessions = [], skipped = []) {
  const counted = new Set(sessions.map((s) => s.ext?.gid).filter(Boolean));
  const skip = new Set(skipped);
  const logged = sessions.filter((s) => !s.ext && s.startedAt && s.finishedAt);
  return workouts
    .filter((w) => !counted.has(w.id) && !skip.has(w.id) && w.mins >= MIN_MINS && !PASSIVE.has(w.type)
      && !logged.some((s) => w.start < s.finishedAt + PAD_MS && w.end > s.startedAt - PAD_MS))
    .sort((a, b) => b.start - a.start);
}

/** The session a counted workout becomes: no sets, its times and what Google recorded, on `day`. */
export function outsideSession(w, day, id) {
  return {
    id, day, date: w.date, sets: {}, bw: null, note: null, startedAt: w.start, finishedAt: w.end,
    ext: { src: "google", gid: w.id, type: w.type, name: w.name, mins: w.mins, ...(w.kcal ? { kcal: w.kcal } : {}), ...(w.hrAvg ? { hrAvg: w.hrAvg } : {}) },
  };
}

export const isOutside = (s) => !!s?.ext;

/** How hard, in words, for a 1-10 rating (the same scale as Google Health's own question). */
export function effortWord(n) {
  if (!(n >= 1)) return null;
  return n <= 2 ? "Very easy" : n <= 4 ? "Easy" : n <= 6 ? "Moderate" : n <= 8 ? "Hard" : n === 9 ? "Very hard" : "All out";
}

/** "21 min · 180 kcal · avg 142 bpm": what Google recorded, for a card. */
export const outsideStats = (x) => [`${x.mins} min`, x.kcal && `${x.kcal.toLocaleString()} kcal`, x.hrAvg && `avg ${x.hrAvg} bpm`].filter(Boolean).join(" · ");

/** A counted workout in a line, for the coaches: what it was, since there are no sets to read. */
export function outsideLine(s) {
  const x = s.ext;
  const bits = [`${x.mins} min`, x.kcal && `${x.kcal} kcal`, x.hrAvg && `avg heart rate ${x.hrAvg}`, s.effort && `effort ${s.effort}/10 (${effortWord(s.effort).toLowerCase()}, their own rating)`].filter(Boolean);
  return `${x.name} done outside GymBuddy and recorded on their watch (no sets or weights logged): ${bits.join(", ")}`;
}

/** "Today 1:20 PM", "Yesterday 6:05 PM", "Mon 7:10 AM": when a recorded workout started. */
export function whenRecorded(ms, now = Date.now()) {
  const d = new Date(ms), n = new Date(now);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(n) - day(d)) / 86400_000);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const label = days <= 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short" });
  return `${label} ${time}`;
}
