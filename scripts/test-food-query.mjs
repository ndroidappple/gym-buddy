/* Checks how Add food's search box reads what's typed (src/lib/foodQuery.js): a search, an amount and a
   food, or a meal described in words (the coach's job); forgiving matches on the lifter's own foods; and
   where an amount's portion starts. Run: npm run test:food   (exits 1 on any failure) */
const Q = await import("../src/lib/foodQuery.js");

let failed = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};
const kind = (s, o) => Q.readQuery(s, o).kind;

// Searches.
for (const s of ["greek yogurt", "protein bar", "chipotle", "Fairlife core power", "steak pico rice bowl"]) eq(`search: ${s}`, kind(s), "search");
eq("nothing typed", kind("  "), "empty");

// An amount and one food.
const a = (s) => { const r = Q.readQuery(s); return [r.kind, r.amount, r.unit, r.food]; };
eq("200g chicken breast", a("200g chicken breast"), ["amount", 200, "g", "chicken breast"]);
eq("2 eggs", a("2 eggs"), ["amount", 2, null, "eggs"]);
eq("1.5 cups of rice", a("1.5 cups of rice"), ["amount", 1.5, "cup", "rice"]);
eq("½ cup oatmeal", a("½ cup oatmeal"), ["amount", 0.5, "cup", "oatmeal"]);
eq("half a bagel", a("half a bagel"), ["amount", 0.5, null, "bagel"]);
eq("2 large eggs", a("2 large eggs"), ["amount", 2, "large", "eggs"]);
eq("1 kg potatoes", a("1 kg potatoes"), ["amount", 1, "kg", "potatoes"]);
eq("2 protein bars", a("2 protein bars"), ["amount", 2, null, "protein bars"]);

// A meal in words: for the coach.
for (const s of [
  "2 eggs, toast with butter and a latte",
  "chicken, rice and broccoli",
  "i had a burrito bowl from chipotle with extra chicken",
  "½ cup oatmeal, 1 tbsp peanut butter, half a small apple",
  "big salad with grilled chicken avocado and ranch dressing",
  "oatmeal + protein powder",
]) eq(`describe: ${s}`, kind(s), "describe");
// A saved food whose name reads like a list is still a search for it.
eq("their own 'Chicken & Sausage Rice Bowl'", kind("chicken & sausage rice bowl", { known: true }), "search");
eq("the same typed with no such food", kind("chicken & sausage rice bowl"), "describe");

// Matching their own foods, forgivingly, best first.
const latte = { name: "Protein Latte" }, bar = { name: "Protein Bar", brand: "Barebells" }, bowl = { name: "Steak Pico Rice Bowl" }, egg = { name: "Eggs" };
eq("starts with beats has-all-words beats forgiving", [Q.matchScore(latte, "protein"), Q.matchScore(bowl, "rice bowl"), Q.matchScore(egg, "egg")], [3, 2, 3]);
eq("plural and singular", [Q.matchScore(bar, "protein bars") > 0, Q.matchScore(egg, "eggs") > 0], [true, true]);
eq("a typo", Q.matchScore(latte, "protien latte") > 0, true);
eq("brand", Q.matchScore(bar, "barebells") > 0, true);
eq("word order", Q.matchScore(bowl, "rice steak") > 0, true);
eq("punctuation is ignored", Q.matchScore({ name: "Chicken & Sausage Rice Bowl" }, "chicken & sausage"), 3);
eq("no match", [Q.matchScore(latte, "pizza"), Q.matchScore(bar, "pro bar x")], [0, 0]);
eq("short words aren't guessed at", Q.matchScore(latte, "la te"), 0);

// Where an amount's portion starts, in the food's own units.
const units = [{ label: "1 cup (240 g)", grams: 240 }, { label: "1 large (50 g)", grams: 50 }, { label: "g", grams: 1 }, { label: "oz", grams: 28.35 }];
eq("grams", Q.portionFor(units, 200, "g"), { amount: 200, unit: "g" });
eq("cups", Q.portionFor(units, 1.5, "cup"), { amount: 1.5, unit: "1 cup (240 g)" });
eq("a size", Q.portionFor(units, 2, "large"), { amount: 2, unit: "1 large (50 g)" });
eq("kg to g", Q.portionFor(units, 1, "kg"), { amount: 1000, unit: "g" });
eq("lb to oz", Q.portionFor(units, 0.5, "lb"), { amount: 8, unit: "oz" });
eq("a count", Q.portionFor(units, 2, null), { amount: 2 });
eq("no such unit", Q.portionFor([{ label: "serving", grams: null }], 1, "tbsp"), null);

// A described meal, item by item.
const items = (s) => Q.mealItems(s).map((x) => [x.food, x.amount, x.unit]);
eq("items", items("2 eggs, toast with butter and a latte"), [["eggs", 2, null], ["toast", null, null], ["butter", null, null], ["latte", null, null]]);
eq("items with units", items("½ cup oatmeal, 1 tbsp peanut butter + 200g greek yogurt"), [["oatmeal", 0.5, "cup"], ["peanut butter", 1, "tbsp"], ["greek yogurt", 200, "g"]]);
eq("theirs and the meal dropped", items("2 eggs, toast and my protein latte"), [["eggs", 2, null], ["toast", null, null], ["protein latte", null, null]]);
eq("for lunch dropped", items("a sandwich and chips for lunch"), [["sandwich", null, null], ["chips", null, null]]);
eq("lead-ins dropped", items("I had a burrito bowl from chipotle and a coke"), [["burrito bowl from chipotle", null, null], ["coke", null, null]]);

if (failed) { console.error(`\n${failed} food query check(s) failed`); process.exit(1); }
console.log("food query: all checks passed");
