/* What's typed in Add food's search box, read on the phone (instantly, no AI): a search for one food,
   an amount and a food ("200g chicken breast", "2 eggs"), or a meal described in words ("2 eggs, toast
   and a latte"), which is the head coach's job. The box does all three: your foods first, then the food
   databases, and the coach steps up when it reads as a description. Nothing goes to the coach until
   the lifter sends it. */

const FRACTIONS = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 };
/* Units, as typed → as a food's portion labels or the app's own units name them. */
const UNITS = [
  [/^(g|gr|grams?)$/, "g"], [/^(oz|ounces?)$/, "oz"], [/^(kg|kilos?)$/, "kg"], [/^(lbs?|pounds?)$/, "lb"],
  [/^(ml|milliliters?)$/, "ml"], [/^cups?$/, "cup"], [/^(tbsps?|tablespoons?|tbs)$/, "tbsp"], [/^(tsps?|teaspoons?)$/, "tsp"],
  [/^slices?$/, "slice"], [/^scoops?$/, "scoop"], [/^(servings?|portions?)$/, "serving"], [/^(pieces?|pcs?)$/, "piece"],
  [/^(large|medium|small)$/, "size"], [/^(bars?|cans?|bottles?|packets?|bags?|bowls?|plates?|handfuls?)$/, "count"],
];
const EATING = /\b(i\s+(had|ate|drank)|for\s+(breakfast|lunch|dinner)|from\s+[a-z])/i;
const SEPARATOR = /,|\+|\band\b|\bwith\b|\bw\/|&|;/i;
const QUANTITY = /(^|\s)(\d+([.,]\d+)?|[½¼¾⅓⅔⅛]|\d+\/\d+)\s*[a-z]*/gi;

const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();

function number(tok) {
  if (FRACTIONS[tok] != null) return FRACTIONS[tok];
  if (/^\d+\/\d+$/.test(tok)) { const [a, b] = tok.split("/").map(Number); return b ? a / b : null; }
  if (/^\d+([.,]\d+)?$/.test(tok)) return +tok.replace(",", ".");
  return WORD_NUM[tok] ?? null;
}

/**
 * Reads the box. Returns { kind, text, food, amount, unit }:
 *  - "empty"    nothing typed
 *  - "search"   look a food up (food = the words to search)
 *  - "amount"   one food with an amount: food = the food's words, amount and unit (unit null for a
 *               plain count, "2 eggs") to start its portion at
 *  - "describe" a meal in words, for the coach
 * `known`: whether it matches one of the lifter's own foods by name; a name like "Chicken & Rice Bowl"
 * reads like a list, but it's a search for that food.
 */
export function readQuery(raw, { known = false } = {}) {
  const text = String(raw || "").trim();
  const t = norm(text).replace(/([\d½¼¾⅓⅔⅛])([a-z])/g, "$1 $2"); // "200g" -> "200 g"
  if (!t) return { kind: "empty", text, food: "", amount: null, unit: null };
  const words = t.split(" ");
  const quantities = (t.match(QUANTITY) || []).length;
  const listy = SEPARATOR.test(t);

  // One food, led by an amount: "200 g chicken breast", "2 eggs", "1.5 cups rice", "half a bagel".
  if (!listy && words.length <= 6) {
    let i = 0, amount = number(words[0]);
    if (amount != null) {
      i = 1;
      if (words[0] === "half" && ["a", "an"].includes(words[1])) i = 2;
      let unit = null;
      const u = words[i] && UNITS.find(([re]) => re.test(words[i]));
      if (u) { unit = u[1] === "count" ? null : u[1] === "size" ? words[i] : u[1]; i++; }
      if (words[i] === "of") i++;
      const food = words.slice(i).join(" ");
      if (food && words.length - i <= 4) return { kind: "amount", text, food, amount, unit };
    }
  }

  const describes = !known && (
    EATING.test(t) || quantities >= 2 || (listy && (quantities >= 1 || words.length >= 4)) || words.length >= 7
  );
  return { kind: describes ? "describe" : "search", text, food: t, amount: null, unit: null };
}

/* ── Matching the lifter's own foods ──
   Forgiving, since it's their own short list: every typed word has to be found in the name or brand:
   the start of a word, anywhere in one (4+ letters), a plural or singular of one, or one letter off or
   two swapped (5+ letters). */

const singular = (w) => w.replace(/(ies)$/, "y").replace(/(ches|shes|sses|xes|oes)$/, (m) => m.slice(0, -2)).replace(/s$/, "");
function oneOff(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  // Two neighbours swapped ("protien") is one slip of the thumb.
  if (a.length === b.length) {
    const d = [...a].map((c, k) => (c !== b[k] ? k : -1)).filter((k) => k >= 0);
    if (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]) return true;
  }
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * How well `q` matches a food { name, brand }: 0 when it doesn't, higher for better. A name that starts
 * with what's typed beats one that has all the words, which beats a forgiving match.
 */
export function matchScore(x, q) {
  // Words only: "&", "-" and the like say nothing about which food it is.
  const query = norm(q).replace(/[^a-z0-9%\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!query) return 1;
  const name = norm(x.name).replace(/[^a-z0-9%\s]/g, " ").replace(/\s+/g, " "), hay = `${name} ${norm(x.brand)}`.trim();
  const hayWords = hay.split(/[^a-z0-9%]+/).filter(Boolean);
  let exact = 0;
  for (const w of query.split(" ").filter(Boolean)) {
    if (hayWords.some((h) => h.startsWith(w)) || (w.length >= 4 && hay.includes(w))) { exact++; continue; }
    const s = singular(w);
    const hit = hayWords.some((h) => singular(h) === s || (w.length >= 5 && h.length >= 4 && oneOff(singular(h), s)));
    if (!hit) return 0;
  }
  return name.startsWith(query) ? 3 : exact === query.split(" ").filter(Boolean).length ? 2 : 1;
}

/**
 * Where a food's portion starts for what was typed: { amount, unit } in one of the food's own units
 * ("1.5 cups" → 1.5 × "1 cup (240 g)", "1 kg" → 1000 g), or { amount } alone for a plain count
 * ("2 eggs": two of its usual portion). Null when the food has no unit like the one typed.
 */
export function portionFor(units, amount, unit) {
  if (amount == null) return null;
  if (!unit) return { amount };
  const has = (label) => units.some((u) => u.label === label);
  if (unit === "kg" && has("g")) return { amount: amount * 1000, unit: "g" };
  if (unit === "lb" && has("oz")) return { amount: amount * 16, unit: "oz" };
  if (has(unit)) return { amount, unit };
  const match = units.find((u) => new RegExp(`\\b${unit}s?\\b`, "i").test(u.label));
  return match ? { amount, unit: match.label } : null;
}

/* ── A described meal, item by item ──
   "2 eggs, toast with butter and a latte" → 2 eggs · toast · butter · latte, each with its amount when
   one was given. Shown as chips under the box while typing, so the lifter sees it was understood, and
   matched against their own foods so the coach uses their numbers for those. */

const ITEM_SPLIT = /\s*(?:,|;|\+|&|\band\b|\bwith\b|\bw\/|\bplus\b)\s*/i;
const LEAD = /^(i\s+(had|ate|drank)|for\s+(breakfast|lunch|dinner)\s*,?|some|a\s+bit\s+of)\s+/i;
const OWNER = /^(an?|the|my|our|my\s+usual|usual|my\s+regular)\s+/i; // "my protein latte" is their Protein Latte
const TAIL = /\s+(for|at)\s+(breakfast|lunch|dinner|supper|a\s+snack|snack|brunch)$/i; // "chips for lunch" is chips

/** The items of a described meal: [{ text, amount, unit, food }]. Amount and unit null when none was given. */
export function mealItems(raw) {
  return String(raw || "").split(ITEM_SPLIT).map((x) => x.trim().replace(LEAD, "").replace(OWNER, "").replace(TAIL, "").trim())
    .filter((x) => /[a-z]/i.test(x)).slice(0, 12).map((text) => {
      const r = readQuery(text);
      return r.kind === "amount" ? { text, amount: r.amount, unit: r.unit, food: r.food } : { text, amount: null, unit: null, food: norm(text) };
    });
}
