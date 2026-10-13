import { bodyweightSeries, daysBetween, today, weekDates, iso } from "./util.js";

/* Nutrition targets and daily totals. Targets start from a standard estimate of daily burn
   (Mifflin-St Jeor resting rate × an activity factor), shifted by the goal's weekly rate:
   1 lb ≈ 3,500 kcal, so each lb/week is 500 kcal/day. Protein comes first for a lifter, then a
   floor of fat, and carbs fill the rest. Everything is shown to the lifter before it's saved. */

export const MEALS = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snacks", label: "Snacks" },
];
/** Daily life outside the gym. Training days are added on top (see activityFactor). */
export const ACTIVITY = [
  { id: "desk", label: "Mostly sitting", sub: "Desk job, drive most places", factor: 1.2 },
  { id: "feet", label: "On my feet a lot", sub: "Walk a lot, stand at work", factor: 1.35 },
  { id: "physical", label: "Physical job", sub: "Lifting, labor, 10k+ steps", factor: 1.5 },
];
export const GOALS = [
  { id: "lose", label: "Lose fat", rate: -0.005 }, // share of bodyweight per week
  { id: "maintain", label: "Maintain", rate: 0 },
  { id: "gain", label: "Build / gain", rate: 0.0025 },
];

const LB_KG = 0.45359237, IN_CM = 2.54;
const r5 = (x) => Math.round(x / 5) * 5, r10 = (x) => Math.round(x / 10) * 10;

/** Each weekly training day adds a little to the daily factor (4 days ≈ +0.14). */
export const activityFactor = (activity, trainingDays = 3) =>
  (ACTIVITY.find((a) => a.id === activity)?.factor ?? 1.2) + 0.035 * Math.min(7, Math.max(0, trainingDays || 0));

/** Resting burn (kcal/day), Mifflin-St Jeor. */
export function bmr({ sex, age, heightIn, weight }) {
  const kg = weight * LB_KG, cm = heightIn * IN_CM;
  return 10 * kg + 6.25 * cm - 5 * age + (sex === "female" ? -161 : 5);
}

/** The goal's weekly rate in lb/week (signed): the bulk/cut phase when one is running, else the goal. */
export function goalRate({ goal, weight, phase }) {
  if (phase && !phase.endedAt) return phase.rate;
  const g = GOALS.find((x) => x.id === goal) || GOALS[1];
  return Math.round(g.rate * weight * 100) / 100;
}

/**
 * Daily targets from the lifter's details. Returns { kcal, protein, carbs, fat, burn, rate }.
 * `burn` is the estimated maintenance; `rate` the lb/week the targets aim for.
 */
export function computeTargets({ sex, age, heightIn, weight, activity, trainingDays, goal, phase }) {
  const burn = bmr({ sex, age, heightIn, weight }) * activityFactor(activity, trainingDays);
  const rate = goalRate({ goal, weight, phase });
  const floor = sex === "female" ? 1200 : 1500;
  const kcal = r10(Math.max(floor, burn + rate * 500));
  // Protein: ~1 g/lb when losing (holds muscle), 0.8 g/lb otherwise.
  const protein = r5(weight * (rate < 0 ? 1 : 0.8));
  const fat = r5(Math.max(weight * 0.3, (kcal * 0.25) / 9));
  const carbs = r5(Math.max(50, (kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat, burn: r10(burn), rate };
}

/** Targets with a changed calorie or protein number: fat stays, carbs absorb the difference. */
export function adjustTargets(t, { kcal = t.kcal, protein = t.protein, fat = t.fat }) {
  return { ...t, kcal, protein, fat, carbs: r5(Math.max(0, (kcal - protein * 4 - fat * 9) / 4)) };
}

/** The lifter's latest bodyweight (weigh-in or session), with how many days old it is. */
export function latestWeight(sessions, weighins) {
  const s = bodyweightSeries(sessions, weighins);
  const last = s[s.length - 1];
  return last ? { bw: last.bw, date: last.date, age: daysBetween(last.date, today()) } : null;
}

export const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
/** Sums calories and macros over entries. */
export function totals(entries) {
  return entries.reduce((t, e) => ({ kcal: t.kcal + (+e.kcal || 0), protein: t.protein + (+e.protein || 0), carbs: t.carbs + (+e.carbs || 0), fat: t.fat + (+e.fat || 0) }), ZERO);
}

/** Entries grouped by date: { "2026-09-28": [...] }. */
export function byDate(entries) {
  const m = {};
  for (const e of entries) (m[e.date] ||= []).push(e);
  return m;
}

/** Sunday-first week around `date`: each day's totals, and averages over the days with food logged. */
export function weekSummary(entries, date = today()) {
  const days = weekDates(new Date(date + "T12:00:00"));
  const m = byDate(entries);
  const rows = days.map((d) => ({ date: d, ...totals(m[d] || []), logged: (m[d] || []).length }));
  const logged = rows.filter((r) => r.logged && r.date <= today());
  const avg = (k) => (logged.length ? Math.round(logged.reduce((a, r) => a + r[k], 0) / logged.length) : null);
  return { rows, loggedDays: logged.length, avgKcal: avg("kcal"), avgProtein: avg("protein") };
}

/** Shifts an ISO date by n days. */
export const addDays = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return iso(x); };

/** Which meal fits the time of day, for a new entry's default. */
export function mealForNow(h = new Date().getHours()) {
  return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snacks";
}

/* ── Portions ──
   A food's `basis` holds its nutrition per 100 g (`per100`) when the weight is known, else per one
   serving (`perServing`), plus the portion sizes it can be logged in: [{ label, grams }]. */

export const GRAMS_UNIT = { label: "g", grams: 1 };
export const OZ_UNIT = { label: "oz", grams: 28.3495 };

/** The units a food can be logged in: its own portions, then g and oz when the weight is known. */
export function unitsFor(basis) {
  if (!basis) return [{ label: "serving", grams: null }];
  const own = (basis.portions || []).filter((p) => p.label && p.grams > 0);
  if (basis.per100) return [...own, GRAMS_UNIT, OZ_UNIT];
  return [{ label: basis.servingLabel || "serving", grams: null }];
}

/** Nutrition for `amount` of `unit` of a food. Returns { kcal, protein, carbs, fat, grams }. */
export function nutritionFor(basis, amount, unit) {
  const a = Math.max(0, +amount || 0);
  const round = (n) => Math.round(n * 10) / 10;
  if (basis?.per100) {
    const u = unitsFor(basis).find((x) => x.label === unit) || GRAMS_UNIT;
    const g = a * (u.grams || 1);
    const k = g / 100;
    return { kcal: Math.round(basis.per100.kcal * k), protein: round(basis.per100.protein * k), carbs: round(basis.per100.carbs * k), fat: round(basis.per100.fat * k), grams: Math.round(g) };
  }
  const s = basis?.perServing || ZERO;
  return { kcal: Math.round(s.kcal * a), protein: round(s.protein * a), carbs: round(s.carbs * a), fat: round(s.fat * a), grams: null };
}

/** A sensible first amount for a food: its first portion ×1, else 100 g, else 1 serving. */
export function defaultPortion(basis) {
  const own = (basis?.portions || []).find((p) => p.grams > 0);
  if (basis?.per100) return own ? { amount: 1, unit: own.label } : { amount: 100, unit: "g" };
  return { amount: 1, unit: basis?.servingLabel || "serving" };
}

/** Plain-text food summary for the coaches' context: targets, today so far, and the week's averages. */
export function nutritionContext(n, entries) {
  const t = n.targets;
  const day = totals(entries.filter((e) => e.date === today()));
  const w = weekSummary(entries);
  const goal = GOALS.find((g) => g.id === n.goal)?.label;
  return [
    `Nutrition targets: ${t.kcal} kcal, ${t.protein} g protein, ${t.carbs} g carbs, ${t.fat} g fat a day (estimated burn ${t.burn} kcal${goal ? `, goal: ${goal}` : ""}).`,
    `Eaten today so far: ${Math.round(day.kcal)} kcal, ${Math.round(day.protein)} g protein, ${Math.round(day.carbs)} g carbs, ${Math.round(day.fat)} g fat.`,
    w.loggedDays ? `This week (${w.loggedDays} days logged): average ${w.avgKcal} kcal and ${w.avgProtein} g protein a day.` : "No food logged yet this week.",
  ].join("\n");
}

/** Grams of pure alcohol in one US standard drink (12 oz of 5% beer, 5 oz of wine, 1.5 oz of 80-proof spirit). */
export const STANDARD_DRINK_G = 14;
/* Names that are drinks with alcohol in them, for a reply that didn't say how much alcohol; NOT_DRINK are look-alikes without any. */
const NOT_DRINK = /\b(ginger ale|root beer|birch beer|non[- ]?alcoholic|alcohol[- ]free|mocktails?|kombucha)\b|\b0\.0\b/i;
const DRINK = /\b(beers?|lagers?|ipas?|ales?|stouts?|pilsners?|modelo|corona|michelob|bud(weiser)?|coors|miller|wines?|ros[eé]|prosecco|champagne|mimosas?|sangria|vodka|whiske?y|bourbon|scotch|rum|gin|tequila|mezcal|sake|soju|ciders?|seltzers?|white claw|high noon|truly|cocktails?|margaritas?|martinis?|mojitos?|negronis?|spritz|daiquiris?|old fashioned|manhattan|liqueur|schnapps|fireball|jäger(meister)?)\b/i;
/** Whether a logged food's name reads as a drink with alcohol in it (the week in review counts them). */
export const isAlcoholic = (name) => DRINK.test(name || "") && !NOT_DRINK.test(name || "");

/**
 * A meal from Tank, checked: numbers clamped, and any item whose calories disagree with what's in
 * it (4 kcal/g protein and carbs, 9 kcal/g fat, 7 kcal/g alcohol) by more than 20% gets the
 * worked-out figure instead. Alcohol is in none of protein, carbs or fat, so it has its own grams:
 * without them a beer's alcohol calories would be "corrected" away. A drink Tank gave no alcohol
 * for (an older reply) has the calories above its macros counted as alcohol instead.
 * Totals are summed here, never taken from the model. Returns { name, items, total, estimated } or null.
 */
export function cleanMeal(m) {
  const n = (v, hi) => Math.min(hi, Math.max(0, Number.isFinite(+v) ? +v : 0));
  const r1 = (v) => Math.round(v * 10) / 10;
  const items = (Array.isArray(m?.items) ? m.items : []).slice(0, 12).map((x) => {
    const protein = r1(n(x.protein, 500)), carbs = r1(n(x.carbs, 500)), fat = r1(n(x.fat, 500));
    const food = String(x.food || "Food").slice(0, 60);
    let alcohol = r1(n(x.alcohol, 500));
    let kcal = Math.round(n(x.kcal, 5000));
    const macros = protein * 4 + carbs * 4 + fat * 9;
    if (!Number.isFinite(+x.alcohol) && DRINK.test(food) && !NOT_DRINK.test(food) && kcal > macros + 20) alcohol = r1((kcal - macros) / 7);
    const worked = macros + alcohol * 7;
    if (worked > 0 && Math.abs(kcal - worked) > Math.max(20, worked * 0.2)) kcal = Math.round(worked);
    // label: the product label Tank looked up for these numbers (absent when he estimated them).
    const label = typeof x.label === "string" && x.label.trim() ? x.label.trim().slice(0, 80) : null;
    return { food, amount: String(x.amount || "").slice(0, 40), grams: x.grams > 0 ? Math.round(x.grams) : null, kcal, protein, carbs, fat, alcohol, estimated: !!x.estimated, ...(label ? { label } : {}) };
  }).filter((x) => x.kcal > 0 || x.protein > 0);
  if (!items.length) return null;
  const sum = (k) => Math.round(items.reduce((a, x) => a + x[k], 0) * (k === "kcal" ? 1 : 10)) / (k === "kcal" ? 1 : 10);
  const name = shortName(m.name) || shortName(items.slice(0, 2).map((x) => x.food).join(" & "));
  return { name, items, total: { kcal: sum("kcal"), protein: sum("protein"), carbs: sum("carbs"), fat: sum("fat"), alcohol: sum("alcohol") }, estimated: items.some((x) => x.estimated) };
}

/** A food name for a list: amounts, brackets and "with …" tails removed, Title Case, and cut at a
    word to at most 28 characters. "PB protein oatmeal with apple (1/2 cup)" -> "PB Protein Oatmeal".
    Only a number with a unit, a fraction or an "x" count is an amount: numbers that are part of the
    name stay ("2% Milk Latte", "7 Layer Dip", "Big Mac 2.0"). */
export function shortName(s) {
  let t = String(s || "").replace(/\([^)]*\)/g, " ");
  // "Oatmeal with peanut butter, apple…": keep the dish; a one-word dish keeps its first addition too.
  const m = t.match(/^(.*?)\s+(?:with|w\/|plus)\s+(.*)$/i);
  if (m) t = m[1].trim().split(/\s+/).length === 1 ? `${m[1].trim()} & ${m[2].split(/,|\band\b|&/i)[0].trim()}` : m[1];
  t = t
    .replace(/(^|\s)\d+([./]\d+)?\s*(g|grams?|oz|ml|cups?|tbsp|tsp|scoops?|slices?|pieces?)\b/gi, " ")
    .replace(/(^|\s)\d+\/\d+(?=\s|$)|\b\d+\s*x\b/gi, " ")
    .replace(/\b(meal|breakfast|lunch|dinner|snack)\b$/i, "")
    .replace(/\s+/g, " ").trim();
  t = t.replace(/\b([a-z])([a-z]*)/g, (w, a, b) => (["and", "or", "of", "on", "in", "with"].includes(w) ? w : a.toUpperCase() + b));
  if (t.length > 28) t = t.slice(0, 29).replace(/\s+\S*$/, "").replace(/[\s&,-]+$/, "");
  return t.slice(0, 28);
}

/**
 * What Tank sees when asked from the Nutrition tab: targets, today's foods and totals, the last 7
 * days, the goal or bulk/cut, and bodyweight. Plain text for the model.
 */
export function nutritionChatContext({ n, entries, phase, sessions, weighins }) {
  // Same order as todaysEntries() in foodEdit.js: Tank names an entry to edit by its #number here.
  const day = entries.filter((e) => e.date === today()).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  const t = n.targets;
  const sum = totals(day);
  const left = { kcal: t.kcal - sum.kcal, protein: t.protein - sum.protein, carbs: t.carbs - sum.carbs, fat: t.fat - sum.fat };
  const r = Math.round;
  const lines = [
    nutritionContext(n, entries),
    `Left today: ${r(left.kcal)} kcal, ${r(left.protein)} g protein, ${r(left.carbs)} g carbs, ${r(left.fat)} g fat.`,
    day.length ? `Eaten today: ${day.map((e, i) => `#${i + 1} ${e.meal} ${e.name}, ${+e.amount || 1} ${e.unit || "serving"} (${r(e.kcal)} kcal, P${r(e.protein)} C${r(e.carbs)} F${r(e.fat)})`).join("; ")}.` : "Nothing logged yet today.",
  ];
  const week = [];
  for (let i = 6; i >= 1; i--) {
    const d = addDays(today(), -i);
    const x = totals(entries.filter((e) => e.date === d));
    if (x.kcal) week.push(`${d}: ${r(x.kcal)} kcal, ${r(x.protein)} g protein`);
  }
  if (week.length) lines.push(`Previous days: ${week.join("; ")}.`);
  if (phase && !phase.endedAt) lines.push(`Running a ${phase.type}: ${phase.startWeight} -> ${phase.target} lb, planned ${phase.rate} lb/week, ends ${phase.end}.`);
  const bw = latestWeight(sessions, weighins);
  if (bw) lines.push(`Latest bodyweight: ${bw.bw} lb (${bw.age} days ago).`);
  return lines.join("\n");
}
