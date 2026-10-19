/* Per-account display preferences, saved with the rest of the account data. */
export const DEFAULT_PREFS = {
  theme: "dark", // "dark" | "light"
  rir: false, // reps-in-reserve picker on each set; off keeps logging to weight × reps
  icon: "plates", // home screen icon, one of ICONS in icons.js
  haptics: true, // vibration on logged sets, PRs and rest end (where the browser supports it)
  sound: true, // sounds on logged sets, PRs, finishing, and the rest countdown and bell (lib/sound.js)
  view: "detailed", // "detailed" | "focused": how much grey explanation each screen shows (lib/view.js)
  // Week in review (lib/weekReview.js): on by default, out on `day` (0 = Sunday). `intro` once the
  // lifter has seen the first-time sheet; `opened`/`openedOn`: the last review opened, and when.
  weekReview: { on: true, day: 0 },
};
