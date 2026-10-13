/* Checks for adding food: one ranked "Your foods" list (src/lib/yourFoods.js), the food
   database's relevance order (api/food.js), and Tank's meals with alcohol (cleanMeal).
   Run: npm run test:food   (exits 1 on any failure) */
import { yourFoods, pickYourFood, matchesQuery, whenLabel } from "../src/lib/yourFoods.js";
import { relevance, combine, forTank } from "../api/food.js";
import { nutritionFor, cleanMeal } from "../src/lib/nutrition.js";

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

const TODAY = "2026-10-06";
const NOW = Date.parse(`${TODAY}T15:00:00`);
const ago = (d) => { const x = new Date(`${TODAY}T12:00:00`); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
let n = 0;
const log = (name, meal, daysAgo, extra = {}) => ({ id: `e${++n}`, name, meal, date: ago(daysAgo), amount: 1, unit: "meal", kcal: 100, protein: 5, carbs: 10, fat: 2, source: "ai", source_ref: null, basis: null, created_at: `${ago(daysAgo)}T0${n % 10}:00:00Z`, ...extra });
const meal = (kcal) => ({ perServing: { kcal, protein: 10, carbs: 10, fat: 5 }, servingLabel: "meal" });
const foods = [
  { id: "oat", name: "Oatmeal with chia", basis: meal(522), created_at: "2026-09-28T23:06:00Z" },
  { id: "latte", name: "Brown sugar latte", basis: meal(179), created_at: "2026-09-28T23:08:00Z" },
  { id: "bowl", name: "Turkey Meatball Bowl", basis: meal(700), created_at: "2026-09-29T01:16:00Z" },
  { id: "culvers", name: "Culver's Meal", basis: meal(2180), created_at: "2026-10-01T01:51:00Z" },
  { id: "shake1", name: "Protein Shake", basis: meal(240), created_at: "2026-10-05T03:12:00Z" },
  { id: "shake2", name: "Protein Shake", basis: meal(160), created_at: "2026-10-06T12:28:00Z" },
  { id: "never", name: "Saved, never logged", basis: meal(300), created_at: "2026-10-06T13:00:00Z" },
];
const entries = [
  log("Oatmeal with chia", "breakfast", 8, { source_ref: "oat", kcal: 522 }),
  log("Brown sugar latte", "breakfast", 1, { source_ref: "latte", source: "custom", kcal: 179 }),
  log("Brown sugar latte", "breakfast", 3, { source_ref: "latte", kcal: 179 }),
  log("Brown sugar latte", "breakfast", 4, { source_ref: "latte", kcal: 179 }),
  log("Brown sugar latte", "breakfast", 7, { source_ref: "latte", kcal: 179 }),
  log("Turkey Meatball Bowl", "lunch", 5, { source_ref: "bowl", kcal: 700 }),
  log("Turkey Meatball Bowl", "lunch", 6, { source_ref: "bowl", kcal: 700 }),
  log("Turkey Meatball Bowl", "dinner", 6, { source_ref: "bowl", kcal: 700 }),
  log("Turkey Meatball Bowl", "lunch", 7, { source_ref: "bowl", kcal: 700 }),
  log("Turkey Meatball Bowl", "lunch", 8, { source_ref: "bowl", kcal: 700 }),
  log("Culver's Meal", "dinner", 6, { source_ref: "culvers", kcal: 2180 }),
  log("Protein Shake", "snacks", 1, { source_ref: "shake1", source: "custom", kcal: 240 }),
  log("Protein Shake", "breakfast", 0, { source_ref: "shake2", kcal: 160 }),
  // Not saved: grouped by name (any case); a quick add has no basis.
  log("Banana smoothie", "breakfast", 2, { kcal: 400 }),
  log("banana Smoothie ", "breakfast", 9, { kcal: 380 }),
  log("Vending machine chips", "snacks", 2, { source: "quick", unit: "serving", amount: 2, kcal: 300, protein: 4, carbs: 30, fat: 18 }),
  // A log with the same name as two saved foods, and no link to either: its own item.
  log("Protein Shake", "snacks", 3, { kcal: 200 }),
];

const names = (list) => list.map((x) => x.name);

// Breakfast: the latte you have most mornings leads; the lunch bowl drops below breakfast foods.
const bk = yourFoods(entries, foods, { meal: "breakfast", now: NOW });
eq("breakfast: latte first", bk[0].name, "Brown sugar latte");
eq("breakfast: latte above the bowl", names(bk).indexOf("Brown sugar latte") < names(bk).indexOf("Turkey Meatball Bowl"), true);
eq("breakfast: smoothie above the bowl", names(bk).indexOf("Banana smoothie") < names(bk).indexOf("Turkey Meatball Bowl"), true);
// Lunch: the bowl you have most lunches leads.
const ln = yourFoods(entries, foods, { meal: "lunch", now: NOW });
eq("lunch: bowl first", ln[0].name, "Turkey Meatball Bowl");
// A one-off sinks below things you have often; saved-but-never-logged comes last.
eq("one-off below the regulars", names(ln).indexOf("Culver's Meal") > names(ln).indexOf("Brown sugar latte"), true);
eq("never logged is last", ln[ln.length - 1].name, "Saved, never logged");
eq("never logged: no date, its own calories", [ln[ln.length - 1].lastDate, ln[ln.length - 1].kcal, ln[ln.length - 1].count], [null, 300, 0]);

// One item per food: logs join their saved food; each food appears once.
const latte = bk.find((x) => x.name === "Brown sugar latte");
eq("latte: logs joined to the saved food", [latte.count, latte.key, latte.usual, latte.lastDate, latte.kcal], [4, "food:latte", "breakfast", ago(1), 179]);
eq("each food once", new Set(bk.map((x) => x.key)).size, bk.length);
eq("same-named saved foods stay apart", bk.filter((x) => x.name === "Protein Shake").map((x) => x.key).sort(), ["food:shake1", "food:shake2", "name:protein shake|"]);
const smoothie = bk.find((x) => x.key === "name:banana smoothie|");
eq("unsaved logs grouped by name, any case", [smoothie.count, smoothie.name, smoothie.kcal], [2, "Banana smoothie", 400]);
const bowl = ln.find((x) => x.name === "Turkey Meatball Bowl");
eq("usual meal when it's clear", bowl.usual, "lunch");
eq("no usual meal for a single log", bk.find((x) => x.name === "Culver's Meal").usual, null);
// A renamed saved food shows its new name.
eq("saved name wins", yourFoods([log("Old name", "lunch", 1, { source_ref: "bowl" })], [{ ...foods[2], name: "New name" }], { now: NOW })[0].name, "New name");

// Deleting a saved food takes it off the list, though its logs stay.
const gone = yourFoods(entries, foods.filter((f) => f.id !== "culvers"), { meal: "dinner", now: NOW });
eq("deleted saved food is off the list", gone.some((x) => x.name === "Culver's Meal"), false);

// Picking: last time's amount, and the source of the log it came from.
const p1 = pickYourFood(latte);
eq("pick saved: source of the last log, last amount", [p1.food.source, p1.food.ref, p1.amount, p1.unit], ["custom", "latte", 1, "meal"]);
const p2 = pickYourFood(bk.find((x) => x.key === "food:shake2"));
eq("pick Tank meal: stays ai", p2.food.source, "ai");
const chips = bk.find((x) => x.name === "Vending machine chips");
const p3 = pickYourFood(chips);
eq("quick add: a basis from its own numbers", [p3.amount, p3.unit, nutritionFor(p3.food.basis, p3.amount, p3.unit).kcal], [2, "serving", 300]);

// Search within your foods: every word, any order.
eq("all words, any order", matchesQuery({ name: "Sugar-Free Protein Latte" }, "latte protein"), true);
eq("brand counts", matchesQuery({ name: "Latte", brand: "Starbucks" }, "starbucks latte"), true);
eq("a missing word fails", matchesQuery({ name: "Protein Latte" }, "latte vanilla"), false);

// When: today, yesterday, a weekday this week, else the date.
eq("today", whenLabel(TODAY, TODAY), "today");
eq("yesterday", whenLabel(ago(1), TODAY), "yesterday");
eq("this week", whenLabel(ago(3), TODAY), new Date(`${ago(3)}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" }));
eq("older", whenLabel(ago(9), TODAY), new Date(`${ago(9)}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }));

// Food database: real matches before loose ones, everyday before packaged when equal.
const db = combine(
  [{ name: "Coffee, latte" }, { name: "Light fat free yogurt, very vanilla, chai latte" }],
  [{ name: "Caffè Latte", brand: "Starbucks" }, { name: "Latte" }, { name: "Plattered cheese" }, { name: "Latte" }],
  "latte");
eq("db: exact first, loose last, duplicates out", names(db), ["Latte", "Caffè Latte", "Coffee, latte", "Light fat free yogurt, very vanilla, chai latte", "Plattered cheese"]);
eq("db: phrase beats scattered words", relevance("Greek yogurt, plain", "greek yogurt") > relevance("Yogurt, Greek, plain", "greek yogurt"), true);
eq("db: missing words rank low", relevance("Greek style dressing", "greek yogurt") < relevance("Yogurt, Greek, plain", "greek yogurt"), true);

// Tank meals: alcohol is 7 kcal/g in none of protein, carbs or fat, so it has its own grams.
const meal1 = (items) => cleanMeal({ name: "Drinks", items });
const it = (o) => ({ food: "x", amount: "1", protein: 0, carbs: 0, fat: 0, ...o });
eq("beer with alcohol keeps its calories", meal1([it({ food: "Modelo Especial", kcal: 144, carbs: 13.7, protein: 1, alcohol: 12.2 })]).items[0].kcal, 144);
eq("3 seltzers keep their calories", meal1([it({ food: "Vodka cans (pre-mixed)", kcal: 300, carbs: 12, alcohol: 36 })]).total, { kcal: 300, protein: 0, carbs: 12, fat: 0, alcohol: 36 });
eq("a spirit with no macros", meal1([it({ food: "Vodka soda", kcal: 97, alcohol: 14 })]).items[0].kcal, 97);
// The old bug: a reply without alcohol for a drink. Calories above the macros count as alcohol, not an error.
const old = meal1([it({ food: "Modelo Especial", kcal: 144, carbs: 13.7, protein: 1 })]).items[0];
eq("drink with no alcohol given: calories kept, alcohol worked out", [old.kcal, old.alcohol], [144, 12.2]);
// Food is still checked against its macros, alcohol or not.
eq("food: wrong calories corrected", meal1([it({ food: "Chicken breast", kcal: 500, protein: 31, fat: 3.6 })]).items[0].kcal, 156);
eq("food: no alcohol invented", meal1([it({ food: "Chicken breast", kcal: 500, protein: 31, fat: 3.6 })]).items[0].alcohol, 0);
eq("ginger ale is not a drink with alcohol", meal1([it({ food: "Ginger ale", kcal: 200, carbs: 32 })]).items[0].kcal, 128);
eq("root beer and NA beer aren't either", [meal1([it({ food: "Root beer", kcal: 250, carbs: 40 })]).items[0].kcal, meal1([it({ food: "Heineken 0.0 non-alcoholic beer", kcal: 150, carbs: 16 })]).items[0].kcal], [160, 64]);
eq("drink with impossible alcohol is corrected", meal1([it({ food: "Light beer", kcal: 900, carbs: 5, alcohol: 11 })]).items[0].kcal, 97);
eq("a meal mixing food and drinks totals both", meal1([it({ food: "Burger", kcal: 650, protein: 35, carbs: 45, fat: 36 }), it({ food: "IPA", kcal: 200, carbs: 15, protein: 2, alcohol: 18 })]).total.alcohol, 18);

// Tank's product lookup: label numbers per serving worked out, the brand named once, the source said.
const ratio = { source: "usda", name: "Ratio Yogurt, Vanilla", brand: "Ratio", basis: { per100: { kcal: 113, protein: 16.7, carbs: 6, fat: 2.7 }, portions: [{ label: "serving (150 g)", grams: 150 }] } };
eq("lookup: per serving worked out", forTank(ratio).serving, { label: "serving (150 g)", grams: 150, kcal: 170, protein: 25.1, carbs: 9, fat: 4.1 });
eq("lookup: brand already in the name isn't repeated", forTank(ratio).product, "Ratio Yogurt, Vanilla");
eq("lookup: brand added when missing", forTank({ ...ratio, source: "off", name: "Core Power Chocolate", brand: "Fairlife", basis: { ...ratio.basis, portions: [] } }).product, "Fairlife Core Power Chocolate");
eq("lookup: source named", forTank({ ...ratio, source: "off" }).source, "Open Food Facts");
eq("lookup: no serving on the label, none made up", "serving" in forTank({ ...ratio, basis: { ...ratio.basis, portions: [] } }), false);
// The label Tank used rides on the item; an estimate has none.
eq("meal item keeps its label", meal1([it({ food: "Ratio Yogurt", kcal: 170, protein: 25, carbs: 9, fat: 4, label: "Ratio Yogurt, Vanilla (USDA)" })]).items[0].label, "Ratio Yogurt, Vanilla (USDA)");
eq("estimated item has no label", "label" in meal1([it({ food: "Eggs", kcal: 140, protein: 12, carbs: 1, fat: 10 })]).items[0], false);

console.log(failed ? `food picker: ${failed} failed` : "food picker: all checks passed");
process.exit(failed ? 1 : 0);
