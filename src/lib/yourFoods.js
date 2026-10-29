import { today, iso } from "./util.js";

/* ── Your foods ──
   One list of everything you eat: saved foods and what you've logged (the app keeps 120 days),
   once each. Ranked by how often and how lately you've had it, each log fading by half every
   so often, and counting three times as much when it was at the meal you're adding to.
   Meals rank by different things. Lunch and dinner go by what's recent (meal prep rotates every
   few days) and share one pool, so last night's dinner is this lunch's leftovers. Breakfast and
   snacks go by habit, so the bar you have most afternoons stays near the top for weeks.
   A food that's clearly another meal's (the morning latte, at lunch) counts for less, and so
   does one already logged at this meal on the day, unless it's often had twice there. */
const SAME_MEAL = 3;
const OFF_MEAL = 0.3; // a food that's usually another meal's
const HAD_IT = 0.3; // already logged at this meal on the day
const HALF_LIFE_DAYS = { lunch: 2, dinner: 2, breakfast: 30, snacks: 30 }; // 14 with no meal; a prepped batch lasts days, not weeks
const POOL = { lunch: ["lunch", "dinner"], dinner: ["lunch", "dinner"] }; // else the meal alone
const poolOf = (meal) => POOL[meal] || [meal];
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const nameKey = (x) => `${norm(x.name)}|${norm(x.brand)}`;
const DAY = 86400000;

/**
 * Your foods, best first, for the meal being added to on `date` (today by default). Each item:
 * { key, name, brand, saved, last, atMeal, count, usual, lastDate, kcal, score }. `saved` is the saved
 * food (or null), `last` the latest log of it (or null), `atMeal` the latest at this meal (or null),
 * `usual` the meal it's mostly had at (when that's clear), `kcal` its usual portion here.
 */
export function yourFoods(entries, foods, { meal = null, now = Date.now(), date = iso(new Date(now)) } = {}) {
  const halfLife = HALF_LIFE_DAYS[meal] || 14;
  const pool = meal ? poolOf(meal) : [];
  const byId = new Map(foods.map((f) => [f.id, f]));
  const byName = new Map();
  for (const f of foods) byName.set(nameKey(f), [...(byName.get(nameKey(f)) || []), f]);
  const items = new Map();
  const item = (key, saved = null) => {
    if (!items.has(key)) items.set(key, { key, saved, last: null, count: 0, meals: {}, score: 0, lastAt: "", atMeal: null, atMealAt: "", here: 0, hereDays: new Set(), hadIt: false });
    return items.get(key);
  };
  for (const f of foods) item(`food:${f.id}`, f);
  for (const e of entries) {
    // A log belongs to the saved food it came from, else to the one saved food of that name.
    // One whose saved food was deleted stays out: deleting a food takes it off this list.
    const linked = e.source_ref && ["custom", "ai"].includes(e.source);
    const ref = linked ? byId.get(e.source_ref) : null;
    if (linked && !ref) continue;
    const named = byName.get(nameKey(e));
    const saved = ref || (named?.length === 1 ? named[0] : null);
    const it = item(saved ? `food:${saved.id}` : `name:${nameKey(e)}`);
    const day = Date.parse(`${e.date}T12:00:00`) || now;
    it.count++;
    it.meals[e.meal] = (it.meals[e.meal] || 0) + 1;
    it.score += 0.5 ** (Math.max(0, now - day) / DAY / halfLife) * (pool.includes(e.meal) ? SAME_MEAL : 1);
    if (e.meal === meal) { it.here++; it.hereDays.add(e.date); if (e.date === date) it.hadIt = true; }
    const at = `${e.date}|${e.created_at || ""}`; // same day: the later log wins
    if (at > it.lastAt) { it.lastAt = at; it.last = e; }
    if (e.meal === meal && at > it.atMealAt) { it.atMealAt = at; it.atMeal = e; }
  }
  return [...items.values()].map((it) => {
    const [top, n] = Object.entries(it.meals).sort((a, b) => b[1] - a[1])[0] || [];
    const s = it.saved?.basis?.perServing;
    const usual = it.count >= 2 && n / it.count >= 0.6 ? top : null;
    const often = it.here >= 1.5 * it.hereDays.size; // had more than once at this meal most days
    const score = it.score * (meal && usual && !pool.includes(usual) ? OFF_MEAL : 1) * (it.hadIt && !often ? HAD_IT : 1);
    return {
      key: it.key, saved: it.saved, last: it.last, atMeal: it.atMeal, count: it.count, score, at: it.lastAt,
      name: it.saved?.name ?? it.last.name, brand: it.saved ? it.saved.brand || null : it.last.brand || null,
      usual,
      lastDate: it.last?.date || null,
      kcal: it.atMeal || it.last ? +(it.atMeal || it.last).kcal : s ? +s.kcal : null,
      created: it.saved?.created_at || "",
    };
  }).sort((a, b) => b.score - a.score || b.at.localeCompare(a.at) || b.created.localeCompare(a.created)); // a tie: had latest first (last night's dinner over yesterday's lunch)
}

const shiftDay = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return iso(x); };
const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snacks"];

/**
 * Earlier meals to log again in one tap, latest first, up to `max`: { date, meal, entries, label }
 * ("yesterday's dinner"). Lunch and dinner look back over the last few lunches and dinners
 * (leftovers go either way); breakfast and snacks at the same meal yesterday. A meal just like a
 * later one, or already all logged here, is left out.
 */
export function recentMeals(entries, { meal, date, max = 2 }) {
  const pool = poolOf(meal);
  // Lunch and dinner: the ones before this meal, back two days. Else: the same meal yesterday.
  const slots = pool.length === 1 ? [{ date: shiftDay(date, -1), meal }]
    : [0, -1, -2].flatMap((d) => ["dinner", "lunch"].map((m) => ({ date: shiftDay(date, d), meal: m })))
      .filter((x) => x.date !== date || MEAL_ORDER.indexOf(x.meal) < MEAL_ORDER.indexOf(meal)).slice(0, 4);
  const here = new Set(entries.filter((e) => e.date === date && e.meal === meal).map(nameKey));
  const seen = new Set();
  const out = [];
  for (const slot of slots) {
    const es = entries.filter((e) => e.date === slot.date && e.meal === slot.meal)
      .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    if (!es.length || es.every((e) => here.has(nameKey(e)))) continue;
    const sig = es.map(nameKey).sort().join("\n");
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ ...slot, entries: es, label: `${dayWord(slot.date, date)} ${slot.meal}` });
    if (out.length >= max) break;
  }
  return out;
}

/** "today's", "yesterday's", "Monday's": whose meal, from the day it's being added to. */
function dayWord(d, from) {
  if (d === from) return "today's";
  if (d === shiftDay(from, -1)) return "yesterday's";
  return `${new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" })}'s`;
}

/**
 * What logging one of your foods starts from: the food (saved, or as last logged) and the amount
 * you had last time at this meal, else last time at all (two lattes at breakfast, one as a snack).
 * A log with no nutrition basis (a quick add) gets one from its own numbers.
 */
export function pickYourFood(it) {
  const e = it.atMeal || it.last;
  const prior = e ? { amount: +e.amount, unit: e.unit } : {};
  if (it.saved) {
    // Keep the source of the log it came from (a Tank meal stays "ai"), so the entry still links back.
    const source = e?.source_ref === it.saved.id ? e.source : "custom";
    return { food: { name: it.saved.name, brand: it.saved.brand || null, source, ref: it.saved.id, basis: it.saved.basis }, ...prior };
  }
  const amt = +e.amount || 1;
  const basis = e.basis || { perServing: { kcal: +e.kcal / amt, protein: +e.protein / amt, carbs: +e.carbs / amt, fat: +e.fat / amt }, servingLabel: e.unit || "serving" };
  return { food: { name: e.name, brand: e.brand || null, source: e.source, ref: e.source_ref ?? null, basis }, ...(e.basis ? prior : { amount: amt, unit: basis.servingLabel }) };
}

/** "today", "yesterday", "Sat" (this week), or "Sep 28", for a YYYY-MM-DD date. */
export function whenLabel(date, todayIso = today()) {
  if (!date) return null;
  const days = Math.round((Date.parse(`${todayIso}T12:00:00`) - Date.parse(`${date}T12:00:00`)) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  const d = new Date(`${date}T12:00:00`);
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
