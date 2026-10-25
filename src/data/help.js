import {
  Play, Eye, Bell, ArrowLeftRight, Target, CalendarCheck, Scale, Trophy, TrendingUp, Flag, List, CalendarDays, Pencil,
  Gauge, LineChart, Pin, Hash, History, Dumbbell, Plus, FileSpreadsheet, Users, MessageCircle, Sparkles, SlidersHorizontal, Download, ClipboardPaste, Utensils, PieChart, Copy, CircleUser, Timer,
} from "lucide-react";

/* What each screen is for, shown from the (i) in its header as a short tap-through: one feature per
   card. `name` is the feature as it appears in the app, shown as a chip; `spot` is the data-help
   attribute of that part of the screen, so the chip can point at it ("Show me"). In `text`,
   [Name] renders as an inline chip: use it for anything the lifter can see or tap. Keep each line
   to about a dozen words. */
export const HELP = {
  today: {
    title: "Today",
    steps: [
      { name: "Start lifting", Icon: Play, spot: "start", text: "Opens the next day in your rotation." },
      { name: "Preview", Icon: Eye, spot: "preview", text: "Tap the card to look through the day's lifts before you start." },
      { name: "Change", Icon: ArrowLeftRight, spot: "change", text: "Train a different day or a custom workout instead." },
      { name: "Targets", Icon: Target, text: "Each lift aims one rep or one set past last time. [↑] means add weight." },
      { name: "This week", Icon: CalendarCheck, spot: "week", text: "Dots mark the days you trained." },
      { name: "Weigh-in", Icon: Scale, spot: "weigh", text: "Once a week, for your bodyweight chart. [✕] skips to Sunday." },
      { name: "Week in review", Icon: Sparkles, spot: "review", text: "On your review day, your coaches look back at your week." },
    ],
  },
  summary: {
    title: "Workout summary",
    steps: [
      { name: "Your usual", Icon: CalendarCheck, text: "Numbers are judged against your own usual. ✓ marks one that's better, ! one that's worse; anything else is normal for you. For sleep, resting heart rate and HRV, your usual is your typical night over the last 4 weeks." },
      { name: "Records", Icon: Trophy, spot: "records", text: "Lifts where you beat your best [Est. max]." },
      { name: "Est. max", Icon: Gauge, text: "The most you could likely lift once, worked out from your best set." },
      { name: "Last time", Icon: TrendingUp, spot: "vs-last", text: "Each lift's best set, [Up], [Same] or [Down] on last time." },
      { name: "First time", Icon: Flag, text: "A new lift sets the baseline to beat next time." },
    ],
  },
  workouts: {
    title: "Workouts",
    steps: [
      { name: "Workouts", Icon: List, spot: "workout", text: "Sets, total weight and PRs for every workout you've logged." },
      { name: "Calendar", Icon: CalendarDays, spot: "calendar", text: "A month view. Tap a day to see it." },
      { name: "Edit", Icon: Pencil, spot: "edit", text: "Fix a mistake in a past workout." },
    ],
  },
  progress: {
    title: "Progress",
    steps: [
      { name: "Trends", Icon: TrendingUp, spot: "views", text: "How your lifts and weight are moving. [Workouts] lists every session." },
      { name: "Est. max", Icon: Gauge, text: "The most you could likely lift once. 80 lb × 12 ≈ 112 lb." },
      { name: "Trend", Icon: TrendingUp, spot: "trend", text: "How much a lift has moved lately, counting fatigue: a lift done late isn't a drop." },
      { name: "PR", Icon: Trophy, spot: "pr", text: "A glowing row is a PR from your last workout. A [PR] stamp, the last two weeks." },
      { name: "Charts", Icon: LineChart, spot: "charts", text: "Swipe the top card for your lifts. [Edit] picks which, up to 8. Hold a chart to read a point." },
      { name: "Bulk or cut", Icon: Scale, spot: "phase", text: "Set a target weight. Your coaches track your pace." },
      { name: "Your lifts", Icon: Dumbbell, spot: "lift", text: "Tap one for its chart and records." },
    ],
  },
  progressNutrition: {
    title: "Nutrition over time",
    steps: [
      { name: "Averages", Icon: PieChart, text: "What you ate a day against your targets. A day under 45% of your calorie target is probably only partly logged, so it's left out." },
      { name: "On goal", Icon: Target, text: "Calories within 10% of target count as on goal. Protein counts as hit at 90% of target or more." },
      { name: "Is it working?", Icon: Scale, text: "Your weight trend against your goal's pace. With 10+ logged days and a few weigh-ins, your log and the scale show what you really burn, and what to eat for your pace." },
      { name: "Charts", Icon: LineChart, text: "One bar a day, the line is your target. Orange bars work against your goal. Hold a chart to read a day." },
    ],
  },
  lift: {
    title: "Lift detail",
    steps: [
      { name: "Pin", Icon: Pin, spot: "pin", text: "Give this lift a page in the chart at the top of Progress. Up to 8." },
      { name: "Chart", Icon: LineChart, spot: "metric", text: "Switch between [Est. max], [Top set] and [Volume] over time." },
      { name: "Best by reps", Icon: Hash, spot: "rep-records", text: "Your heaviest weight for each number of reps." },
      { name: "Recent sessions", Icon: History, spot: "sessions", text: "Tap one to open that workout." },
    ],
  },
  nutrition: {
    title: "Nutrition",
    steps: [
      { name: "Calories left", Icon: PieChart, spot: "summary", text: "What's left of today's calories, and your protein, carbs and fat." },
      { name: "Add", Icon: Plus, spot: "meal", text: "Log food: describe it to your head coach, pick a recent food, search, or enter it manually." },
      { name: "Describe a meal", Icon: MessageCircle, text: "Say what you ate in your own words. Your head coach itemizes it and saves it as one food." },
      { name: "Copy", Icon: Copy, text: "An empty meal can copy yesterday's in one tap." },
      { name: "Ask", Icon: MessageCircle, spot: "ask", text: "Ask your head coach what to eat, about your macros, or how your week's going. Same chats as on Today." },
      { name: "This week", Icon: CalendarDays, spot: "week", text: "Each day against your target. The line is your calorie target." },
    ],
  },
  settings: {
    title: "Settings",
    steps: [
      { name: "Your account", Icon: CircleUser, spot: "account", text: "Export your data, see your units, or sign out." },
      { name: "Your head coach", Icon: Users, spot: "coaches", text: "Talk through your training and food, or change your plan." },
      { name: "What they remember", Icon: MessageCircle, spot: "memory", text: "Notes your head coach keeps from your chats. Delete any, or clear the chat." },
      { name: "Change head coach", Icon: Users, spot: "head", text: "Switch who you talk to. Your chat and their notes carry over." },
      { name: "Redo setup", Icon: Sparkles, spot: "redo", text: "Meet your coaches again to reshape your plan." },
      { name: "Program", Icon: Dumbbell, spot: "program", text: "Each day's lifts, sets, reps and rest. Rename days or bring in your own program." },
      { name: "Reps in reserve", Icon: Gauge, spot: "rir", text: "Rate how many more reps you had in you." },
      { name: "Rest timer", Icon: Timer, spot: "rest", text: "A chime, a buzz, and an alert on your lock screen when rest is over." },
      { name: "Track food & macros", Icon: Utensils, spot: "nutrition", text: "Adds a Nutrition tab with daily calorie and macro targets." },
      { name: "Week in review", Icon: Sparkles, spot: "review", text: "Turn it on or off, pick its release day, and get a notification when it's ready." },
    ],
  },
  programs: {
    title: "Program",
    steps: [
      { name: "Your days", Icon: Dumbbell, spot: "program", text: "Tap one to change its lifts, sets, reps and rest." },
      { name: "Rename workouts", Icon: Pencil, spot: "rename", text: "Call your days whatever you call them." },
      { name: "Bring in your own program", Icon: ClipboardPaste, spot: "import", text: "Paste a program you already run. Your head coach can review it." },
    ],
  },
  program: {
    title: "Edit a day",
    steps: [
      { name: "Lifts", Icon: SlidersHorizontal, spot: "prog-lift", text: "Tap one to change its sets, reps, rest or cue." },
      { name: "Add a lift", Icon: Plus, spot: "add-lift", text: "Add, remove or reorder. Past workouts stay as they were." },
    ],
  },
  export: {
    title: "Export",
    steps: [
      { name: "CSV", Icon: FileSpreadsheet, spot: "format", text: "Opens in Sheets, Numbers or Excel." },
      { name: "JSON", Icon: FileSpreadsheet, spot: "format", text: "A full backup of everything." },
    ],
  },
  coaches: {
    title: "Coaches",
    steps: [
      { name: "Your crew", Icon: Users, spot: "coaches", text: "One coach per muscle group. Meet each once to pick their lifts." },
      { name: "Your head coach", Icon: MessageCircle, text: "Who you talk to after setup. A chat quiet for an hour starts fresh next time; past chats stay 30 days. It sees 30 days of workouts and food and remembers what you tell it. Nothing changes until you tap [Apply]." },
      { name: "In your workout", Icon: Dumbbell, text: "Each lift's coach calls a cue and reacts to your sets." },
    ],
  },
};
