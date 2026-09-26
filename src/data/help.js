import {
  Play, ArrowLeftRight, Target, CalendarCheck, Scale, Trophy, TrendingUp, Flag, List, CalendarDays, Pencil,
  Gauge, LineChart, Hash, History, Dumbbell, Plus, FileSpreadsheet, Users, MessageCircle, Sparkles, SlidersHorizontal, Download,
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
      { name: "Change", Icon: ArrowLeftRight, spot: "change", text: "Train a different day or a custom workout instead." },
      { name: "Targets", Icon: Target, text: "Each lift aims one rep or one set past last time. [↑] means add weight." },
      { name: "This week", Icon: CalendarCheck, spot: "week", text: "Dots mark the days you trained." },
      { name: "Weigh-in", Icon: Scale, spot: "weigh", text: "Once a week, for your bodyweight chart. [✕] skips to Monday." },
    ],
  },
  summary: {
    title: "Workout summary",
    steps: [
      { name: "Records", Icon: Trophy, spot: "records", text: "Lifts where you beat your best [Est. max]." },
      { name: "Est. max", Icon: Gauge, text: "The most you could likely lift once, worked out from your best set." },
      { name: "Last time", Icon: TrendingUp, spot: "vs-last", text: "Each lift marked [Beat], [Matched] or [Below] last time." },
      { name: "First time", Icon: Flag, text: "A new lift sets the baseline to beat next time." },
    ],
  },
  history: {
    title: "History",
    steps: [
      { name: "Workouts", Icon: List, spot: "workout", text: "Sets, total weight and PRs for every workout you've logged." },
      { name: "Calendar", Icon: CalendarDays, spot: "calendar", text: "A month view. Tap a day to see it." },
      { name: "Edit", Icon: Pencil, spot: "edit", text: "Fix a mistake in a past workout." },
    ],
  },
  progress: {
    title: "Progress",
    steps: [
      { name: "Est. max", Icon: Gauge, text: "The most you could likely lift once. 80 lb × 12 ≈ 112 lb." },
      { name: "Trend", Icon: TrendingUp, spot: "trend", text: "How much a lift has moved lately. [Baseline] means logged once." },
      { name: "PR", Icon: Trophy, spot: "pr", text: "A glowing row is a PR from your last workout. A [PR] stamp, the last two weeks." },
      { name: "Bulk or cut", Icon: Scale, spot: "phase", text: "Set a target weight. Your coaches track your pace." },
      { name: "Your lifts", Icon: Dumbbell, spot: "lift", text: "Tap one for its chart and records." },
    ],
  },
  lift: {
    title: "Lift detail",
    steps: [
      { name: "Chart", Icon: LineChart, spot: "metric", text: "Switch between [Est. max], [Top set] and [Volume] over time." },
      { name: "Best by reps", Icon: Hash, spot: "rep-records", text: "Your heaviest weight for each number of reps." },
      { name: "Recent sessions", Icon: History, spot: "sessions", text: "Tap one to open that workout." },
    ],
  },
  settings: {
    title: "Settings",
    steps: [
      { name: "Program", Icon: Dumbbell, spot: "program", text: "Each day's lifts, sets, reps and rest." },
      { name: "Redo setup", Icon: Sparkles, spot: "redo", text: "Meet your coaches again to reshape your plan." },
      { name: "Reps in reserve", Icon: Gauge, spot: "rir", text: "Rate how many more reps you had in you." },
      { name: "Export", Icon: Download, spot: "export", text: "Download a copy of all your data." },
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
      { name: "Your coaches", Icon: Users, spot: "coaches", text: "One per muscle group. Meet each once to shape your plan." },
      { name: "Ask a coach", Icon: MessageCircle, spot: "coaches", text: "Ask anything or change your program. Nothing changes until you tap [Apply]." },
      { name: "In your workout", Icon: Dumbbell, text: "Your coach calls a cue on each lift and reacts to your sets." },
    ],
  },
};
