/* Checks the week in review's facts and code-written review on made-up data: npm run test:review.
   Also exports the made-up account so the UI can be driven with it (scripts/demo-review.mjs). */
import assert from "node:assert/strict";
import { PROGRAM, activeDays } from "../src/data/program.js";
import { addDays } from "../src/lib/nutrition.js";
import { buildWeekFacts, fallbackStory, cleanStory, latestReview, reviewState, rangeLabel, coversLabel, whenLabel, hourLabel, liftHistory, foodDays, foodItems, weekSnapshot, fingerprint } from "../src/lib/weekReview.js";

const WEEK_END = "2026-10-11"; // a Sunday

/** Nine weeks of a lifter running the default split 3-4 times a week, getting a little stronger. */
export function demoAccount(weekEnd = WEEK_END) {
  const days = activeDays(PROGRAM);
  const sessions = [], food = [], weighins = [];
  let n = 0;
  for (let i = 62; i >= 0; i--) {
    const date = addDays(weekEnd, -i);
    const dow = new Date(date + "T12:00:00").getDay();
    const week = Math.floor((62 - i) / 7);
    const train = [1, 2, 4, 5].includes(dow) && !(week === 8 && dow === 5); // misses Friday this week
    if (train) {
      const day = days[n++ % days.length];
      const sets = {};
      PROGRAM[day].exercises.forEach((ex, j) => {
        if (ex.n === "Leg Adduction" && week >= 6) return; // adductions keep getting skipped lately
        const base = 40 + j * 15 + (ex.n.includes("Press") ? 60 : 0);
        const w = base + week * 5 * (j % 3 === 0 ? 1 : 0);
        sets[ex.n] = Array.from({ length: ex.sets }, (_, k) => ({ w, r: Math.max(ex.reps[0], ex.reps[1] - k - (week % 2)), rir: 2 }));
      });
      const start = new Date(date + "T22:00:00Z").getTime(); // 6 pm in New York;
      sessions.push({ id: `s${i}`, day, date, sets, startedAt: start, finishedAt: start + (55 + (i % 4) * 5) * 60000, note: i === 3 ? "Shoulder felt tight on presses" : null });
    }
    // Food on most days; weekends run over, rest days run light on protein.
    if (i % 9 !== 0) {
      const weekend = dow === 0 || dow === 6;
      const add = (meal, name, kcal, protein) => food.push({ id: `${date}-${meal}-${name}`, date, meal, name, amount: 1, unit: "serving", kcal, protein, carbs: kcal * 0.1, fat: kcal * 0.03 });
      add("breakfast", "Greek yogurt", 220, 22);
      add("lunch", "Chicken bowl", 650, train ? 48 : 30);
      add("dinner", weekend ? "Pizza" : "Salmon and rice", weekend ? 1100 : 700, weekend ? 40 : 42);
      add("snacks", train ? "Protein shake" : "Chips", train ? 160 : 300, train ? 30 : 4);
      if (dow === 6) add("dinner", "IPA beer", 220, 2);
    }
    if (dow === 0) weighins.push({ date, bw: 185 - week * 0.4 });
  }
  const prefs = {
    profile: { goals: ["muscle", "lean"], days: 4, doneAt: 1 },
    nutrition: { on: true, goal: "lose", targets: { kcal: 2200, protein: 170, carbs: 220, fat: 70, burn: 2700 } },
    phase: { type: "cut", start: addDays(weekEnd, -35), startWeight: 183.2, target: 176, rate: -0.9, weeks: 8, end: addDays(weekEnd, 21) },
    weekReview: { on: true, day: 0 },
  };
  return { sessions, food, weighins, prefs, program: PROGRAM };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const a = demoAccount();
  const f = buildWeekFacts({ ...a, weekEnd: WEEK_END, tz: "America/New_York" });

  assert.equal(f.start, "2026-10-05");
  assert.equal(f.dates.length, 7);
  assert.equal(f.training.count, 3, "three workouts this week (Friday missed)");
  assert.equal(f.training.target, 4);
  assert.ok(f.training.sets > 0 && f.training.prevSets > 0);
  assert.ok(f.training.prs.length > 0, "progressing lifts set records");
  assert.ok(f.training.skipped.some((s) => s.lift === "Leg Adduction"), "skipped lifts are noticed");
  assert.equal(f.training.avgStartHour, 18, "start hour in the lifter's time zone");
  assert.ok(f.nutrition.logged >= 6);
  assert.ok(f.nutrition.weekend.kcal > f.nutrition.weekdays.kcal, "weekends run higher");
  assert.ok(f.nutrition.trainingDays.protein > f.nutrition.restDays.protein, "rest days run lower on protein");
  assert.ok(f.nutrition.drinks?.entries >= 1, "drinks are counted");
  assert.ok(f.body.phase && f.body.rate4 < 0, "the cut is moving the scale down");
  assert.equal(f.weeks.length, 8);
  assert.ok(f.highs.length && f.lows.length);
  assert.ok(f.lows.some((l) => l.text.includes("3 of 4")));

  const fb = fallbackStory(f);
  for (const k of ["headline", "summary", "training", "nutrition", "body", "high", "low", "focus"]) assert.ok(fb[k], `fallback has ${k}`);
  // A partial agent answer keeps its parts and gets the rest from the fallback; bad coach ids are fixed.
  const s = cleanStory({ headline: "Strong week", training: { title: "T", body: "B", coach: "nobody" }, insights: [{ title: "I", body: "x", coach: "dash", evidence: "e" }] }, f, fb);
  assert.equal(s.headline, "Strong week");
  assert.equal(s.training.coach, "tank");
  assert.equal(s.insights[0].coach, "dash");
  assert.equal(s.low, fb.low);

  // Review days and when Today offers it.
  // When it's out: the review day at the review hour, covering the 7 full days before that day.
  const at = (d, h) => new Date(`${d}T${String(h).padStart(2, "0")}:30:00`);
  const sun10 = { day: 0, hour: 10 };
  assert.deepEqual(latestReview(sun10, at("2026-10-11", 10)).weekEnd, "2026-10-10", "Sunday 10:30 → Sun 4 to Sat 10");
  assert.equal(latestReview(sun10, at("2026-10-11", 9)).weekEnd, "2026-10-03", "before 10 it's still last week's");
  assert.equal(latestReview(sun10, at("2026-10-14", 8)).weekEnd, "2026-10-10");
  assert.equal(latestReview({ day: 1, hour: 7 }, at("2026-10-14", 8)).weekEnd, "2026-10-11", "Monday's covers Mon to Sun");
  assert.equal(coversLabel({ day: 0 }), "Sunday to Saturday");
  assert.equal(whenLabel({ day: 0, hour: 10 }), "Sunday at 10 AM");
  assert.equal(hourLabel(0), "12 AM"); assert.equal(hourLabel(12), "12 PM"); assert.equal(hourLabel(18), "6 PM");
  const prefs = { ...a.prefs, weekReview: { on: true, day: 1, hour: 10 } }; // Monday: covers the demo's Mon 5 – Sun 11
  const st = (p, now) => reviewState({ prefs: p, now, sessions: a.sessions, food: a.food });
  const opened = (p) => ({ ...p, weekReview: { ...p.weekReview, opened: "2026-10-11", openedOn: "2026-10-12" } });
  assert.deepEqual(st(prefs, at("2026-10-12", 11)), { weekEnd: "2026-10-11", glow: true });
  assert.notEqual(st(prefs, at("2026-10-12", 9))?.weekEnd, "2026-10-11", "not out before 10");
  assert.deepEqual(st(opened(prefs), at("2026-10-12", 20)), { weekEnd: "2026-10-11", glow: false }, "opened: stays the rest of the day");
  assert.equal(st(opened(prefs), at("2026-10-13", 9)), null);
  assert.deepEqual(st(prefs, at("2026-10-15", 9)), { weekEnd: "2026-10-11", glow: true }, "stays until opened");
  assert.equal(st({ ...prefs, weekReview: { on: false } }, at("2026-10-12", 11)), null);
  assert.equal(reviewState({ prefs, now: at("2026-10-12", 11), sessions: [], food: [] }), null, "nothing logged, no review");
  assert.equal(rangeLabel("2026-10-11"), "Oct 5 – 11");
  assert.equal(rangeLabel("2026-10-04"), "Sep 28 – Oct 4");
  assert.equal(fingerprint(a, WEEK_END), f.fingerprint);

  // The agent's tools.
  const bench = liftHistory(a.sessions, "pec dec", WEEK_END);
  assert.ok(bench.sessions?.length, "finds a lift by part of its name");
  assert.ok(liftHistory(a.sessions, "zercher squat", WEEK_END).error);
  assert.equal(foodDays(a.food, "2026-10-05", "2026-10-11").days.length, 7);
  assert.ok(foodItems(a.food, "2026-10-05", "2026-10-11", "dinner").count >= 6);
  assert.equal(weekSnapshot({ ...a, tz: "UTC" }, WEEK_END, 2).end, "2026-09-27");

  // First week: no history, still a review.
  const first = buildWeekFacts({ ...a, sessions: a.sessions.filter((x) => x.date >= "2026-10-05"), food: a.food.filter((x) => x.date >= "2026-10-05"), weighins: [], weekEnd: WEEK_END });
  assert.equal(first.history, 0);
  assert.match(fallbackStory(first).summary, /first review/);
  // Nutrition off and no bodyweight: those cards drop out.
  const lean = buildWeekFacts({ ...a, prefs: { ...a.prefs, nutrition: { on: false }, phase: null }, weighins: [], weekEnd: WEEK_END });
  assert.equal(lean.nutrition, null);

  const size = JSON.stringify(f).length;
  console.log(`facts ${(size / 1024).toFixed(1)} KB · ${f.highs.length} highs · ${f.lows.length} lows`);
  console.log("headline:", fb.headline);
  console.log("highs:", f.highs.map((h) => h.text));
  console.log("lows:", f.lows.map((h) => h.text));
  console.log("week in review: all checks passed");
}
