import { createClient } from "@supabase/supabase-js";

/* Food search for the Nutrition tab. Runs as a Vercel Function so the USDA key stays on the server.
   GET /api/food?q=chicken breast  -> everyday foods (USDA FoodData Central) then packaged ones (Open Food Facts)
   GET /api/food?barcode=0123...   -> one packaged food by barcode (Open Food Facts, then USDA Branded Foods)
   Every result has one shape: { id, source: "usda" | "off", ref, name, brand, basis }, where basis is
   { per100: { kcal, protein, carbs, fat }, portions: [{ label, grams }], barcode? } (see src/lib/nutrition.js).
   A packaged food's barcode rides in its basis, so the app can find it again on the next scan.
   Both databases are free. USDA's key comes from FDC_API_KEY; without it the shared DEMO_KEY works
   but is rate limited, so set a real one (free at https://fdc.nal.usda.gov/api-key-signup). */

const FDC_KEY = process.env.FDC_API_KEY || "DEMO_KEY";
const UA = "GymBuddy/1.0 (https://github.com/ndroidappple/ironlog)"; // Open Food Facts asks apps to identify themselves
const TIMEOUT_MS = 6000;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const num = (v) => (v == null || v === "" || !Number.isFinite(+v) ? null : +v);
const r1 = (v) => Math.round(v * 10) / 10;
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
/** "CHICKEN BREAST, ROASTED" -> "Chicken breast, roasted" (USDA names are often shouted). */
const tidy = (s) => { const t = clean(s); return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t; };

async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw Object.assign(new Error(`${res.status} from ${new URL(url).host}`), { status: res.status });
  return res.json();
}

/* ── USDA FoodData Central ── */
const NUTRIENT = { kcal: [1008, 2047, 2048], protein: [1003], carbs: [1005], fat: [1004] };
export function fromUsda(f) {
  const val = (ids) => {
    for (const id of ids) {
      const n = (f.foodNutrients || []).find((x) => x.nutrientId === id && (id !== 1008 || !x.unitName || /kcal/i.test(x.unitName)));
      if (n && num(n.value) != null) return num(n.value);
    }
    return null;
  };
  const kcal = val(NUTRIENT.kcal);
  if (kcal == null) return null;
  const portions = [];
  // Branded foods: the label serving. Everyday foods: household measures ("1 cup", "1 large").
  if (num(f.servingSize) > 0 && /^(g|gm|grm|grams?)$/i.test(f.servingSizeUnit || "")) {
    const g = r1(+f.servingSize);
    portions.push({ label: f.householdServingFullText ? `${clean(f.householdServingFullText)} (${g} g)` : `serving (${g} g)`, grams: g });
  }
  for (const m of f.foodMeasures || []) {
    const g = num(m.gramWeight);
    const text = clean(m.disseminationText);
    if (!g || !text || /quantity not specified/i.test(text) || portions.length >= 6) continue;
    const label = `${text} (${r1(g)} g)`;
    if (!portions.some((p) => p.label === label)) portions.push({ label, grams: r1(g) });
  }
  return {
    id: `usda:${f.fdcId}`, source: "usda", ref: String(f.fdcId),
    name: tidy(f.description), brand: clean(f.brandName || f.brandOwner) || null,
    basis: { per100: { kcal: Math.round(kcal), protein: r1(val(NUTRIENT.protein) || 0), carbs: r1(val(NUTRIENT.carbs) || 0), fat: r1(val(NUTRIENT.fat) || 0) }, portions,
      ...(f.gtinUpc ? { barcode: String(f.gtinUpc).replace(/\D/g, "") } : {}) },
  };
}
async function searchUsda(q) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(FDC_KEY)}&query=${encodeURIComponent(q)}`
    + `&pageSize=15&dataType=${encodeURIComponent("Foundation,SR Legacy,Survey (FNDDS)")}`;
  const data = await getJSON(url);
  return (data.foods || []).map(fromUsda).filter(Boolean);
}

/* ── Open Food Facts ── */
const OFF_FIELDS = "code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity";
export function fromOff(p) {
  const n = p.nutriments || {};
  let kcal = num(n["energy-kcal_100g"]);
  if (kcal == null && num(n.energy_100g) != null) kcal = num(n.energy_100g) / 4.184; // kJ only
  const name = clean(p.product_name_en || p.product_name);
  if (kcal == null || !name || !p.code) return null;
  const brand = clean(Array.isArray(p.brands) ? p.brands[0] : String(p.brands || "").split(",")[0]) || null;
  const g = num(p.serving_quantity);
  const portions = g > 0 ? [{ label: p.serving_size ? `serving (${clean(p.serving_size)})` : `serving (${r1(g)} g)`, grams: r1(g) }] : [];
  return {
    id: `off:${p.code}`, source: "off", ref: String(p.code), name, brand,
    basis: { per100: { kcal: Math.round(kcal), protein: r1(num(n.proteins_100g) || 0), carbs: r1(num(n.carbohydrates_100g) || 0), fat: r1(num(n.fat_100g) || 0) }, portions, barcode: String(p.code) },
  };
}
async function searchOff(q) {
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=15&langs=en&fields=${OFF_FIELDS}`;
  const data = await getJSON(url);
  return (data.hits || []).map(fromOff).filter(Boolean);
}
/** The forms a barcode may be filed under: as scanned, a UPC-A without its leading 0, and the
    14-digit GTIN (USDA stores some labels that way and its search only matches the exact string). */
export const barcodeForms = (code) => [...new Set([code, code.length === 13 && code[0] === "0" ? code.slice(1) : null, code.padStart(14, "0")].filter(Boolean))];
async function offByBarcode(code) {
  let data;
  try {
    // Open Food Facts files a UPC-A under either form, so one request covers both.
    data = await getJSON(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  } catch (e) {
    if (e.status === 404) return []; // its "no such product"
    throw e;
  }
  const hit = data.status === 1 && data.product ? fromOff({ ...data.product, code }) : null;
  return hit ? [hit] : [];
}
/* USDA's Branded Foods (labels US manufacturers submit) fills gaps in Open Food Facts, store brands
   especially. Its search matches a GTIN only as stored, so it's asked for every form of the code
   at once (any word may match); only a record
   whose GTIN is this barcode counts. */
async function usdaByBarcode(code) {
  const forms = barcodeForms(code);
  const bare = new Set(forms.map((c) => c.replace(/^0+/, "")));
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(FDC_KEY)}&query=${encodeURIComponent(forms.join(" "))}&pageSize=10&dataType=Branded`;
  const data = await getJSON(url);
  // Newest label first: a product reformulated over the years has one record per submission.
  const foods = (data.foods || []).filter((f) => bare.has(String(f.gtinUpc || "").replace(/\D/g, "").replace(/^0+/, "")))
    .sort((a, b) => String(b.publishedDate || "").localeCompare(String(a.publishedDate || "")));
  const hit = foods.map(fromUsda).find(Boolean);
  return hit ? [hit] : [];
}

/** How well a food's name answers the search: the whole phrase at the start beats it as a word,
    which beats only some of the words; long names (a yogurt that's "chai latte" flavored) sink. */
export function relevance(name, q) {
  const n = clean(name).toLowerCase(), phrase = clean(q).toLowerCase();
  const words = phrase.split(" ").filter(Boolean);
  if (!words.length) return 0;
  const at = (w) => n.split(/[^\p{L}\p{N}]+/u).includes(w) ? 1 : n.includes(w) ? 0.5 : 0; // a whole word, or inside one
  let s = (words.reduce((a, w) => a + at(w), 0) / words.length) * 2;
  if (n.startsWith(phrase)) s += 3;
  else if (new RegExp(`(^|[^\\p{L}\\p{N}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(n)) s += 2;
  return s - Math.min(2, n.length / 40);
}

/** One of each name + brand, best matches first; within a match, everyday foods before packaged. */
export function combine(usda, off, q = "") {
  const seen = new Set();
  return [...usda, ...off].filter((f) => {
    const k = `${f.name}|${f.brand || ""}`.toLowerCase();
    return !seen.has(k) && seen.add(k);
  }).map((f, i) => ({ f, i, r: relevance(f.name, q) }))
    .sort((a, b) => b.r - a.r || a.i - b.i).map((x) => x.f).slice(0, 30);
}

export async function GET(request) {
  if (!supabase) return Response.json({ error: "Food search isn't configured." }, { status: 500 });
  const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
  const { data } = token ? await supabase.auth.getUser(token) : { data: null };
  if (!data?.user) return Response.json({ error: "Sign in to search foods." }, { status: 401 });

  const url = new URL(request.url);
  const q = clean(url.searchParams.get("q")).slice(0, 80);
  const barcode = (url.searchParams.get("barcode") || "").replace(/\D/g, "").slice(0, 14);
  if (!q && !barcode) return Response.json({ error: "Search for a food." }, { status: 400 });

  // Either database may be slow or down; results from the other still come back.
  const [usda, off] = await Promise.allSettled(barcode ? [usdaByBarcode(barcode), offByBarcode(barcode)] : [searchUsda(q), searchOff(q)]);
  for (const [name, r] of [["usda", usda], ["off", off]]) if (r.status === "rejected") console.warn(`food search: ${name} failed`, r.reason?.message);
  const u = usda.status === "fulfilled" ? usda.value : [], o = off.status === "fulfilled" ? off.value : [];
  // A barcode is one product: Open Food Facts' entry first (it has the label serving more often), else USDA's.
  const results = barcode ? [...o, ...u].slice(0, 1) : combine(u, o, q);
  // `partial` matters most for a barcode: no result while one database failed isn't a real "not found".
  const failed = usda.status === "rejected" && off.status === "rejected";
  return Response.json({ results, partial: !failed && (usda.status === "rejected" || off.status === "rejected") }, { status: failed ? 502 : 200, headers: { "cache-control": "no-store" } });
}
