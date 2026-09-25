/* What each screen is for, shown from the (i) button in its header. Plain, short, second person:
   only what's worth knowing, one idea per point. */
export const HELP = {
  today: {
    title: "Today",
    sub: "What to train next.",
    points: [
      "Start lifting opens the next day in your rotation. Tap Change to train a different day or a custom workout.",
      "Beat these are your best sets from last time. Top one of them today.",
      "The dots show which days you trained this week.",
      "Weigh in once a week for your bodyweight chart, or tap ✕ to skip until Monday.",
    ],
  },
  summary: {
    title: "Workout summary",
    sub: "How this workout went.",
    points: [
      "Records are lifts where you beat your best est. max (estimated one-rep max, or 1RM): the most you could likely lift for a single rep, worked out from your best set.",
      "Beat last time and below last time compare each lift with the last time you did it.",
      "First time logged sets the baseline to beat next time.",
    ],
  },
  history: {
    title: "History",
    sub: "Every workout you've logged.",
    points: [
      "Each card shows your sets, total weight lifted and any PRs.",
      "Tap the calendar icon for a month view: dots mark workout days, tap a day to see it.",
      "Tap the pencil to fix a mistake.",
    ],
  },
  progress: {
    title: "Progress",
    sub: "Is each lift getting stronger?",
    points: [
      "Est. max (estimated one-rep max, or 1RM) is the most you could likely lift for a single rep, worked out from your best set. 80 lb × 12 ≈ 112 lb.",
      "The arrow shows how much it's changed recently. Baseline means you've logged it once.",
      "A glowing row means you just set a PR on that lift.",
      "Start a bulk or cut to set a target weight or weekly rate. The chart shows your goal line and the coaches read your pace from your weigh-ins.",
      "Tap a lift for its chart and records.",
    ],
  },
  lift: {
    title: "Lift detail",
    sub: "Everything about one lift.",
    points: [
      "Est. max (estimated one-rep max, or 1RM) is the most you could likely lift for a single rep, worked out from your best set. 80 lb × 12 ≈ 112 lb.",
      "The chart shows est. max, top set or total weight over time. PRs are marked.",
      "Rep records are your heaviest weight for each number of reps.",
      "Tap a session to open it.",
    ],
  },
  settings: {
    title: "Settings",
    sub: "Make GymBuddy yours.",
    points: [
      "Program: change each day's lifts, sets, reps, rest and cues.",
      "Reps in reserve: turn on to note how many more reps you had left.",
      "Export: download a copy of all your data.",
    ],
  },
  program: {
    title: "Edit a day",
    sub: "The lifts this day starts with.",
    points: [
      "Tap a lift to change its sets, reps, rest or cue.",
      "Add, remove or reorder lifts. Past workouts stay as they were.",
    ],
  },
  export: {
    title: "Export",
    sub: "A copy of your data you control.",
    points: [
      "CSV opens in Sheets, Numbers or Excel.",
      "JSON is a full backup.",
    ],
  },
  coaches: {
    title: "Coaches",
    sub: "One coach for each muscle group.",
    points: [
      "Say hi to each coach once to shape your plan: Tank sets your goals and training days, then each coach lets you pick their lifts.",
      "Your coach shows up on each lift with a cue and reacts to your sets.",
      "Tap a coach to ask a question or change your program. Nothing changes until you tap Apply.",
    ],
  },
};
