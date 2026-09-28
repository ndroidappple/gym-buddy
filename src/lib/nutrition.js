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

/**
 * A meal from Tank, checked: numbers clamped, and any item whose calories disagree with its macros
 * (4 kcal/g protein and carbs, 9 kcal/g fat) by more than 20% gets the macro-based figure instead.
 * Totals are summed here, never taken from the model. Returns { name, items, total, estimated } or null.
 */
export function cleanMeal(m) {
  const n = (v, hi) => Math.min(hi, Math.max(0, Number.isFinite(+v) ? +v : 0));
  const items = (Array.isArray(m?.items) ? m.items : []).slice(0, 12).map((x) => {
    const protein = Math.round(n(x.protein, 500) * 10) / 10, carbs = Math.round(n(x.carbs, 500) * 10) / 10, fat = Math.round(n(x.fat, 500) * 10) / 10;
    const fromMacros = protein * 4 + carbs * 4 + fat * 9;
    let kcal = Math.round(n(x.kcal, 5000));
    if (fromMacros > 0 && Math.abs(kcal - fromMacros) > Math.max(20, fromMacros * 0.2)) kcal = Math.round(fromMacros);
    return { food: String(x.food || "Food").slice(0, 60), amount: String(x.amount || "").slice(0, 40), grams: x.grams > 0 ? Math.round(x.grams) : null, kcal, protein, carbs, fat, estimated: !!x.estimated };
  }).filter((x) => x.kcal > 0 || x.protein > 0);
  if (!items.length) return null;
  const sum = (k) => Math.round(items.reduce((a, x) => a + x[k], 0) * (k === "kcal" ? 1 : 10)) / (k === "kcal" ? 1 : 10);
  const name = String(m.name || "").trim().slice(0, 60) || items.map((x) => x.food).join(", ").slice(0, 60);
  return { name, items, total: { kcal: sum("kcal"), protein: sum("protein"), carbs: sum("carbs"), fat: sum("fat") }, estimated: items.some((x) => x.estimated) };
}
