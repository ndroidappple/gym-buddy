/* End-to-end checks: the real app in a phone-sized Chromium, signed in, tapped through like a lifter
   would, against a fake Supabase and /api (scripts/e2e/). Nothing reaches the real account.
   Run: npm run test:e2e   (exits 1 on any failure; a failing test's screenshot goes to e2e-failures/)
   Needs a Chromium; set CHROMIUM_PATH if it isn't at /opt/pw-browsers/chromium. */
import { mkdirSync } from "node:fs";
import { startApp, launch, openApp } from "./e2e/app.mjs";
import { account, SEARCH_RESULT, workout, day, entry, reviews } from "./e2e/fixtures.mjs";

const only = process.argv[2]; // a test's name, or part of it, to run just that one
const tests = [];
const test = (name, fn, seed = account()) => tests.push({ name, fn, seed }); // seed: the account it signs in to
const check = (what, ok, detail = "") => { if (!ok) throw new Error(`${what}${detail ? `\n    ${detail}` : ""}`); };

// What the app's /api functions answer in every test.
const apis = (seen) => ({
  "/api/food": (url) => { seen?.push(url.searchParams.get("q")); return { results: /smoothie/i.test(url.searchParams.get("q")) ? [SEARCH_RESULT] : [] }; },
  "/api/review": () => ({}), // no week in review written (the app says to try again later)
});

/** Nutrition, then Add on a meal: the add-food sheet, open. */
async function openAddFood(page, meal = "Breakfast") {
  await page.goto(new URL("#/nutrition", page.url()).href);
  await page.getByRole("button", { name: `Add food to ${meal}` }).click();
  await page.getByRole("dialog").getByRole("heading", { name: `Add to ${meal}` }).waitFor();
}

test("add food: Back from 'How much?' keeps the search as it was", async ({ page }, seen) => {
  await openAddFood(page);
  const box = page.getByRole("searchbox", { name: /search foods/i });
  await box.fill("smoothie");
  const dbRow = page.getByRole("button", { name: /Strawberry smoothie/ });
  await dbRow.waitFor();

  await page.getByRole("button", { name: /^Banana Berry Smoothie/ }).click();
  await page.getByRole("heading", { name: "How much?" }).waitFor();
  check("the portion step shows the food", await page.getByText("Banana Berry Smoothie", { exact: true }).filter({ visible: true }).count() === 1);

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("heading", { name: "Add to Breakfast" }).waitFor();
  check("what was typed is still in the box", (await box.inputValue()) === "smoothie", `got "${await box.inputValue()}"`);
  check("the database results are still there", await dbRow.isVisible());
  check("the search wasn't run again", seen.filter((q) => q === "smoothie").length === 1, `searched ${JSON.stringify(seen)}`);
});

test("add food: a saved food is logged and reaches the account", async ({ page, backend }) => {
  await openAddFood(page, "Lunch");
  await page.getByRole("searchbox", { name: /search foods/i }).fill("banana");
  await page.getByRole("button", { name: /^Banana Berry Smoothie/ }).click();
  await page.getByRole("button", { name: "Add to Lunch" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  check("the meal shows the food", await page.getByText("Banana Berry Smoothie").first().isVisible());
  // The outbox sends it on; give it a moment.
  for (let i = 0; i < 20 && !backend.tables.food_entries.length; i++) await page.waitForTimeout(100);
  const row = backend.tables.food_entries[0];
  check("one entry saved to the account", backend.tables.food_entries.length === 1, JSON.stringify(backend.tables.food_entries));
  check("saved to lunch with the food's numbers", row.meal === "lunch" && row.name === "Banana Berry Smoothie" && Math.round(row.kcal) === 421, JSON.stringify(row));
});

// Meal prep: last night's dinner, ready to log again at lunch.
test("add food: last night's dinner is one tap at lunch", async ({ page, backend }) => {
  await openAddFood(page, "Lunch");
  const repeat = page.getByRole("button", { name: /Yesterday's dinner/ });
  check("leftovers row first, above yesterday's lunch", (await page.locator(".food-repeat .name").allTextContents()).join(" | ") === "Yesterday's dinnerSteak Pico Rice Bowl | Yesterday's lunchBlackened Chicken",
    (await page.locator(".food-repeat .name").allTextContents()).join(" | "));
  check("the bowl leads your foods", (await page.getByRole("dialog").locator(".food-row .name").first().textContent()).startsWith("Steak Pico Rice Bowl"));
  await repeat.click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  for (let i = 0; i < 20 && !backend.tables.food_entries.some((e) => e.date === day(0) && e.meal === "lunch"); i++) await page.waitForTimeout(100);
  const logged = backend.tables.food_entries.filter((e) => e.date === day(0) && e.meal === "lunch");
  check("logged once, at lunch today", logged.length === 1 && logged[0].meal === "lunch" && logged[0].name === "Steak Pico Rice Bowl", JSON.stringify(logged));
}, account({ entries: [
  ...[0, 1, 2, 3].map((d) => entry("Protein Latte", "breakfast", -d, { kcal: 130 })),
  entry("Blackened Chicken", "lunch", -1, { created_at: `${day(-1)}T17:00:00Z` }),
  entry("Steak Pico Rice Bowl", "dinner", -1, { created_at: `${day(-1)}T23:30:00Z` }),
] }));

test("add food: + logs at once, and the sheet stays open for more", async ({ page, backend }) => {
  await openAddFood(page, "Lunch");
  const dialog = page.getByRole("dialog");
  const order = async () => (await dialog.locator(".food-row .name").allTextContents()).join(" | ");
  const before = await order();
  await dialog.getByRole("button", { name: "Add Banana Berry Smoothie" }).click();
  const tray = dialog.locator(".food-tray");
  await tray.getByText("1 added · 421 kcal").waitFor();
  check("the list stays put under the next tap", (await order()) === before, `${before}\n    now ${await order()}`);
  await dialog.getByRole("button", { name: "Add Oatmeal with chia" }).click();
  await tray.getByText("2 added · 943 kcal").waitFor();
  await tray.getByRole("button", { name: "Undo" }).click();
  await tray.getByText("1 added · 421 kcal").waitFor();
  await tray.getByRole("button", { name: "Done" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.locator(".toast", { hasText: "Banana Berry Smoothie added to Lunch" }).waitFor();
  for (let i = 0; i < 20 && backend.tables.food_entries.length !== 1; i++) await page.waitForTimeout(100);
  check("only the one left in the tray reaches the account", backend.tables.food_entries.length === 1 && backend.tables.food_entries[0].name === "Banana Berry Smoothie"
    && backend.tables.food_entries[0].meal === "lunch", JSON.stringify(backend.tables.food_entries.map((e) => [e.name, e.meal])));
});

test("nutrition: hold a food for its options", async ({ page, backend }) => {
  await page.goto(new URL("#/nutrition", page.url()).href);
  const row = page.getByRole("button", { name: /^Protein Latte/ });
  const lattes = (meal = "breakfast") => backend.tables.food_entries.filter((e) => e.name === "Protein Latte" && e.date === day(0) && e.meal === meal).length;
  const hold = async () => {
    const box = await row.first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    return page.getByRole("dialog", { name: "Protein Latte" });
  };
  let options = await hold();
  await options.waitFor();
  check("a hold doesn't log anything", backend.tables.food_entries.length === 1, String(backend.tables.food_entries.length));
  check("no edit form behind it", !(await page.getByRole("dialog", { name: "Edit food" }).count()));
  await options.getByRole("button", { name: "Duplicate" }).click();
  await page.locator(".toast", { hasText: "Protein Latte duplicated" }).waitFor();
  for (let i = 0; i < 20 && lattes() < 2; i++) await page.waitForTimeout(100);
  check("two lattes at breakfast", lattes() === 2, String(lattes()));
  // Move one to snacks.
  options = await hold();
  await options.getByRole("button", { name: "Snacks" }).click();
  await page.locator(".toast", { hasText: "Protein Latte moved to Snacks" }).waitFor();
  for (let i = 0; i < 20 && lattes("snacks") < 1; i++) await page.waitForTimeout(100);
  check("one at breakfast, one at snacks", lattes() === 1 && lattes("snacks") === 1, `${lattes()} / ${lattes("snacks")}`);
  // Edit from the options opens the edit sheet.
  options = await hold();
  await options.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog", { name: "Edit food" }).waitFor();
}, account({ entries: [entry("Protein Latte", "breakfast", 0, { kcal: 130 })] }));

// See all on Progress: the sheet opens with every review on its first frame, not growing once the account answers.
const withReviews = account();
withReviews.tables.storage_kv.push(...reviews(7));
test("progress: See all opens with every past review at once", async ({ page }) => {
  await page.goto(new URL("#/progress", page.url()).href);
  await page.getByRole("button", { name: "See all" }).waitFor();
  // A slow account from here on: anything the sheet waits for shows up as missing rows.
  await page.route("**/rest/v1/storage_kv**", async (r) => { await new Promise((ok) => setTimeout(ok, 1500)); await r.fallback(); });
  await page.getByRole("button", { name: "See all" }).click();
  const sheet = page.getByRole("dialog", { name: "Past reviews" });
  await sheet.waitFor();
  const rows = await sheet.locator(".list-row").count();
  check("all 7 reviews on the first frame", rows === 7, `got ${rows}`);
}, withReviews);

/** Logs a saved food to a meal, through the add-food sheet. */
async function logFood(page, meal, food) {
  await openAddFood(page, meal);
  await page.getByRole("searchbox", { name: /search foods/i }).fill(food.split(" ")[0]);
  await page.getByRole("button", { name: new RegExp(`^${food}`) }).click();
  await page.getByRole("button", { name: `Add to ${meal}` }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
}

/** Two foods logged, then the first removed from its edit sheet: its Undo toast, showing. */
async function removeWithUndo(page) {
  await logFood(page, "Breakfast", "Banana Berry Smoothie");
  await logFood(page, "Lunch", "Oatmeal with chia");
  await page.getByRole("button", { name: /^Banana Berry Smoothie/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  const toast = page.locator(".toast", { hasText: "Banana Berry Smoothie removed" });
  await toast.waitFor();
  await page.waitForTimeout(800); // past the grace a toast gets for the move that raised it
  check("the toast stays while nothing else happens", await toast.isVisible());
  return toast;
}

test("toast: opening another food puts the Undo away", async ({ page }) => {
  const toast = await removeWithUndo(page);
  await page.getByRole("button", { name: /^Oatmeal with chia/ }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "Edit food" }).waitFor();
  await toast.waitFor({ state: "detached", timeout: 1000 }); // well before its own 5 s
});

test("toast: switching tabs puts the Undo away", async ({ page }) => {
  const toast = await removeWithUndo(page);
  await page.getByRole("button", { name: "Today" }).click();
  await toast.waitFor({ state: "detached", timeout: 1000 }); // well before its own 5 s
});

// Push last week, Pull since, Push again today: today's incline press beats last week's (one PR).
const trainedToday = account({ sessions: [
  workout("w1", "push", day(-7), { "Incline Barbell / Smith Press": [[135, 8]], "Flat DB Press": [[60, 10]] }),
  workout("w2", "pull", day(-3), { "Lat Pulldown (Wide Grip)": [[140, 10]] }),
  workout("w3", "push", day(0), { "Incline Barbell / Smith Press": [[145, 8], [145, 7]], "Flat DB Press": [[60, 9]] }),
] });

test("today: after a workout, Today recaps it instead of the next one", async ({ page }) => {
  await page.getByRole("heading", { level: 1 }).waitFor();
  const headline = await page.getByRole("heading", { level: 1 }).innerText();
  check("the headline says it's done", /^Push done.*Rest up\.$/.test(headline), `got "${headline}"`);
  const card = page.getByRole("region", { name: "Push done today" });
  check("the card is today's workout", await card.isVisible());
  for (const pill of ["2 lifts", "3 sets", "60 min", "1 PR"]) check(`the card shows ${pill}`, await card.getByText(pill, { exact: true }).isVisible());
  check("no Start lifting", !(await page.getByRole("link", { name: "Start lifting" }).count()));
  check("the next workout is a line below", await page.getByText("Up next: Legs").isVisible());
  await card.getByRole("link", { name: "See summary" }).click();
  await page.waitForURL(/#\/summary\/w3/);
}, trainedToday);

test("today: the next workout can still be started after one's done", async ({ page }) => {
  await page.getByRole("link", { name: "Start Legs anyway" }).click();
  await page.waitForURL(/#\/session\/legs/);
  await page.goBack();
  await page.getByRole("button", { name: "Change" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Legs/ }).click();
  await page.getByRole("link", { name: "Start lifting" }).waitFor();
  check("picking a day brings its card back", await page.getByRole("region", { name: "Up next: Legs" }).isVisible());
}, trainedToday);

test("today: a workout from yesterday isn't 'done today'", async ({ page }) => {
  await page.getByRole("link", { name: "Start lifting" }).waitFor();
  check("no recap card", !(await page.getByText("Done today").count()));
}, account({ sessions: [workout("w1", "push", day(-1), { "Flat DB Press": [[60, 10]] })] }));

const run = tests.filter((t) => !only || t.name.includes(only));
const app = await startApp();
const browser = await launch();
let failed = 0;
for (const t of run) {
  const seen = [];
  const { page, backend, errors, context } = await openApp(browser, app.url, { ...t.seed, api: apis(seen) });
  page.setDefaultTimeout(5000);
  try {
    await t.fn({ page, backend }, seen);
    check("no errors on the page", !errors.length, [...errors, ...backend.requests.filter((r) => r.path.startsWith("/api/") && !(r.path in apis())).map((r) => `unfaked: ${r.method} ${r.path}${r.search}`)].join("\n    "));
    console.log(`✓ ${t.name}`);
  } catch (e) {
    failed++;
    mkdirSync("e2e-failures", { recursive: true });
    const shot = `e2e-failures/${t.name.replace(/\W+/g, "-").slice(0, 60)}.png`;
    await page.screenshot({ path: shot }).catch(() => {});
    console.error(`✗ ${t.name}\n    ${e.message.split("\n").join("\n    ")}\n    screenshot: ${shot}`);
  }
  await context.close();
}
await browser.close();
await app.close();
console.log(failed ? `e2e: ${failed} of ${run.length} failed` : `e2e: all ${run.length} passed`);
process.exit(failed ? 1 : 0);
