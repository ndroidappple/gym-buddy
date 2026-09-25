/* Mental cues: what to focus on feeling during the set, one short line each.
   Shown on the exercise card mid-set; users can override any cue in the program editor. */
export const CUES = {
  // Chest
  "Incline Barbell / Smith Press": "Feel your upper chest lift the bar, not your front delts.",
  "Flat DB Press": "Press your elbows toward each other and feel your chest squeeze at the top.",
  "Machine Pec Dec": "Bring your elbows together and feel your chest squeeze hard in the middle.",
  "Cable Fly (Low to High)": "Scoop upward and feel your upper chest pull your hands together.",
  "Flat Barbell Bench Press": "Pin your shoulder blades back and feel your chest drive the bar up.",
  "Incline DB Press": "Feel the stretch across your upper chest, then squeeze it to press.",
  "Decline Press": "Feel your lower chest do the pushing, shoulders stay pinned back.",
  "Cable Fly (High to Low)": "Sweep down and in; feel your lower chest squeeze as your hands meet.",
  "Cable Crossover": "Hug a big tree and feel your chest pull your hands across.",
  "Chest Press (Machine)": "Drive through your palms and feel your chest, not your shoulders, push.",
  "Dips (Chest Lean)": "Lean forward and feel your chest stretch at the bottom and push you up.",
  "Push-Up": "Screw your hands into the floor and feel your chest push you away.",
  // Back
  "Lat Pulldown (Wide Grip)": "Pull your elbows down to your ribs and feel your lats, not your biceps.",
  "Seated Cable Row (Close Grip)": "Drive your elbows to your hip pockets and feel your mid-back squeeze.",
  "Seated Row (Machine)": "Let your lats stretch forward, then feel them pull your elbows back.",
  "Straight-Arm Pulldown": "Keep arms long and feel your lats sweep the bar to your thighs.",
  "Face Pulls": "Pull your hands past your ears and feel your rear delts and upper back.",
  "Pull-Up": "Pull your elbows down to your pockets and feel your lats lift you.",
  "Chin-Up": "Drive your elbows down and feel your lats and biceps share the pull.",
  "Barbell Row": "Pull the bar to your belly and feel your back squeeze, not your arms.",
  "Single-Arm DB Row": "Pull your elbow toward your hip and feel your lat stretch and contract.",
  "T-Bar Row": "Keep your chest proud and feel your mid-back pinch at the top.",
  "Chest-Supported Row": "Stay glued to the pad and feel your shoulder blades squeeze together.",
  "Lat Pulldown (Neutral Grip)": "Pull elbows straight down and feel your lats do the work.",
  "Lat Pulldown (Underhand)": "Drive elbows to your sides and feel your lower lats pull.",
  "Pullover (Cable or DB)": "Feel your lats stretch overhead, then pull the weight down with them.",
  "Shrugs": "Lift your shoulders to your ears and feel your traps squeeze, no rolling.",
  "Deadlift": "Push the floor away and feel your hamstrings and glutes lift the bar.",
  // Shoulders
  "Seated DB Shoulder Press": "Press up and slightly in; feel your delts, not your lower back.",
  "Lateral Raise (Cable)": "Lead with your elbows out to the side and feel the side of your shoulder burn.",
  "Rear Delt Fly": "Push your hands out wide and feel the back of your shoulders work.",
  "Upright Row (Cable)": "Lead with your elbows and feel the tops of your shoulders lift.",
  "Overhead Press (Barbell)": "Squeeze your glutes and feel your delts drive the bar overhead.",
  "Arnold Press": "Rotate as you press and feel your whole shoulder turn on.",
  "Lateral Raise (DB)": "Pour the jugs: elbows out, feel the side of your shoulder lift.",
  "Lateral Raise (Machine)": "Push through your elbows and feel your side delts take the load.",
  "Front Raise": "Lift to eye level and feel the front of your shoulder, no swing.",
  "Reverse Pec Dec": "Push the handles apart and feel your rear delts squeeze.",
  "Cable Y-Raise": "Reach up and out in a Y; feel your lower traps and rear delts.",
  // Arms
  "Tricep Pushdown (Rope)": "Keep your elbows pinned and feel your triceps squeeze as you spread the rope.",
  "Overhead Tricep Extension": "Feel the deep stretch in your triceps at the bottom, then squeeze straight.",
  "Seated DB Curl": "Keep your elbows still and feel your biceps squeeze at the top.",
  "Hammer Curl": "Thumbs up and feel the outside of your forearm and upper arm work.",
  "Incline DB Curl": "Let your arms hang back and feel your biceps stretch, then squeeze.",
  "Skull Crushers": "Keep elbows pointed up and feel your triceps lower and lift the bar.",
  "Barbell Curl": "Pin your elbows to your sides and feel your biceps curl the bar.",
  "EZ-Bar Curl": "Keep your elbows still and feel your biceps squeeze at the top.",
  "Preacher Curl": "Stay pressed into the pad and feel your biceps work from full stretch.",
  "Cable Curl": "Feel constant tension in your biceps from bottom to top.",
  "Concentration Curl": "Curl slowly and feel your biceps peak at the top.",
  "Reverse Curl": "Palms down and feel your forearms and brachialis lift the bar.",
  "Close-Grip Bench Press": "Keep elbows tucked and feel your triceps lock the bar out.",
  "Tricep Pushdown (Bar)": "Pin your elbows and feel your triceps squeeze at the bottom.",
  "Single-Arm Cable Extension": "Keep your elbow fixed and feel one tricep do all the work.",
  "Dips (Upright)": "Stay upright and feel your triceps press you back to the top.",
  "Wrist Curl": "Move only your wrists and feel your forearms burn.",
  // Legs
  "Leg Press (Heavy)": "Push through your whole foot and feel your quads and glutes drive the sled.",
  "Romanian Deadlift": "Push your hips back and feel your hamstrings stretch like rubber bands.",
  "Bulgarian Split Squat": "Sink straight down and feel your front leg's glute and quad do the work.",
  "Leg Extension": "Kick up and feel your quads squeeze hard at the top.",
  "Leg Curl": "Pull your heels to your glutes and feel your hamstrings squeeze.",
  "Leg Adduction": "Squeeze your knees together and feel your inner thighs.",
  "Back Squat": "Sit between your hips and feel your quads and glutes drive you up.",
  "Front Squat": "Stay tall with elbows up and feel your quads push the floor away.",
  "Hack Squat": "Push through your whole foot and feel your quads take the load.",
  "Goblet Squat": "Hold it close, sit deep, and feel your quads and glutes stand you up.",
  "Walking Lunge": "Step long and feel your front glute pull you forward.",
  "Step-Up": "Drive through your front heel and feel your glute lift you up.",
  "Hip Thrust": "Tuck your chin and ribs and feel your glutes squeeze hard at the top.",
  "Good Morning": "Push your hips back and feel your hamstrings stretch and pull you up.",
  "Seated Leg Curl": "Pull your heels under and feel your hamstrings squeeze.",
  "Lying Leg Curl": "Keep hips down and feel your hamstrings curl your heels up.",
  "Nordic Curl": "Lower slowly and feel your hamstrings fight the whole way down.",
  "Leg Abduction": "Push your knees apart and feel the outside of your glutes.",
  "Standing Calf Raise": "Rise onto your big toe and feel your calves squeeze at the top.",
  "Seated Calf Raise": "Stretch deep at the bottom and feel your calves press up.",
  // Cardio
  "Treadmill Run": "Relax your shoulders and feel light, quick steps under your hips.",
  "Incline Walk": "Push through your heels and feel your glutes and calves climb.",
  "Outdoor Run": "Run tall and feel a steady breath you could almost talk through.",
  "Stationary Bike": "Push and pull through the pedals and feel smooth, even circles.",
  "Rower": "Legs, then back, then arms; feel your legs start every stroke.",
  "Stair Climber": "Stand tall and feel your glutes push each step, hands light.",
  "Elliptical": "Push through your heels and feel your legs, not the handles, do the work.",
  "Jump Rope": "Stay light on the balls of your feet and feel a quick, easy bounce.",
  // Core
  "Cable Crunch": "Curl your ribs toward your hips and feel your abs crunch, not your arms pull.",
  "Hanging Leg Raise": "Curl your pelvis up and feel your lower abs lift your legs.",
  "Plank": "Squeeze your glutes and brace; feel your whole middle stay rock solid.",
  "Ab Wheel Rollout": "Keep ribs down and feel your abs stop you from sagging.",
  "Pallof Press": "Press out and feel your core resist the twist.",
  "Russian Twist": "Rotate from your ribs and feel your obliques turn you.",
};

/* The previous default cues. A saved program whose cue still matches one of these was never
   customised, so it gets the new feel cue; anything the lifter wrote themselves is kept. */
export const LEGACY_CUES = {
  "Incline Barbell / Smith Press": "Lead with upper chest, not shoulders. 3 sec down.",
  "Flat DB Press": "Slow eccentric. Squeeze at top like touching elbows together.",
  "Machine Pec Dec": "Your best MMC lift. Elbows at shoulder height. Squeeze 1 sec at centre.",
  "Cable Fly (Low to High)": "Hug a barrel. Arc upward, squeeze knuckles at top.",
  "Tricep Pushdown (Rope)": "Elbows glued to sides. Spread the rope at the bottom.",
  "Overhead Tricep Extension": "Full stretch at top is the point. Targets the long head.",
  "Lat Pulldown (Wide Grip)": "Shoulders down and back first. Lead with elbows. Feel lats, not biceps.",
  "Seated Cable Row (Close Grip)": "Elbow to hip pocket. Pause and squeeze. Chest tall.",
  "Seated Row (Machine)": "Full hang at the bottom — let the lat stretch. Drive the elbow up.",
  "Straight-Arm Pulldown": "Lower lat priority. Slight forward lean, arms locked, sweep to thighs.",
  "Face Pulls": "Pull to forehead, elbows high. Slow and controlled.",
  "Seated DB Curl": "Zero swinging. Squeeze at top, slow down.",
  "Hammer Curl": "Neutral grip hits brachialis — arm thickness.",
  "Leg Press (Heavy)": "Feet shoulder-width, mid-platform. Knees to 90°. Chase weight.",
  "Romanian Deadlift": "Hinge at hips, push hips BACK until hams stretch. Bar close to legs.",
  "Bulgarian Split Squat": "Rear foot on bench. Front knee tracks over toes.",
  "Leg Extension": "Pause 1 sec at top, squeeze the quad. Don't let it crash.",
  "Leg Curl": "Curl all the way, pause at peak. Hams love full ROM.",
  "Leg Adduction": "Squeeze at close. Slow return. No momentum.",
  "Seated DB Shoulder Press": "Don't lock out — keep tension. Lower to 90°. Brace core.",
  "Lateral Raise (Cable)": "Most important for width. Lead with elbows, hold 0.5 sec. No shrug.",
  "Rear Delt Fly": "Elbows slightly bent, arc wide. Squeeze blades at the end.",
  "Upright Row (Cable)": "Pull to chin, elbows lead. Don't go heavy — feel side delts.",
  "Incline DB Curl": "Sit at 45°, arms hang straight down. Full stretch = max growth.",
  "Skull Crushers": "Lower slowly beside your head — 3 sec. Elbows fixed.",
};

/** Gives a saved program the current cues without touching any the lifter wrote. */
export function refreshCues(program) {
  let changed = false;
  const next = {};
  for (const [day, p] of Object.entries(program)) {
    next[day] = { ...p, exercises: p.exercises.map((ex) => {
      const fresh = CUES[ex.n];
      if (!fresh || ex.cue === fresh) return ex;
      if (ex.cue === undefined || ex.cue === LEGACY_CUES[ex.n]) { changed = true; return { ...ex, cue: fresh }; }
      return ex;
    }) };
  }
  return changed ? next : program;
}
