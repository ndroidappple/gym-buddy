import { generateText } from "ai";
import { google } from "@ai-sdk/google";

/* Tank's last resort for a named product the label databases don't have: a Google search, read by
   Gemini, for the product's own nutrition facts. It runs as its own small model call because Gemini
   2.5 won't reliably mix Google Search with Tank's own tools (log_meal and the rest) in one request.
   Google Search through AI Gateway is covered by the free credit with Gemini models.

   What comes back is checked before Tank sees it: numbers for one stated serving, calories that fit
   the macros, and where they came from. Anything short of that is "not found", and Tank estimates. */

const MODEL = "google/gemini-2.5-flash";
const TIMEOUT_MS = 15000;

const INSTRUCTIONS = [
  "Find the nutrition facts for the food product named below, using Google Search.",
  "Use only numbers a page states for this exact product (same brand, product line, and flavor or size when they differ): the maker's own site first, then a retailer's product page or a nutrition database that shows the label. Ignore recipes, forum posts, and other products.",
  "Reply with one line of JSON and nothing else:",
  "{\"found\": true, \"product\": \"Brand Product, Flavor\", \"serving\": \"1 cup (150 g)\", \"grams\": 150, \"kcal\": 0, \"protein\": 0, \"carbs\": 0, \"fat\": 0, \"source\": \"site.com\"}",
  "Numbers are per that one serving, as the label states them; grams only if the label gives a weight. If no page states this product's calories and macros, reply {\"found\": false}.",
].join("\n");

const num = (v) => (v == null || v === "" || !Number.isFinite(+v) || +v < 0 ? null : +v);
const r1 = (v) => Math.round(v * 10) / 10;

/** The model's JSON line, checked. Returns the facts, or { found: false, reason }. */
export function checkFacts(text, sources = []) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  let j;
  try { j = m ? JSON.parse(m[0]) : null; } catch { j = null; }
  if (!j || j.found !== true) return { found: false, reason: "No page states this product's nutrition facts." };
  const kcal = num(j.kcal), protein = num(j.protein), carbs = num(j.carbs), fat = num(j.fat);
  if ([kcal, protein, carbs, fat].some((x) => x == null) || kcal > 3000) return { found: false, reason: "The search didn't give complete numbers." };
  // Calories should fit the macros (4/4/9). Fiber and sugar alcohols count less than 4, so labels
  // can come in under; well over or under means a misread (per 100 g mixed with per serving, say).
  const worked = protein * 4 + carbs * 4 + fat * 9;
  if (worked > 0 && Math.abs(kcal - worked) > Math.max(30, worked * 0.25)) return { found: false, reason: "The numbers found don't add up, so they aren't trusted." };
  // Where it came from: the model's own word, else the first grounding source's site.
  const site = (s) => String(s || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0].toLowerCase();
  const grounded = sources.map((s) => site(s.title && /\./.test(s.title) ? s.title : s.url)).filter((d) => d && !/googleapis|vertexaisearch|google\.com$/.test(d));
  const source = site(j.source) || grounded[0] || null;
  if (!source) return { found: false, reason: "No source page for the numbers." };
  return {
    found: true,
    product: String(j.product || "").trim().slice(0, 80) || null,
    serving: String(j.serving || "1 serving").trim().slice(0, 40),
    ...(num(j.grams) > 0 ? { grams: r1(+j.grams) } : {}),
    kcal: Math.round(kcal), protein: r1(protein), carbs: r1(carbs), fat: r1(fat),
    source,
  };
}

/** Searches the web for a product's nutrition facts. Never throws: a failure is "not found". */
export async function searchFoodWeb(query, { model = MODEL } = {}) {
  const q = String(query || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!q) return { found: false, reason: "Nothing to search for." };
  try {
    const { text, sources } = await generateText({
      model,
      instructions: INSTRUCTIONS,
      prompt: `Product: ${q}`,
      tools: { google_search: google.tools.googleSearch({}) },
      maxOutputTokens: 1500,
      reasoning: "low",
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const facts = checkFacts(text, sources || []);
    console.log("tank web search", JSON.stringify({ q, found: facts.found, source: facts.source ?? null, reason: facts.reason ?? null }));
    return facts;
  } catch (e) {
    console.warn("tank web search failed", e?.statusCode ?? "", e?.message ?? e);
    return { found: false, reason: "The web search didn't go through." };
  }
}
