/* What each screen is for, shown from the (i) button in its header. Plain, short, second person. */
export const HELP = {
  today: {
    title: "Today",
    sub: "Your starting point each time you open GymBuddy.",
    points: [
      "The big button starts the next day in your rotation, or picks up a session you left mid-way.",
      "Your week shows which days you trained, coloured by the day's plate.",
      "\"Beat these\" lists the numbers to top from last time.",
      "Log your bodyweight here; a weekly reminder keeps the trend honest.",
      "Tap the coach at the top to meet all six coaches.",
    ],
  },
  history: {
    title: "History",
    sub: "Every session you've logged, newest first.",
    points: [
      "Each card shows the sets, volume and any PRs from that day.",
      "Tap the pencil to fix a session: numbers, date, bodyweight or note.",
      "Tap a lift to see its full progress.",
    ],
  },
  progress: {
    title: "Progress",
    sub: "Whether each lift is moving up.",
    points: [
      "Lifts are grouped by day, each with its best estimated one-rep max (e1RM) and a trend.",
      "The trend compares your recent best with the sessions before it, so one off day doesn't swing it.",
      "Your bodyweight trend sits here too.",
      "Tap a lift for its chart, rep records and recent sessions. Cardio shows up in History and on its own log.",
    ],
  },
  lift: {
    title: "Lift detail",
    sub: "Everything about one lift.",
    points: [
      "The chart tracks e1RM, top set or volume; PRs are marked.",
      "Rep records show the heaviest weight you've moved for each rep count.",
      "Recent sessions list every set; tap one to open that session.",
    ],
  },
  settings: {
    title: "Settings",
    sub: "Make GymBuddy yours.",
    points: [
      "Program: change the lifts, sets, reps, rest and cues for each day.",
      "Display: dark mode, and whether to rate reps in reserve (RIR) on each set.",
      "Home screen: pick an app icon and see how to add GymBuddy to your home screen.",
      "Data: export everything as CSV or JSON.",
    ],
  },
  program: {
    title: "Edit a day",
    sub: "The lifts this day starts with.",
    points: [
      "Tap a lift to change its sets, rep range, rest time and form cue.",
      "Use the arrows to reorder, or add lifts and cardio from the library.",
      "Changes apply to future sessions; past sessions stay as logged.",
    ],
  },
  export: {
    title: "Export",
    sub: "Take your data anywhere.",
    points: [
      "CSV opens in Numbers, Excel or Google Sheets: one row per set, plus weigh-ins.",
      "JSON is the full backup of your sessions, program and weigh-ins.",
    ],
  },
  coaches: {
    title: "Coaches",
    sub: "Six coaches, one for each training area.",
    points: [
      "Each lift gets the coach for its muscle group; cardio gets Dash.",
      "Coaches read your form cues, react to your sets and celebrate PRs.",
      "Tap a coach to ask a question. Answers use your logged sets.",
    ],
  },
};
