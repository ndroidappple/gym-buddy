import { MEALS } from "./nutrition.js";
import { today } from "./util.js";

/* Tank editing today's food log from the nutrition chat. Like program changes, he only proposes:
   the edits travel to the app, which checks them against the log, shows them on a card, and
   changes nothing until the lifter taps Apply. Tank refers to entries by their number in the
   "Eaten today" list he was given (#1, #2…); the app keeps the matching ids. */

const MEAL_IDS = MEALS.map((m) => m.id);
const mealLabel = (id) => MEALS.find((m) => m.id === id)?.label || id;
const r = Math.round;
const fmt = (n) => r(n).toLocaleString();
const LIMIT = { kcal: 20000, protein: 2000, carbs: 2000, fat: 2000 }; // the food_entries checks
const MACROS = ["protein", "carbs", "fat"];

/** Today's entries in the order Tank sees them, oldest first. Entry n is "#n". */
export const todaysEntries = (entries) =>
  entries.filter((e) => e.date === today()).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));

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

/**
 * Checks Tank's proposed edits against today's log. Returns { ops, lines, errors }: ops are what
 * Apply does (by entry id, so they survive the list reordering), lines say it in words for the
 * card, errors say what was skipped and why.
 */
export function previewFoodEdits(entries, edits) {
  const day = todaysEntries(entries);
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
      const row = { date: today(), meal, name, amount: 1, unit: "serving", kcal: n.kcal, protein: n.protein ?? 0, carbs: n.carbs ?? 0, fat: n.fat ?? 0, source: "quick" };
      ops.push({ type: "add", row });
      lines.push(`Add to ${mealLabel(meal)}: ${name}, ${macroLine(row)}`);
      continue;
    }

    const ref = Number(e?.entry);
    const entry = Number.isInteger(ref) ? day[ref - 1] : undefined;
    if (!entry) { errors.push(`There's no entry #${e?.entry} today.`); continue; }
    if (touched.has(entry.id)) { errors.push(`${entry.name} was already changed above.`); continue; }
    touched.add(entry.id);

    if (action === "remove") {
      ops.push({ type: "remove", entry });
      lines.push(`Remove ${entry.name} from ${mealLabel(entry.meal)} (${fmt(entry.kcal)} kcal)`);
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
    } else if (op.type === "remove" && live.has(op.entry.id)) {
      const { created_at, updated_at, ...rest } = live.get(op.entry.id); // eslint-disable-line no-unused-vars
      food.removeEntry(op.entry.id);
      undo.push(() => food.addEntry(rest));
    }
  }
  return undo.length ? () => undo.reverse().forEach((f) => f()) : null;
}
