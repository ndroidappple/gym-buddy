/* Program definition — imported from Week2_Running_Log.xlsx */
export const PROGRAM = {
  push: { name: "Push", detail: "Chest + Triceps", exercises: [
    { n: "Incline Barbell / Smith Press", sets: 4, reps: [6,10], rest: 120, cue: "Lead with upper chest, not shoulders. 3 sec down." },
    { n: "Flat DB Press", sets: 3, reps: [8,12], rest: 90, cue: "Slow eccentric. Squeeze at top like touching elbows together." },
    { n: "Machine Pec Dec", sets: 3, reps: [10,15], rest: 90, cue: "Your best MMC lift. Elbows at shoulder height. Squeeze 1 sec at centre." },
    { n: "Cable Fly (Low to High)", sets: 3, reps: [12,15], rest: 60, cue: "Hug a barrel. Arc upward, squeeze knuckles at top." },
    { n: "Tricep Pushdown (Rope)", sets: 3, reps: [10,15], rest: 60, cue: "Elbows glued to sides. Spread the rope at the bottom." },
    { n: "Overhead Tricep Extension", sets: 3, reps: [10,15], rest: 60, cue: "Full stretch at top is the point. Targets the long head." },
  ]},
  pull: { name: "Pull", detail: "Back + Biceps", exercises: [
    { n: "Lat Pulldown (Wide Grip)", sets: 4, reps: [8,12], rest: 120, cue: "Shoulders down and back first. Lead with elbows. Feel lats, not biceps." },
    { n: "Seated Cable Row (Close Grip)", sets: 3, reps: [8,12], rest: 90, cue: "Elbow to hip pocket. Pause and squeeze. Chest tall." },
    { n: "Seated Row (Machine)", sets: 3, reps: [10,12], rest: 90, cue: "Full hang at the bottom — let the lat stretch. Drive the elbow up." },
    { n: "Straight-Arm Pulldown", sets: 3, reps: [12,15], rest: 60, cue: "Lower lat priority. Slight forward lean, arms locked, sweep to thighs." },
    { n: "Face Pulls", sets: 3, reps: [15,20], rest: 60, cue: "Pull to forehead, elbows high. Slow and controlled." },
    { n: "Seated DB Curl", sets: 3, reps: [10,12], rest: 60, cue: "Zero swinging. Squeeze at top, slow down." },
    { n: "Hammer Curl", sets: 3, reps: [10,12], rest: 60, cue: "Neutral grip hits brachialis — arm thickness." },
  ]},
  legs: { name: "Legs", detail: "Quads + Hams + Glutes", exercises: [
    { n: "Leg Press (Heavy)", sets: 4, reps: [8,12], rest: 120, cue: "Feet shoulder-width, mid-platform. Knees to 90°. Chase weight." },
    { n: "Romanian Deadlift", sets: 3, reps: [10,12], rest: 120, cue: "Hinge at hips, push hips BACK until hams stretch. Bar close to legs." },
    { n: "Bulgarian Split Squat", sets: 3, reps: [8,10], rest: 90, cue: "Rear foot on bench. Front knee tracks over toes." },
    { n: "Leg Extension", sets: 3, reps: [12,15], rest: 60, cue: "Pause 1 sec at top, squeeze the quad. Don't let it crash." },
    { n: "Leg Curl", sets: 3, reps: [12,15], rest: 60, cue: "Curl all the way, pause at peak. Hams love full ROM." },
    { n: "Leg Adduction", sets: 2, reps: [15,20], rest: 60, cue: "Squeeze at close. Slow return. No momentum." },
  ]},
  shoulders: { name: "Shoulders", detail: "Delts + Arms", exercises: [
    { n: "Seated DB Shoulder Press", sets: 4, reps: [8,12], rest: 90, cue: "Don't lock out — keep tension. Lower to 90°. Brace core." },
    { n: "Lateral Raise (Cable)", sets: 4, reps: [12,20], rest: 60, cue: "Most important for width. Lead with elbows, hold 0.5 sec. No shrug." },
    { n: "Rear Delt Fly", sets: 3, reps: [15,20], rest: 60, cue: "Elbows slightly bent, arc wide. Squeeze blades at the end." },
    { n: "Upright Row (Cable)", sets: 3, reps: [12,15], rest: 60, cue: "Pull to chin, elbows lead. Don't go heavy — feel side delts." },
    { n: "Incline DB Curl", sets: 3, reps: [10,12], rest: 60, cue: "Sit at 45°, arms hang straight down. Full stretch = max growth." },
    { n: "Skull Crushers", sets: 3, reps: [10,12], rest: 60, cue: "Lower slowly beside your head — 3 sec. Elbows fixed." },
  ]},
};
export const DAYS = ["push", "pull", "legs", "shoulders"];

/** Cardio entries log minutes (+ optional miles) instead of weight × reps. */
export const isCardio = (name) => CARDIO.has(name);

/* Searchable library for adding lifts. Defaults are starting points — edit on add. */
export const LIBRARY = [
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

/* Each day wears an IWF competition-plate color. Color identifies the day only — never good/bad. */
export const PLATES = {
  push: { kg: 25, short: "Push" },
  pull: { kg: 20, short: "Pull" },
  legs: { kg: 15, short: "Legs" },
  shoulders: { kg: 10, short: "Shldr" },
};

const CARDIO = new Set(LIBRARY.filter((e) => e.kind === "cardio").map((e) => e.n));

/** "4 × 8–12 · 90s rest" for lifts, "Cardio · 20–30 min" for cardio. */
export const specLine = (ex) => (isCardio(ex.n) ? `Cardio · ${ex.reps[0]}–${ex.reps[1]} min` : `${ex.sets} × ${ex.reps[0]}–${ex.reps[1]} · ${ex.rest}s rest`);
