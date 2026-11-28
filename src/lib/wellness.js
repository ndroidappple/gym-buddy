import { isAlcoholic, addDays, mealForNow } from "./nutrition.js";
import { today } from "./util.js";

/* Wellness: alcohol and cannabis, alongside the training and food. Off until it's turned on in
   Settings → Nutrition & Wellness (prefs.wellness.on).

   Drinks live in the food log, because they have calories. A drink's alcohol is already kept in
   its entry's basis (Tank's meals carry alcohol grams per serving; the presets below do too), so
   nothing new is stored for it: alcoholOf() reads it back. With food tracking off there's no food
   log, so the day's drink count is kept in the account state instead.

   Cannabis is a yes per day, kept in the account state: state.wellness = { "2026-11-21": { cannabis:
   true } }, plus { drinks: n } on days logged with food tracking off. A day with nothing has no key. */

/** Grams of pure alcohol in one US standard drink. */
export const STANDARD_DRINK_G = 14;
export const ALCOHOL_KCAL_PER_G = 7;

/* One-tap drinks for the log sheet: one standard drink each, with typical calories. */
export const DRINK_PRESETS = [
  { id: "beer", name: "Beer", sub: "12 oz", per: { kcal: 150, protein: 1.6, carbs: 13, fat: 0, alcohol: 14 } },
  { id: "wine", name: "Wine", sub: "5 oz", per: { kcal: 120, protein: 0.1, carbs: 4, fat: 0, alcohol: 14 } },
  { id: "shot", name: "Shot", sub: "1.5 oz", per: { kcal: 100, protein: 0, carbs: 0, fat: 0, alcohol: 14 } },
  { id: "cocktail", name: "Cocktail", sub: "Mixed", per: { kcal: 200, protein: 0, carbs: 25, fat: 0, alcohol: 14 } },
];

/** Where a drink logged for `date` goes: today's to the meal for now, an earlier day's to dinner. */
export const drinkMeal = (date) => (date === today() ? mealForNow() : "dinner");

/** A food log row for one preset drink on `date`. */
export function drinkEntry(preset, date) {
  const p = preset.per;
  return {
    date, meal: drinkMeal(date),
    name: preset.name, amount: 1, unit: "drink",
    kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat,
    source: "custom", basis: { perServing: p, servingLabel: "drink" },
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Grams of alcohol in a logged food. From its basis when that says (Tank's meals and drinks, the
 * presets, a database food with alcohol per 100 g); otherwise worked out for a food whose name reads
 * as a drink, from the calories its macros don't account for (alcohol is 7 kcal/g).
 */
export function alcoholOf(e) {
  const b = e?.basis;
  const a = +e?.amount || 0;
  if (b?.perServing && Number.isFinite(+b.perServing.alcohol)) return r1(+b.perServing.alcohol * a);
  if (b?.per100 && Number.isFinite(+b.per100.alcohol)) return r1((+b.per100.alcohol * (+e.grams || 0)) / 100);
  if (!isAlcoholic(e?.name)) return 0;
  const macros = (+e.protein || 0) * 4 + (+e.carbs || 0) * 4 + (+e.fat || 0) * 9;
  const left = (+e.kcal || 0) - macros;
  return left > 20 ? r1(left / ALCOHOL_KCAL_PER_G) : 0;
}

/** Standard drinks for grams of alcohol, to the nearest half. */
export const drinksFor = (grams) => Math.round((grams / STANDARD_DRINK_G) * 2) / 2;

/** "1 drink", "2.5 drinks". */
export const drinksLabel = (n) => `${n} drink${n === 1 ? "" : "s"}`;

/**
 * Each day's wellness from `from` to `to`: { [date]: { drinks, alcohol, alcoholKcal, cannabis, items } }.
 * `entries` is the food log (null with food tracking off, when the day's own drink count is used).
 * Days with nothing are left out.
 */
export function wellnessDays({ entries = null, wellness = {}, from = "0000-00-00", to = "9999-99-99" }) {
  const out = {};
  const day = (d) => (out[d] ||= { drinks: 0, alcohol: 0, alcoholKcal: 0, cannabis: false, items: [] });
  if (entries) {
    for (const e of entries) {
      if (e.date < from || e.date > to) continue;
      const g = alcoholOf(e);
      if (!g) continue;
      const x = day(e.date);
      x.alcohol = r1(x.alcohol + g);
      x.items.push(e);
    }
  }
  for (const [d, w] of Object.entries(wellness || {})) {
    if (d < from || d > to || !w) continue;
    if (!entries && w.drinks > 0) { const x = day(d); x.alcohol = r1(x.alcohol + w.drinks * STANDARD_DRINK_G); }
    if (w.cannabis) day(d).cannabis = true;
  }
  for (const [d, x] of Object.entries(out)) {
    x.drinks = drinksFor(x.alcohol);
    x.alcoholKcal = Math.round(x.alcohol * ALCOHOL_KCAL_PER_G);
    // A splash of wine in a sauce rounds to no drinks: that's not a drinking day.
    if (!x.drinks && !x.cannabis) delete out[d];
  }
  return out;
}

/** The day a log is for, by default: before noon it's most likely last night. */
export const defaultLogDay = (h = new Date().getHours()) => (h < 12 ? addDays(today(), -1) : today());

/** The days the log sheet offers: the last `n`, today first. */
export const recentDays = (n = 7, to = today()) => Array.from({ length: n }, (_, i) => addDays(to, -i));

/**
 * A food that's a drink, not a meal with a drink in it (a piña colada, not "Steak & two beers"). Drinks
 * get a stepper in the log sheet; a meal with beer in it is listed as it is.
 */
export function isDrinkLike(e) {
  const g = alcoholOf(e);
  if (!(g > 0)) return false;
  // Itemized by the coach: real food alongside the drinks ("Fries and two beers") makes it a meal.
  // Mixers (cola, tonic, juice) have next to no protein or fat, so a rum and coke stays a drink.
  const items = e.basis?.items;
  if (Array.isArray(items) && items.some((it) => !(+it.alcohol > 0) && (+it.protein || 0) + (+it.fat || 0) >= 5)) return false;
  const share = (g * ALCOHOL_KCAL_PER_G) / Math.max(1, +e.kcal || 0);
  // Mostly alcohol; or next to no protein and a real share of alcohol (a cocktail with a sweet mixer).
  // Not the name: "Rum cake" and "Beer-battered fish" are food. A dessert with a splash of rum stays under 15%.
  return share >= 0.5 || ((+e.protein || 0) < 10 && share >= 0.15);
}

/* Drink names, the same drink however it was written: "Vodka Sodas", "2 vodka sodas" and "Vodka Soda" are
   one drink. A count in front ("2", "two", "a") or tagged on ("x2") goes, and each word is made singular. */
const COUNT = /^(\d+(\.\d+)?|x\d+|\d+x|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few|some)$/i;
const KEEP = new Set(["pils", "artois", "jus", "ros", "rosés", "les", "des", "bass", "swiss"]); // words that end in s but aren't plurals
function singular(w) {
  const l = w.toLowerCase();
  if (KEEP.has(l) || l.length <= 3 || /('s|ss|us)$/.test(l)) return w;
  if (/[^aeiou]ies$/.test(l)) return w.slice(0, -3) + (w.slice(-3) === "IES" ? "Y" : "y"); // whiskies → whisky
  if (/(ss|sh|ch|x)es$/.test(l)) return w.slice(0, -2); // glasses → glass
  if (/s$/.test(l)) return w.slice(0, -1); // sodas → soda
  return w;
}

/** A drink's name as one of it: "2 Vodka Sodas" → "Vodka Soda", "Two Glasses of Wine" → "Glass of Wine". */
export function drinkName(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && COUNT.test(words[0])) words.shift();
  while (words.length > 1 && /^(x\d+|\(\d+\))$/i.test(words[words.length - 1])) words.pop();
  return words.map(singular).join(" ");
}

/** The key that groups the same drink across days and spellings. */
export const drinkKey = (name) => drinkName(name).toLowerCase();

const stamp = (e) => `${e.date}${e.created_at || ""}`;

/**
 * The lifter's own drinks, most logged first (the most recent breaks a tie): what they actually drink,
 * with the numbers they logged it with. Each is { key, name, template }; the template is the latest
 * entry that was a single drink, or else the latest of any size (oneMore() halves a "2 vodka sodas").
 */
export function yourDrinks(entries, limit = 3) {
  const m = new Map();
  for (const e of entries) {
    if (!isDrinkLike(e)) continue;
    const k = drinkKey(e.name);
    const x = m.get(k) || { key: k, n: 0, last: e, single: null };
    x.n++;
    if (stamp(e) > stamp(x.last)) x.last = e;
    if (drinksFor(alcoholOf(e)) <= 1.5 && (!x.single || stamp(e) > stamp(x.single))) x.single = e;
    m.set(k, x);
  }
  return [...m.values()]
    .sort((a, b) => b.n - a.n || stamp(b.last).localeCompare(stamp(a.last)))
    .slice(0, limit).map(({ key, last, single }) => { const template = single || last; return { key, name: drinkName(template.name), template }; });
}

/** How many drinks an entry was, as a whole count to step by: "2 vodka sodas" is 2, a pint of IPA (1.5
    standard drinks) is still one pint. Rounds down unless it's within a quarter of the next. */
export const drinkUnits = (e) => Math.max(1, Math.floor(drinksFor(alcoholOf(e)) + 0.25));

/**
 * The entry's numbers at `factor` of its size: by its basis when it has one (so the alcohol scales with
 * it), else in proportion. `nutritionFor` is passed in to keep this file free of the portion math.
 */
export function scaledEntry(e, factor, nutritionFor) {
  const amount = Math.round((+e.amount || 1) * factor * 100) / 100;
  if (e.basis && nutritionFor) {
    const n = nutritionFor(e.basis, amount, e.unit);
    return { amount, kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat };
  }
  const r = (v) => Math.round((+v || 0) * factor * 10) / 10;
  return { amount, kcal: Math.round((+e.kcal || 0) * factor), protein: r(e.protein), carbs: r(e.carbs), fat: r(e.fat) };
}

/** One more of a logged drink, on `date`: one drink's worth, named as one ("Vodka Soda", not "2 Vodka Sodas"). */
export function againEntry(e, date, nutritionFor = null) {
  const { id, created_at, updated_at, user_id, ...rest } = e; // eslint-disable-line no-unused-vars
  const units = drinkUnits(e);
  const one = units > 1 ? scaledEntry(e, 1 / units, nutritionFor) : {};
  return { ...rest, ...one, name: drinkName(e.name), date, meal: drinkMeal(date) };
}

/** What happened that day, in a few words: "3 drinks · cannabis". */
export function dayLine(x) {
  if (!x) return "";
  return [x.drinks > 0 && drinksLabel(x.drinks), x.cannabis && "cannabis"].filter(Boolean).join(" · ");
}

/** Totals over a set of days from wellnessDays(): drinks, drinking days, cannabis days, alcohol calories. */
export function sumDays(days) {
  const xs = Object.values(days);
  return {
    drinks: drinksFor(xs.reduce((a, x) => a + x.alcohol, 0)),
    drinkDays: xs.filter((x) => x.drinks > 0).length,
    cannabisDays: xs.filter((x) => x.cannabis).length,
    alcoholKcal: xs.reduce((a, x) => a + x.alcoholKcal, 0),
  };
}

/**
 * For the head coach: each day in the last `days` with drinks or cannabis, and the totals. Plain
 * facts, oldest first; the coach decides what matters.
 */
export function wellnessLines({ entries = null, wellness = {}, days = 30, to = today() }) {
  const from = addDays(to, -(days - 1));
  const w = wellnessDays({ entries, wellness, from, to });
  const dates = Object.keys(w).sort();
  if (!dates.length) return [`Alcohol and cannabis (they track both): none logged in the last ${days} days.`];
  const s = sumDays(w);
  return [
    `Alcohol and cannabis, last ${days} days (they track both; a day not listed had neither): ${drinksLabel(s.drinks)} on ${s.drinkDays} days (${s.alcoholKcal.toLocaleString()} kcal from alcohol), cannabis on ${s.cannabisDays} days.`,
    ...dates.map((d) => `- ${d}: ${dayLine(w[d])}${w[d].alcoholKcal ? ` (${w[d].alcoholKcal} kcal from alcohol)` : ""}`),
  ];
}

/**
 * Food against alcohol over a stretch of days, for Nutrition → Trends. `rows` are dailyRows() (only
 * fully logged days count toward the calorie numbers, like the rest of Trends). Returns null when
 * nothing with alcohol was logged.
 *   share: % of calories from alcohol, on fully logged days
 *   perWeek: standard drinks a week over the whole period
 *   drinkDays: days with any drinks
 *   foodOnDrinkDays / foodOtherDays: average calories from food alone, on drinking days and the rest
 */
export function alcoholTrend(entries, rows) {
  const from = rows[0]?.date, to = rows[rows.length - 1]?.date;
  if (!from) return null;
  const days = wellnessDays({ entries, from, to });
  if (!Object.keys(days).length) return null;
  const full = rows.filter((r) => r.full);
  const kcal = full.reduce((a, r) => a + r.kcal, 0);
  const alc = full.reduce((a, r) => a + (days[r.date]?.alcoholKcal || 0), 0);
  const food = (r) => r.kcal - (days[r.date]?.alcoholKcal || 0);
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length) : null);
  const s = sumDays(days);
  return {
    share: kcal ? Math.round((alc / kcal) * 100) : null,
    perWeek: Math.round((s.drinks / rows.length) * 7 * 10) / 10,
    drinkDays: s.drinkDays,
    foodOnDrinkDays: avg(full.filter((r) => days[r.date]?.drinks > 0).map(food)),
    foodOtherDays: avg(full.filter((r) => !(days[r.date]?.drinks > 0)).map(food)),
  };
}
