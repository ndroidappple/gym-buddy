import { today } from "./util.js";

/* ── Your foods ──
   One list of everything you eat: saved foods and what you've logged (the app keeps 120 days),
   once each. Ranked by how often and how lately you've had it, each log counting half as much
   every two weeks, and three times as much when it was at the meal you're adding to, so a
   breakfast you have twice outranks a lunch you have five times when you're adding breakfast. */
const SAME_MEAL = 3;
const HALF_LIFE_DAYS = 14;
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const nameKey = (x) => `${norm(x.name)}|${norm(x.brand)}`;
const DAY = 86400000;

/**
 * Your foods, best first, for the meal being added to. Each item: { key, name, brand, saved, last,
 * count, usual, lastDate, kcal, score }. `saved` is the saved food (or null), `last` the latest log
 * of it (or null), `usual` the meal it's mostly had at (when that's clear), `kcal` its usual portion.
 */
export function yourFoods(entries, foods, { meal = null, now = Date.now() } = {}) {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const byName = new Map();
  for (const f of foods) byName.set(nameKey(f), [...(byName.get(nameKey(f)) || []), f]);
  const items = new Map();
  const item = (key, saved = null) => {
    if (!items.has(key)) items.set(key, { key, saved, last: null, count: 0, meals: {}, score: 0, lastAt: 0 });
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
    it.score += 0.5 ** (Math.max(0, now - day) / DAY / HALF_LIFE_DAYS) * (meal && e.meal === meal ? SAME_MEAL : 1);
    const at = day + (Date.parse(e.created_at) || 0) / 1e13; // same day: the later log wins
    if (at > it.lastAt) { it.lastAt = at; it.last = e; }
  }
  return [...items.values()].map((it) => {
    const [top, n] = Object.entries(it.meals).sort((a, b) => b[1] - a[1])[0] || [];
    const s = it.saved?.basis?.perServing;
    return {
      key: it.key, saved: it.saved, last: it.last, count: it.count, score: it.score,
      name: it.saved?.name ?? it.last.name, brand: it.saved ? it.saved.brand || null : it.last.brand || null,
      usual: it.count >= 2 && n / it.count >= 0.6 ? top : null,
      lastDate: it.last?.date || null,
      kcal: it.last ? +it.last.kcal : s ? +s.kcal : null,
      created: it.saved?.created_at || "",
    };
  }).sort((a, b) => b.score - a.score || (b.lastDate || "").localeCompare(a.lastDate || "") || b.created.localeCompare(a.created));
}

/** Whether a food matches what's typed: every word, anywhere in its name or brand. */
export const matchesQuery = (x, q) => { const hay = `${norm(x.name)} ${norm(x.brand)}`; return norm(q).split(" ").every((w) => hay.includes(w)); };

/**
 * What logging one of your foods starts from: the food (saved, or as last logged) and the amount
 * you had last time. A log with no nutrition basis (a quick add) gets one from its own numbers.
 */
export function pickYourFood(it) {
  const e = it.last;
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
