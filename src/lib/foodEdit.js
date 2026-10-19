import { MEALS, cleanMeal, nutritionFor } from "./nutrition.js";
import { today } from "./util.js";

/* Tank editing a day's food log from the chat: today's, or the day open on the Nutrition tab. Like
   program changes, he only proposes: the edits travel to the app, which checks them against the
   log, shows them on a card, and changes nothing until the lifter taps Apply. Tank refers to
   entries by their number in the "Eaten" list he was given (#1, #2…); the app keeps the matching ids. */

const MEAL_IDS = MEALS.map((m) => m.id);
const mealLabel = (id) => MEALS.find((m) => m.id === id)?.label || id;
const r = Math.round;
const fmt = (n) => r(n).toLocaleString();
const LIMIT = { kcal: 20000, protein: 2000, carbs: 2000, fat: 2000 }; // the food_entries checks
const MACROS = ["protein", "carbs", "fat"];

/** A day's entries (today's by default) in the order Tank sees them, oldest first. Entry n is "#n". */
export const todaysEntries = (entries, day = today()) =>
  entries.filter((e) => e.date === day).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));

const num = (v, hi) => (v === undefined || v === null || v === "" ? undefined : Number.isFinite(+v) && +v >= 0 && +v < hi ? Math.round(+v * 10) / 10 : NaN);

/** The numbers an edit sets, checked: undefined for one it leaves alone, or an error. */
function readNumbers(e) {
  const out = {};
  for (const k of ["kcal", ...MACROS]) {
    const v = num(e[k], LIMIT[k]);
    if (Number.isNaN(v)) return { error: `${k} isn't a valid amount` };
    if (v !== undefined) out[k] = k === "kcal" ? r(v) : v;
  }
  // Calories that don't match the macros are the model's arithmetic slipping: trust the macros.
  if (MACROS.every((k) => out[k] !== undefined)) {
    const worked = out.protein * 4 + out.carbs * 4 + out.fat * 9;
    if (out.kcal === undefined || (worked > 0 && Math.abs(out.kcal - worked) > Math.max(20, worked * 0.2))) out.kcal = r(worked);
  }
  return { out };
}

const macroLine = (x) => `${fmt(x.kcal)} kcal · P ${r(x.protein)} · C ${r(x.carbs)} · F ${r(x.fat)}`;

/** What changed between a meal's old and new ingredients, in words: "2% Milk (1 cup) → Ultrafiltered
    Fat-Free Milk (6 oz)" for a swap, else what was added, removed or changed. */
function itemsDiff(before = [], after = []) {
  const key = (x) => String(x.food || "").trim().toLowerCase();
  const was = new Map(before.map((x) => [key(x), x]));
  const now = new Map(after.map((x) => [key(x), x]));
  const removed = before.filter((x) => !now.has(key(x)));
  const added = after.filter((x) => !was.has(key(x)));
  const changed = after.filter((x) => was.has(key(x)) && (was.get(key(x)).amount !== x.amount || r(was.get(key(x)).kcal) !== r(x.kcal)));
  const amt = (x) => (x.amount ? ` (${x.amount})` : "");
  if (removed.length === 1 && added.length === 1) return [`${removed[0].food}${amt(removed[0])} → ${added[0].food}${amt(added[0])}`, ...changed.map((x) => `${x.food}: ${was.get(key(x)).amount} → ${x.amount}`)];
  return [
    ...removed.map((x) => `remove ${x.food}`),
    ...added.map((x) => `add ${x.food}${amt(x)}`),
    ...changed.map((x) => `${x.food}: ${was.get(key(x)).amount || "?"} → ${x.amount || "?"}`),
  ];
}

/**
 * Checks Tank's proposed edits against the log of `day` (today unless the Nutrition tab has another day open). Returns { ops, lines, errors }: ops are what
 * Apply does (by entry id, so they survive the list reordering), lines say it in words for the
 * card, errors say what was skipped and why.
 */
export function previewFoodEdits(entries, edits, foods = [], date = today()) {
  const day = todaysEntries(entries, date);
  const ops = [], lines = [], errors = [];
  const touched = new Set();
  for (const e of (Array.isArray(edits) ? edits : []).slice(0, 6)) {
    const action = e?.action;
    if (!["update", "add", "remove"].includes(action)) { errors.push(`Unknown change "${action}".`); continue; }
    const meal = e?.meal === undefined ? undefined : MEAL_IDS.includes(String(e.meal).toLowerCase()) ? String(e.meal).toLowerCase() : null;
    if (meal === null) { errors.push(`"${e.meal}" isn't a meal.`); continue; }
    const name = typeof e?.name === "string" && e.name.trim() ? e.name.trim().slice(0, 120) : undefined;
    const { out: n, error } = readNumbers(e || {});
    if (error) { errors.push(`${error}.`); continue; }

    if (action === "add") {
      if (!name || !meal || n.kcal === undefined) { errors.push("A food to add needs a name, a meal and its calories."); continue; }
      const row = { date, meal, name, amount: 1, unit: "serving", kcal: n.kcal, protein: n.protein ?? 0, carbs: n.carbs ?? 0, fat: n.fat ?? 0, source: "quick" };
      ops.push({ type: "add", row });
      lines.push(`Add to ${mealLabel(meal)}: ${name}, ${macroLine(row)}`);
      continue;
    }

    const ref = Number(e?.entry);
    const entry = Number.isInteger(ref) ? day[ref - 1] : undefined;
    if (!entry) { errors.push(`There's no entry #${e?.entry} ${date === today() ? "today" : "that day"}.`); continue; }
    if (touched.has(entry.id)) { errors.push(`${entry.name} was already changed above.`); continue; }
    touched.add(entry.id);

    if (action === "remove") {
      ops.push({ type: "remove", entry });
      lines.push(`Remove ${entry.name} from ${mealLabel(entry.meal)} (${fmt(entry.kcal)} kcal)`);
      continue;
    }

    // A change to what's in a meal: the coach sends the whole new ingredient list and the app adds it
    // up (models are poor at arithmetic), keeping the breakdown so the meal can be edited again.
    if (Array.isArray(e?.items)) {
      const cooked = cleanMeal({ name: entry.name, items: e.items });
      if (!cooked) { errors.push(`The new ingredients for ${entry.name} didn't add up to anything.`); continue; }
      const meal0 = entry.basis?.perServing && !entry.basis.per100;
      const basis = { ...(meal0 ? entry.basis : { servingLabel: "meal" }), perServing: cooked.total, items: cooked.items };
      const amount = meal0 ? +entry.amount || 1 : 1;
      const t = nutritionFor(basis, amount, entry.unit);
      const patch = { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, basis, ...(meal0 ? {} : { amount: 1, unit: "meal", grams: null }) };
      if (name && name !== entry.name) patch.name = name;
      if (meal && meal !== entry.meal) patch.meal = meal;
      const before = Object.fromEntries(Object.keys(patch).map((k) => [k, entry[k] ?? null]));
      ops.push({ type: "update", id: entry.id, patch, before });
      const diff = itemsDiff(entry.basis?.items, cooked.items);
      lines.push(`${mealLabel(entry.meal)}: ${entry.name}, ${diff.length ? diff.join("; ") : "same ingredients"}. ${fmt(entry.kcal)} → ${fmt(t.kcal)} kcal (P ${r(t.protein)} · C ${r(t.carbs)} · F ${r(t.fat)})`);
      // The saved food it was logged from, so the next time it's logged it has the change too.
      if (e.update_saved_food) {
        const saved = ["custom", "ai"].includes(entry.source) && entry.source_ref ? foods.find((f) => f.id === entry.source_ref) : null;
        if (saved) {
          ops.push({ type: "saved", id: saved.id, patch: { basis: { ...saved.basis, perServing: cooked.total, items: cooked.items } }, before: { basis: saved.basis } });
          lines.push(`Your saved ${saved.name} gets the same change`);
        } else errors.push(`${entry.name} wasn't logged from a saved food, so only this entry changes.`);
      }
      continue;
    }

    const patch = {};
    if (name && name !== entry.name) patch.name = name;
    if (meal && meal !== entry.meal) patch.meal = meal;
    const numbers = Object.fromEntries(Object.entries(n).filter(([k, v]) => r(v) !== r(+entry[k] || 0)));
    if (Object.keys(numbers).length) {
      Object.assign(patch, numbers);
      // Numbers typed over a portion's: from now on the entry is its own numbers, like a quick add,
      // so editing it later doesn't recompute them from the old food.
      if (entry.basis) Object.assign(patch, { basis: null, grams: null, source: "quick", source_ref: null });
    }
    if (!Object.keys(patch).length) { errors.push(`${entry.name} already has those numbers.`); continue; }

    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, entry[k] ?? null]));
    ops.push({ type: "update", id: entry.id, patch, before });
    const parts = [];
    if (patch.name) parts.push(`rename to ${patch.name}`);
    if (patch.meal) parts.push(`move to ${mealLabel(patch.meal)}`);
    if (Object.keys(numbers).length) {
      const after = { ...entry, ...patch };
      parts.push(r(after.kcal) !== r(entry.kcal) ? `${fmt(entry.kcal)} → ${fmt(after.kcal)} kcal (P ${r(after.protein)} · C ${r(after.carbs)} · F ${r(after.fat)})` : macroLine(after));
    }
    lines.push(`${mealLabel(entry.meal)}: ${entry.name}, ${parts.join(", ")}`);
  }
  return { ops, lines, errors };
}

/**
 * Applies previewed ops through the food log (food.addEntry/updateEntry/removeEntry), re-checked
 * against the log as it is now: an entry deleted since the proposal is skipped. Returns an undo
 * that puts everything back, or null when nothing applied.
 */
export function applyFoodEdits(food, ops) {
  const live = new Map(food.entries.map((e) => [e.id, e]));
  const undo = [];
  for (const op of ops) {
    if (op.type === "add") {
      const id = food.addEntry(op.row);
      undo.push(() => food.removeEntry(id));
    } else if (op.type === "update" && live.has(op.id)) {
      food.updateEntry(op.id, op.patch);
      undo.push(() => food.updateEntry(op.id, op.before));
    } else if (op.type === "saved" && food.foods?.some((f) => f.id === op.id)) {
      food.updateFood(op.id, op.patch);
      undo.push(() => food.updateFood(op.id, op.before));
    } else if (op.type === "remove" && live.has(op.entry.id)) {
      const { created_at, updated_at, ...rest } = live.get(op.entry.id); // eslint-disable-line no-unused-vars
      food.removeEntry(op.entry.id);
      undo.push(() => food.addEntry(rest));
    }
  }
  return undo.length ? () => undo.reverse().forEach((f) => f()) : null;
}
