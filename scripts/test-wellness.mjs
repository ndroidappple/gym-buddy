/* Checks drinks and cannabis (src/lib/wellness.js): alcohol read back from a food's basis or worked out
   from a drink's name, standard drinks, each day's wellness from the food log and the account's log,
   and food against alcohol over a period.
   Run: npm run test:wellness   (exits 1 on any failure) */
const W = await import("../src/lib/wellness.js");
const { dailyRows } = await import("../src/lib/nutritionTrends.js");

let failed = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

const food = (name, date, extra = {}) => ({ id: name + date, name, date, meal: "dinner", amount: 1, kcal: 500, protein: 40, carbs: 50, fat: 15, ...extra });

// Alcohol, wherever it can be found.
eq("Tank's meal keeps it per serving", W.alcoholOf(food("Two Modelos", "d", { basis: { perServing: { alcohol: 28 } } })), 28);
eq("per serving, times the servings", W.alcoholOf(food("Wine", "d", { amount: 2, basis: { perServing: { alcohol: 14 } } })), 28);
eq("a meal Tank said had none has none, whatever it's called", W.alcoholOf(food("Beer battered fish", "d", { basis: { perServing: { alcohol: 0 } } })), 0);
eq("USDA per 100 g, by the grams logged", W.alcoholOf(food("Beer, regular", "d", { grams: 355, basis: { per100: { alcohol: 3.9 } } })), 13.8);
eq("an older drink: the calories its macros don't explain", W.alcoholOf(food("IPA", "d", { kcal: 200, protein: 2, carbs: 16, fat: 0 })), 18.3);
eq("a food that isn't a drink has none", W.alcoholOf(food("Chicken bowl", "d")), 0);
eq("non-alcoholic beer has none", W.alcoholOf(food("Non-alcoholic beer", "d", { kcal: 70, protein: 1, carbs: 14, fat: 0 })), 0);
eq("standard drinks, to the half", [W.drinksFor(14), W.drinksFor(28), W.drinksFor(18.9), W.drinksFor(4), W.drinksFor(2)], [1, 2, 1.5, 0.5, 0]);

// Each day: drinks from the food log, cannabis from the account's log.
const entries = [
  food("Chicken bowl", "2026-11-20"),
  food("Beer", "2026-11-20", { kcal: 150, protein: 1.6, carbs: 13, fat: 0, basis: { perServing: W.DRINK_PRESETS[0].per } }),
  food("Beer", "2026-11-20", { kcal: 150, protein: 1.6, carbs: 13, fat: 0, basis: { perServing: W.DRINK_PRESETS[0].per } }),
];
const log = { "2026-11-20": { cannabis: true }, "2026-11-22": { cannabis: true }, "2026-11-23": { drinks: 3 } };
const days = W.wellnessDays({ entries, wellness: log });
eq("a drinking day", [days["2026-11-20"].drinks, days["2026-11-20"].alcoholKcal, days["2026-11-20"].cannabis, days["2026-11-20"].items.length], [2, 196, true, 2]);
eq("a cannabis-only day", [days["2026-11-22"].drinks, days["2026-11-22"].cannabis], [0, true]);
eq("with food tracking on, the account's count is ignored (the food log is the record)", days["2026-11-23"], undefined);
const off = W.wellnessDays({ entries: null, wellness: log });
eq("with food tracking off, the count is used", off["2026-11-23"].drinks, 3);
eq("wine in a sauce isn't a drinking day", W.wellnessDays({ entries: [food("Coq au vin", "2026-11-24", { basis: { perServing: { alcohol: 2 } } })] }), {});
eq("a date range", Object.keys(W.wellnessDays({ entries, wellness: log, from: "2026-11-21", to: "2026-11-30" })), ["2026-11-22"]);
eq("day line", [W.dayLine(days["2026-11-20"]), W.dayLine(days["2026-11-22"]), W.dayLine(off["2026-11-23"])], ["2 drinks · cannabis", "cannabis", "3 drinks"]);
eq("totals", W.sumDays(days), { drinks: 2, drinkDays: 1, cannabisDays: 2, alcoholKcal: 196 });

// A preset becomes a food log row with its alcohol in the basis; last night's goes to dinner.
const row = W.drinkEntry(W.DRINK_PRESETS[1], "2000-01-01");
eq("a preset drink row", [row.meal, row.name, row.kcal, row.source, row.basis.perServing.alcohol, W.alcoholOf(row)], ["dinner", "Wine", 120, "custom", 14, 14]);

// Coach lines: facts only, and a clear "none" when there's nothing.
eq("coach: nothing logged", W.wellnessLines({ entries: [], wellness: {}, days: 30, to: "2026-11-27" }), ["Drinks and cannabis (they track both): none logged in the last 30 days."]);
eq("coach: days listed", W.wellnessLines({ entries, wellness: log, days: 30, to: "2026-11-27" }).slice(1), ["- 2026-11-20: 2 drinks · cannabis (196 kcal from alcohol)", "- 2026-11-22: cannabis"]);

// Food against alcohol over a period: only full days count toward the calories.
const n = { targets: { kcal: 2000, protein: 150, carbs: 200, fat: 60 } };
const period = [
  food("Day food", "2026-11-01", { kcal: 2000 }), food("Day food", "2026-11-02", { kcal: 2000 }),
  food("Dinner", "2026-11-03", { kcal: 2200 }),
  food("Beer", "2026-11-03", { kcal: 300, protein: 3, carbs: 26, fat: 0, basis: { perServing: { alcohol: 28 } } }),
];
const t = W.alcoholTrend(period, dailyRows(period, n, "2026-11-01", "2026-11-07"));
eq("alcohol trend", t, { share: 3, perWeek: 2, drinkDays: 1, foodOnDrinkDays: 2304, foodOtherDays: 2000 });
eq("no drinks, no trend", W.alcoholTrend(period.slice(0, 2), dailyRows(period.slice(0, 2), n, "2026-11-01", "2026-11-07")), null);

console.log(failed ? `wellness: ${failed} failed` : "wellness: all checks passed");
process.exit(failed ? 1 : 0);
