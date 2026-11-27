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

/** A food log row for one preset drink on `date`. Last night's drinks go to dinner; today's, to the meal for now. */
export function drinkEntry(preset, date) {
  const p = preset.per;
  return {
    date, meal: date === today() ? mealForNow() : "dinner",
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
