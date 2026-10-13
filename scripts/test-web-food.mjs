/* Checks Tank's web-search fallback for products the label databases don't have (api/_webFood.js):
   what the search returns is only trusted with complete numbers that add up and a source, and a
   failed search is "not found", never an error. Runs offline with a scripted model.
   Run: npm run test:food   (exits 1 on any failure) */
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { checkFacts, searchFoodWeb } from "../api/_webFood.js";

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

const good = '{"found": true, "product": "Ratio ProFiber Yogurt, Strawberry", "serving": "1 cup (150 g)", "grams": 150, "kcal": 180, "protein": 25, "carbs": 15, "fat": 3, "source": "https://www.ratiofood.com/products/profiber"}';
eq("good facts pass, source trimmed to the site", checkFacts(good), { found: true, product: "Ratio ProFiber Yogurt, Strawberry", serving: "1 cup (150 g)", grams: 150, kcal: 180, protein: 25, carbs: 15, fat: 3, source: "ratiofood.com" });
eq("JSON wrapped in prose still reads", checkFacts(`Here you go:\n${good}\n`).found, true);
eq("not found", checkFacts('{"found": false}').found, false);
eq("not JSON", checkFacts("I couldn't find it.").found, false);
eq("missing a macro", checkFacts('{"found": true, "kcal": 180, "protein": 25, "carbs": 15, "source": "x.com"}').found, false);
eq("calories that don't fit the macros", checkFacts('{"found": true, "kcal": 450, "protein": 25, "carbs": 15, "fat": 3, "source": "x.com"}').found, false);
eq("fiber-heavy label a little under the macros is fine", checkFacts('{"found": true, "kcal": 150, "protein": 25, "carbs": 15, "fat": 3, "source": "x.com"}').found, true);
eq("no source at all", checkFacts('{"found": true, "kcal": 180, "protein": 25, "carbs": 15, "fat": 3}').found, false);
eq("source from the grounding when the model gave none",
  checkFacts('{"found": true, "kcal": 180, "protein": 25, "carbs": 15, "fat": 3}', [{ url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "target.com" }]).source, "target.com");

// The whole call, with a scripted model standing in for Gemini + Google Search.
const usage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } };
let toolsSent = null;
const model = new MockLanguageModelV4({ doGenerate: async (opts) => {
  toolsSent = (opts.tools || []).map((t) => t.type === "provider" ? t.id : t.name);
  return { content: [{ type: "text", text: good }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
} });
const r = await searchFoodWeb("Ratio ProFiber yogurt strawberry", { model });
eq("search result", [r.found, r.kcal, r.source], [true, 180, "ratiofood.com"]);
eq("Google Search is the only tool sent", toolsSent, ["google.google_search"]);

const broken = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("gateway down"); } });
eq("a failed search is not found, not an error", (await searchFoodWeb("anything", { model: broken })).found, false);
eq("an empty query isn't searched", (await searchFoodWeb("  ")).found, false);

console.log(failed ? `web food: ${failed} failed` : "web food: all checks passed");
process.exit(failed ? 1 : 0);
