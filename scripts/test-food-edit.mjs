/* Checks for Tank editing the food log (today's, or the day open on the Nutrition tab) from the nutrition chat (src/lib/foodEdit.js): his
   proposed edits are checked against the log, shown as lines, applied by entry id, and undone.
   Run: npm run test:food   (exits 1 on any failure) */
import { previewFoodEdits, applyFoodEdits, todaysEntries } from "../src/lib/foodEdit.js";
import { nutritionChatContext, todayFood, addDays } from "../src/lib/nutrition.js";
import { today } from "../src/lib/util.js";

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

const d = today();
const ENTRIES = [
  { id: "b", date: d, meal: "breakfast", name: "Protein Oats", amount: 1, unit: "meal", kcal: 466, protein: 35, carbs: 58, fat: 12, source: "ai", source_ref: "f1", basis: { perServing: {}, servingLabel: "meal" }, created_at: "2026-10-12T08:00:00Z" },
  { id: "a", date: d, meal: "breakfast", name: "Latte", amount: 1, unit: "serving", kcal: 86, protein: 15, carbs: 6, fat: 0, source: "quick", created_at: "2026-10-12T07:00:00Z" },
  { id: "c", date: d, meal: "lunch", name: "Chicken & Sausage Rice Bowl", amount: 1, unit: "meal", kcal: 607, protein: 48, carbs: 70, fat: 15, source: "quick", created_at: "2026-10-12T12:00:00Z" },
  { id: "y", date: "2000-01-01", meal: "lunch", name: "Old", amount: 1, unit: "serving", kcal: 100, protein: 1, carbs: 1, fat: 1, source: "quick", created_at: "2000-01-01T12:00:00Z" },
];

// Numbering: oldest first, today only, and the context Tank reads uses the same numbers.
eq("today's entries, oldest first", todaysEntries(ENTRIES).map((e) => e.id), ["a", "b", "c"]);
const ctx = nutritionChatContext({ n: { targets: { kcal: 2160, protein: 160, carbs: 245, fat: 60 } }, entries: ENTRIES, sessions: [], weighins: [] });
eq("context numbers entries", /#1 breakfast Latte.*#2 breakfast Protein Oats.*#3 lunch Chicken & Sausage Rice Bowl/.test(ctx), true);

// Update lunch's numbers.
let p = previewFoodEdits(ENTRIES, [{ action: "update", entry: 3, kcal: 540, protein: 45, carbs: 60, fat: 13 }]);
eq("update: one op by id", p.ops.map((o) => [o.type, o.id]), [["update", "c"]]);
eq("update: patch", p.ops[0].patch, { kcal: 540, protein: 45, carbs: 60, fat: 13 });
eq("update: line", p.lines, ["Lunch: Chicken & Sausage Rice Bowl, 607 → 540 kcal (P 45 · C 60 · F 13)"]);
eq("update: no errors", p.errors, []);

// Calories way off the macros are corrected; close enough is kept.
eq("kcal off the macros is recomputed (4/4/9)", previewFoodEdits(ENTRIES, [{ action: "update", entry: 3, kcal: 900, protein: 45, carbs: 60, fat: 13 }]).ops[0].patch.kcal, 537);
eq("macros alone set the calories", previewFoodEdits(ENTRIES, [{ action: "update", entry: 3, protein: 45, carbs: 60, fat: 13 }]).ops[0].patch.kcal, 537);
eq("kcal near the macros is kept", previewFoodEdits(ENTRIES, [{ action: "update", entry: 3, kcal: 550, protein: 45, carbs: 60, fat: 13 }]).ops[0].patch.kcal, 550);

// Numbers over a portion-based entry turn it into its own numbers (no basis to recompute from).
p = previewFoodEdits(ENTRIES, [{ action: "update", entry: 2, kcal: 400, protein: 30, carbs: 50, fat: 9 }]);
eq("portion entry loses its basis", [p.ops[0].patch.basis, p.ops[0].patch.source, p.ops[0].patch.source_ref], [null, "quick", null]);
eq("before keeps the old basis for undo", p.ops[0].before.source, "ai");

// Move and rename keep the basis.
p = previewFoodEdits(ENTRIES, [{ action: "update", entry: 2, meal: "lunch", name: "PB Oats" }]);
eq("move + rename", p.ops[0].patch, { name: "PB Oats", meal: "lunch" });
eq("move + rename line", p.lines, ["Breakfast: Protein Oats, rename to PB Oats, move to Lunch"]);

// Add and remove.
p = previewFoodEdits(ENTRIES, [{ action: "add", meal: "snacks", name: "Greek Yogurt", kcal: 130, protein: 20, carbs: 8, fat: 2 }, { action: "remove", entry: 1 }]);
eq("add + remove ops", p.ops.map((o) => o.type), ["add", "remove"]);
eq("add row", (({ date, meal, name, kcal, source }) => ({ date, meal, name, kcal, source }))(p.ops[0].row), { date: d, meal: "snacks", name: "Greek Yogurt", kcal: 130, source: "quick" });
eq("add + remove lines", p.lines, ["Add to Snacks: Greek Yogurt, 130 kcal · P 20 · C 8 · F 2", "Remove Latte from Breakfast (86 kcal)"]);

// Bad edits are skipped with a reason, good ones still go through.
p = previewFoodEdits(ENTRIES, [
  { action: "update", entry: 9, kcal: 10 },
  { action: "add", meal: "lunch", name: "No calories" },
  { action: "add", meal: "brunch", name: "X", kcal: 10 },
  { action: "explode", entry: 1 },
  { action: "remove", entry: 1 },
  { action: "remove", entry: 1 },
]);
eq("only the valid edit is kept", p.ops.map((o) => [o.type, o.entry?.id]), [["remove", "a"]]);
eq("each bad edit says why", p.errors.length, 5);
p = previewFoodEdits(ENTRIES, [
  { action: "remove", entry: 0 },
  { action: "update", entry: 3, kcal: -5 },
  { action: "update", entry: 3, kcal: 607, protein: 48, carbs: 70, fat: 15 },
]);
eq("no entry #0, bad number, no change", [p.ops.length, p.errors.length], [0, 3]);
eq("at most 6 edits", previewFoodEdits(ENTRIES, Array(8).fill({ action: "add", meal: "lunch", name: "Egg", kcal: 70 })).ops.length, 6);

// Apply and undo through a fake food log.
const log = () => {
  const rows = new Map(ENTRIES.map((e) => [e.id, { ...e }]));
  let n = 0;
  return {
    get entries() { return [...rows.values()]; },
    addEntry: (row) => { const id = row.id || `new${++n}`; rows.set(id, { ...row, id }); return id; },
    updateEntry: (id, patch) => rows.set(id, { ...rows.get(id), ...patch, id }),
    removeEntry: (id) => rows.delete(id),
  };
};
const f = log();
// Rows as the log holds them, ignoring keys that are empty either way (undo restores a missing grams as null).
const snap = (l) => JSON.stringify(l.entries.map(({ created_at, ...e }) => Object.fromEntries(Object.entries(e).filter(([, v]) => v != null))).sort((a, b) => a.id.localeCompare(b.id))); // eslint-disable-line no-unused-vars
const before = snap(f);
p = previewFoodEdits(f.entries, [
  { action: "update", entry: 3, kcal: 540, protein: 45, carbs: 60, fat: 13 },
  { action: "update", entry: 2, protein: 40, carbs: 58, fat: 12 },
  { action: "remove", entry: 1 },
  { action: "add", meal: "snacks", name: "Greek Yogurt", kcal: 130, protein: 20, carbs: 8, fat: 2 },
]);
const undo = applyFoodEdits(f, p.ops);
eq("applied: lunch updated", f.entries.find((e) => e.id === "c").kcal, 540);
eq("applied: oats protein updated", f.entries.find((e) => e.id === "b").protein, 40);
eq("applied: latte removed", f.entries.some((e) => e.id === "a"), false);
eq("applied: yogurt added", f.entries.some((e) => e.name === "Greek Yogurt"), true);
undo();
eq("undo puts everything back", snap(f), before);

// An entry deleted between the proposal and Apply is skipped, not resurrected.
const g = log();
p = previewFoodEdits(g.entries, [{ action: "update", entry: 1, kcal: 90, protein: 15, carbs: 7, fat: 0 }]);
g.removeEntry("a");
eq("deleted since: nothing to apply", applyFoodEdits(g, p.ops), null);
eq("deleted since: not re-added", g.entries.some((e) => e.id === "a"), false);

// Changing what's in a meal: the smoothie from a saved food, 2% milk swapped for ultrafiltered.
// The coach sends the whole new ingredient list; the app adds it up and keeps the breakdown.
const SMOOTHIE = [
  { food: "2% Milk", amount: "1 cup", kcal: 122, protein: 8, carbs: 12, fat: 5, alcohol: 0 },
  { food: "Banana", amount: "1 medium", kcal: 105, protein: 1.3, carbs: 27, fat: 0.4, alcohol: 0 },
  { food: "Mixed Berries", amount: "1 cup", kcal: 70, protein: 1, carbs: 17, fat: 0.5, alcohol: 0 },
  { food: "Whey Protein", amount: "1 scoop", kcal: 120, protein: 24, carbs: 3, fat: 1.5, alcohol: 0 },
];
const perServing = { kcal: 417, protein: 34.3, carbs: 59, fat: 7.4, alcohol: 0 };
const smoothieEntry = { id: "s", date: d, meal: "dinner", name: "Banana Berry Smoothie", amount: 1, unit: "meal", ...perServing, source: "ai", source_ref: "saved1", basis: { perServing, servingLabel: "meal", items: SMOOTHIE }, created_at: "2026-10-12T18:00:00Z" };
const savedSmoothie = { id: "saved1", name: "Banana Berry Smoothie", basis: { perServing, servingLabel: "meal", items: SMOOTHIE } };
const swapped = [{ food: "Ultrafiltered Fat-Free Milk", amount: "6 oz", kcal: 60, protein: 10.5, carbs: 4.5, fat: 0, alcohol: 0, label: "Fairlife Fat Free (USDA)" }, ...SMOOTHIE.slice(1)];

const ctxS = nutritionChatContext({ n: { targets: { kcal: 2160, protein: 160, carbs: 245, fat: 60 } }, entries: [smoothieEntry], sessions: [], weighins: [] });
eq("context lists a meal's ingredients", /#1 dinner Banana Berry Smoothie.*\[ingredients, logged from a saved food: 2% Milk 1 cup \(122 kcal, P8 C12 F5\), Banana 1 medium/.test(ctxS), true);

p = previewFoodEdits([smoothieEntry], [{ action: "update", entry: 1, items: swapped }], [savedSmoothie]);
eq("items: one update op", p.ops.map((o) => o.type), ["update"]);
eq("items: totals added up by the app", [p.ops[0].patch.kcal, p.ops[0].patch.protein, p.ops[0].patch.carbs, p.ops[0].patch.fat], [355, 36.8, 51.5, 2.4]);
eq("items: breakdown kept", p.ops[0].patch.basis.items.map((x) => x.food), ["Ultrafiltered Fat-Free Milk", "Banana", "Mixed Berries", "Whey Protein"]);
eq("items: label kept on the looked-up item", p.ops[0].patch.basis.items[0].label, "Fairlife Fat Free (USDA)");
eq("items: still a meal from its saved food", [p.ops[0].patch.source, p.ops[0].patch.source_ref], [undefined, undefined]);
eq("items: card says the swap", p.lines, ["Dinner: Banana Berry Smoothie, 2% Milk (1 cup) → Ultrafiltered Fat-Free Milk (6 oz). 417 → 355 kcal (P 37 · C 52 · F 2)"]);

// Two smoothies logged: the entry scales with its amount.
p = previewFoodEdits([{ ...smoothieEntry, amount: 2, kcal: 834 }], [{ action: "update", entry: 1, items: swapped }]);
eq("items: scaled by the entry's amount", p.ops[0].patch.kcal, 710);

// The saved food too, when the lifter said yes.
p = previewFoodEdits([smoothieEntry], [{ action: "update", entry: 1, items: swapped, update_saved_food: true }], [savedSmoothie]);
eq("saved food: second op", p.ops.map((o) => [o.type, o.id]), [["update", "s"], ["saved", "saved1"]]);
eq("saved food: card says so", p.lines[1], "Your saved Banana Berry Smoothie gets the same change");
const sl = (() => {
  const rows = new Map([["s", { ...smoothieEntry }]]);
  const foods = new Map([["saved1", { ...savedSmoothie }]]);
  return {
    get entries() { return [...rows.values()]; }, get foods() { return [...foods.values()]; },
    addEntry: () => {}, removeEntry: () => {}, updateEntry: (id, x) => rows.set(id, { ...rows.get(id), ...x }),
    updateFood: (id, x) => foods.set(id, { ...foods.get(id), ...x }),
  };
})();
const undoS = applyFoodEdits(sl, p.ops);
eq("applied: entry and saved food both have the new milk", [sl.entries[0].basis.items[0].food, sl.foods[0].basis.items[0].food], ["Ultrafiltered Fat-Free Milk", "Ultrafiltered Fat-Free Milk"]);
eq("applied: saved food's per-serving numbers updated", sl.foods[0].basis.perServing.kcal, 355);
undoS();
eq("undo: both back to 2% milk", [sl.entries[0].basis.items[0].food, sl.foods[0].basis.items[0].food, sl.entries[0].kcal], ["2% Milk", "2% Milk", 417]);

// Asked to change a saved food that doesn't exist: only today's entry changes, and it says why.
p = previewFoodEdits([{ ...smoothieEntry, source: "quick", source_ref: null }], [{ action: "update", entry: 1, items: swapped, update_saved_food: true }]);
eq("no saved food: just the entry, with a note", [p.ops.length, p.errors.length], [1, 1]);

// A past day open on the Nutrition tab: Tank reads that day numbered, and edits go to it.
const y = addDays(d, -1);
const PAST = [
  ...ENTRIES,
  { id: "p", date: y, meal: "dinner", name: "Pizza & Cheese Curds", amount: 1, unit: "meal", kcal: 1169, protein: 57, carbs: 110, fat: 65, source: "quick", created_at: "2026-10-19T16:16:00Z" },
  { id: "q", date: y, meal: "breakfast", name: "Biscuit & Gravy", amount: 1, unit: "meal", kcal: 812, protein: 28, carbs: 62, fat: 50, source: "quick", created_at: "2026-10-18T16:35:00Z" },
];
const N = { targets: { kcal: 2160, protein: 160, carbs: 245, fat: 60 } };
const past = todayFood(N, PAST, y).join("\n");
eq("open day: its entries are numbered, oldest first", /Eaten on the open day.*#1 breakfast Biscuit & Gravy.*#2 dinner Pizza & Cheese Curds/.test(past), true);
eq("open day: today's are listed without numbers", /Eaten today: breakfast Latte/.test(past) && !/#\d+ breakfast Latte/.test(past), true);
eq("today open: unchanged", todayFood(N, PAST, d).join("\n"), todayFood(N, PAST).join("\n"));
p = previewFoodEdits(PAST, [{ action: "update", entry: 2, meal: "lunch" }], [], y);
eq("open day: move dinner to lunch hits that day's entry", [p.ops[0].id, p.ops[0].patch], ["p", { meal: "lunch" }]);
p = previewFoodEdits(PAST, [{ action: "add", meal: "snacks", name: "Apple", kcal: 95, protein: 0, carbs: 25, fat: 0 }], [], y);
eq("open day: an added food is dated that day", p.ops[0].row.date, y);
eq("open day: a number past its list is refused", previewFoodEdits(PAST, [{ action: "remove", entry: 3 }], [], y).errors, ["There's no entry #3 that day."]);

console.log(failed ? `food edit: ${failed} failed` : "food edit: all checks passed");
process.exit(failed ? 1 : 0);
