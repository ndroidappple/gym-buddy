/* Checks for Tank editing today's food log from the nutrition chat (src/lib/foodEdit.js): his
   proposed edits are checked against the log, shown as lines, applied by entry id, and undone.
   Run: npm run test:food   (exits 1 on any failure) */
import { previewFoodEdits, applyFoodEdits, todaysEntries } from "../src/lib/foodEdit.js";
import { nutritionChatContext } from "../src/lib/nutrition.js";
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

console.log(failed ? `food edit: ${failed} failed` : "food edit: all checks passed");
process.exit(failed ? 1 : 0);
