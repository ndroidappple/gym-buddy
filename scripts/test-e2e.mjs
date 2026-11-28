/* End-to-end checks: the real app in a phone-sized Chromium, signed in, tapped through like a lifter
   would, against a fake Supabase and /api (scripts/e2e/). Nothing reaches the real account.
   Run: npm run test:e2e   (exits 1 on any failure; a failing test's screenshot goes to e2e-failures/)
   Needs a Chromium; set CHROMIUM_PATH if it isn't at /opt/pw-browsers/chromium. */
import { mkdirSync } from "node:fs";
import { startApp, launch, openApp } from "./e2e/app.mjs";
import { account, SEARCH_RESULT, workout, day, entry } from "./e2e/fixtures.mjs";

const only = process.argv[2]; // a test's name, or part of it, to run just that one
const tests = [];
const test = (name, fn, seed = account()) => tests.push({ name, fn, seed }); // seed: the account it signs in to
const check = (what, ok, detail = "") => { if (!ok) throw new Error(`${what}${detail ? `\n    ${detail}` : ""}`); };

// What the app's /api functions answer in every test.
const apis = (seen) => ({
  "/api/food": (url) => { seen?.push(url.searchParams.get("q")); return { results: /smoothie/i.test(url.searchParams.get("q")) ? [SEARCH_RESULT] : [] }; },
  "/api/review": () => ({}), // no week in review written (the app says to try again later)
  "/api/rest-alert": () => ({ publicKey: null }), // Settings asks for the push key; no lock screen alerts in tests
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

test("add food: an amount your saved meal can't take puts Ask Tank first", async ({ page }) => {
  await openAddFood(page);
  await page.getByRole("searchbox", { name: /search foods/i }).fill("3 cups of banana berry smoothie");
  const ask = page.getByRole("button", { name: /^Ask Tank about/ });
  await ask.waitFor();
  const mine = page.getByRole("button", { name: /^Banana Berry Smoothie/ });
  check("Ask Tank leads, above your foods", (await ask.boundingBox()).y < (await mine.boundingBox()).y);
  check("your food says it logs the usual, not what was typed", await mine.getByText(/^Your usual 1 \w+, not 3 cups$/).count() === 1);
});

test("add food: an amount your food can take keeps it first", async ({ page }) => {
  await openAddFood(page);
  await page.getByRole("searchbox", { name: /search foods/i }).fill("2 banana berry smoothie");
  const mine = page.getByRole("button", { name: /^Banana Berry Smoothie/ });
  await mine.waitFor();
  const ask = page.getByRole("button", { name: /^Ask Tank about/ });
  check("your food leads, Ask Tank below it", (await mine.boundingBox()).y < (await ask.boundingBox()).y);
});

// Google Health connected (workouts only, so no heart rate or sleep calls), with a 21-minute video
// workout from two hours ago recorded on the watch and not logged in GymBuddy. Pull and Push are done,
// so Legs is up next.
const yt = { id: "yt-1", start: Date.now() - 2 * 3600_000, end: Date.now() - 2 * 3600_000 + 23 * 60_000, date: day(0), type: "STRENGTH_TRAINING", name: "Strength training", mins: 21, kcal: 180, hrAvg: 142 };
const watchWorkout = {
  ...account({
    sessions: [workout("w1", "push", day(-3), { "Flat DB Press": [[60, 10]] }), workout("w2", "pull", day(-2), { "Lat Pulldown (Wide Grip)": [[140, 10]] })],
    prefs: { googleHealth: { on: true, since: day(-30), heart: false, sleep: false, recovery: false } },
  }),
  api: { "/api/google-health": (url, body) => (body?.action === "workouts" ? { connected: true, allowed: true, workouts: [yt] } : { connected: true, sent: 0, removed: 0 }) },
};
const savedSessions = async (backend) => JSON.parse(backend.tables.storage_kv[0].value).sessions;
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };

test("today: a workout from the watch counts as the day up next in one tap", async ({ page, backend }) => {
  const card = page.getByRole("region", { name: "Strength training from Google Health" });
  await card.waitFor();
  check("it says what the watch recorded", await card.getByText("21 min · 180 kcal · avg 142 bpm").isVisible());
  check("it guesses the day up next", await card.getByText("Count it as your Legs day?", { exact: false }).isVisible());
  await card.getByRole("button", { name: "Count as Legs" }).click();
  await page.getByRole("region", { name: "Legs done today" }).waitFor();
  const headline = await page.getByRole("heading", { level: 1 }).innerText();
  check("Today recaps it", /^Legs done.*Rest up\.$/.test(headline), `got "${headline}"`);
  check("the rotation moved on", !(await page.getByText("Up next: Legs").count()) && await page.getByText(/^Up next: /).isVisible());
  check("the card is gone", !(await card.count()));
  const slider = page.getByRole("slider", { name: "How hard was it, 1 to 10" });
  check("how hard is asked, not assumed", await page.getByText("How hard was it?").isVisible());
  await slider.focus();
  for (let i = 0; i < 4; i++) await slider.press("ArrowRight");
  check("the rating reads back", await page.getByText("Very hard").isVisible());
  check("saved to the account as Legs, with what Google recorded and the rating",
    await until(async () => (await savedSessions(backend)).some((s) => s.day === "legs" && s.ext?.gid === "yt-1" && s.ext.mins === 21 && s.effort === 9 && !Object.keys(s.sets).length)));
}, watchWorkout);

test("today: skipping a watch workout leaves the rotation alone", async ({ page, backend }) => {
  const card = page.getByRole("region", { name: "Strength training from Google Health" });
  await card.waitFor();
  await card.getByRole("button", { name: "Skip" }).click();
  await until(async () => !(await card.count()));
  check("the card is gone", !(await card.count()));
  check("Legs is still up next", (await page.getByRole("heading", { level: 1 }).innerText()).startsWith("Legs day"));
  check("remembered on the account, so other phones don't ask", await until(async () => (JSON.parse(backend.tables.storage_kv[0].value).prefs.outside?.skip || []).includes("yt-1")));
}, watchWorkout);

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

test("today: the food card adds to the meal picked in the sheet", async ({ page, backend }) => {
  const card = page.getByRole("region", { name: "Food today" });
  await card.waitFor();
  check("nothing logged yet, with the day's targets", await card.getByText("Nothing logged yet").isVisible() && await card.getByText("2,400 kcal and 180 g protein to go").isVisible());
  // The button is the meal for the time of day; whichever it is, the sheet offers the others.
  await card.getByRole("button", { name: /^Add food to / }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("group", { name: "Meal" }).getByRole("button", { name: "Dinner" }).click();
  await dialog.getByRole("heading", { name: "Add to Dinner" }).waitFor();
  await dialog.getByRole("button", { name: "Add Banana Berry Smoothie" }).click();
  await dialog.locator(".food-tray").getByText("1 added · 421 kcal").waitFor();
  check("the meal can't change once something's in", !(await dialog.getByRole("group", { name: "Meal" }).count()));
  await dialog.locator(".food-tray").getByRole("button", { name: "Done" }).click();
  await dialog.waitFor({ state: "detached" });
  await card.getByText("1,979 kcal left").waitFor();
  check("protein to go updates", await card.getByText(/g protein to go$/).isVisible());
  for (let i = 0; i < 20 && !backend.tables.food_entries.length; i++) await page.waitForTimeout(100);
  check("saved to dinner today", backend.tables.food_entries.length === 1 && backend.tables.food_entries[0].meal === "dinner" && backend.tables.food_entries[0].date === day(0),
    JSON.stringify(backend.tables.food_entries.map((e) => [e.name, e.meal, e.date])));
  await card.getByRole("link").click();
  await page.waitForURL(/#\/nutrition$/);
});

test("nutrition: trends live on Nutrition, and the old Progress link lands there", async ({ page }) => {
  await page.goto(new URL("#/progress/nutrition", page.url()).href);
  await page.waitForURL(/#\/nutrition\/trends$/);
  check("Trends is picked", await page.getByRole("group", { name: "Nutrition view" }).getByRole("button", { name: "Trends" }).getAttribute("aria-pressed") === "true");
  await page.getByRole("group", { name: "Nutrition view" }).getByRole("button", { name: "Day" }).click();
  await page.waitForURL(/#\/nutrition$/);
  await page.getByRole("link", { name: "See trends" }).click();
  await page.waitForURL(/#\/nutrition\/trends$/);
  await page.goto(new URL("#/progress", page.url()).href);
  const views = page.getByRole("group", { name: "Progress view" });
  await views.waitFor();
  check("Progress is lifts only", (await views.getByRole("button").allTextContents()).map((t) => t.replace(/ ·.*/, "")).join(",") === "Trends,Workouts",
    (await views.getByRole("button").allTextContents()).join(","));
});

test("help: a tap on the left goes back a card, anywhere else goes on", async ({ page }) => {
  await page.getByRole("button", { name: "About Today" }).click();
  const dialog = page.getByRole("dialog");
  const tap = dialog.locator(".help-tap");
  // click() waits for the sheet to finish sliding up before it measures.
  const at = async (fx) => { const b = await tap.boundingBox(); await tap.click({ position: { x: b.width * fx, y: b.height * 0.8 } }); };
  await at(0.1); // first card: nothing behind it, so on
  await dialog.getByText("2 of", { exact: false }).waitFor();
  await at(0.8);
  await dialog.getByText("3 of", { exact: false }).waitFor();
  await at(0.1);
  await dialog.getByText("2 of", { exact: false }).waitFor();
});

/* ── Wellness: drinks and cannabis ── */
const wellOn = { wellness: { on: true } };
const savedState = (backend) => JSON.parse(backend.tables.storage_kv[0].value);

// The line asks about the day you'd most likely be logging: before noon last night, after, today.
const target = () => (new Date().getHours() < 12 ? day(-1) : day(0));
const when = () => (target() === day(0) ? "today" : "last night");
const modelo = (days, extra = {}) => entry("Modelo", "dinner", days, { amount: 1, unit: "bottle", kcal: 144, protein: 1, carbs: 13, fat: 0,
  basis: { perServing: { kcal: 144, protein: 1, carbs: 13, fat: 0, alcohol: 14 }, servingLabel: "bottle" }, ...extra });

test("wellness: alcohol and cannabis logged on Today show on the week strip and the calendar", async ({ page, backend }) => {
  const card = page.getByRole("region", { name: "Food today" });
  const line = card.locator(".well-line");
  await line.getByText(`Alcohol or cannabis ${when()}?`).waitFor();
  await line.getByRole("button", { name: "Log it" }).click();
  const dialog = page.getByRole("dialog", { name: "Alcohol & cannabis" });
  check("it opens on the day the line asked about", (await dialog.getByRole("group", { name: "Day" }).getByRole("button", { pressed: true }).innerText()).startsWith(target() === day(0) ? "Today" : "Yesterday"));
  await dialog.getByRole("button", { name: "One more Beer" }).click();
  await dialog.getByRole("button", { name: "One more Beer" }).click();
  await dialog.getByRole("button", { name: "One more Beer" }).click();
  await dialog.getByRole("button", { name: "One fewer Beer" }).click();
  await dialog.getByText("2 drinks · 196 kcal from alcohol").waitFor();
  check("the cannabis switch and Done stay in view", await dialog.getByRole("button", { name: "Done" }).isVisible());
  await dialog.getByRole("switch", { name: /Used cannabis/ }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  await dialog.waitFor({ state: "detached" });
  await line.getByText(`2 drinks · cannabis ${when()}`).waitFor();

  for (let i = 0; i < 30 && (backend.tables.food_entries.length < 2 || !savedState(backend).wellness?.[target()]); i++) await page.waitForTimeout(100);
  const beers = backend.tables.food_entries;
  check("two beers in the food log, each one drink", beers.length === 2 && beers.every((e) => e.name === "Beer" && e.date === target() && e.basis?.perServing?.alcohol === 14), JSON.stringify(beers.map((e) => [e.name, e.date, e.basis])));
  check("cannabis saved on the account", savedState(backend).wellness?.[target()]?.cannabis === true, JSON.stringify(savedState(backend).wellness));
  check("the week strip marks the day", await page.locator(".wd").filter({ has: page.locator(".cal-mark.drinks") }).count() === 1
    && /2 drinks · cannabis$/.test(await page.locator(".wd").filter({ has: page.locator(".cal-mark.weed") }).getAttribute("aria-label")));

  await page.goto(new URL("#/progress/workouts", page.url()).href);
  await page.getByRole("button", { name: "Show as a calendar" }).click();
  await page.getByRole("button", { name: /2 drinks · cannabis$/ }).click();
  const detail = page.getByRole("region", { name: "Alcohol and cannabis" });
  await detail.getByText("2 drinks · 196 kcal from alcohol").waitFor();
  check("the same drink is grouped", await detail.getByText("Beer × 2", { exact: true }).isVisible());
  check("cannabis in the day's detail", await detail.getByText("Cannabis", { exact: true }).isVisible());
  check("the month counts them", await page.getByText("1 drinking day (2 drinks) · 1 cannabis day").isVisible());
  await page.getByRole("group", { name: "Show on the calendar" }).getByRole("button", { name: "Alcohol" }).click();
  check("hiding alcohol takes its marks off the grid", !(await page.locator(".cal-mark.drinks").count()));
}, account({ sessions: [workout("w1", "push", day(-2), { "Flat DB Press": [[60, 10]] })], prefs: wellOn }));

test("wellness: your own drinks come first, and another is one tap", async ({ page, backend }) => {
  await page.locator(".well-line").getByRole("button", { name: "Log it" }).click();
  const dialog = page.getByRole("dialog", { name: "Alcohol & cannabis" });
  const names = await dialog.locator(".well-step .name").evaluateAll((els) => els.map((el) => el.firstChild.textContent));
  check("Modelo leads, then the standard drinks", names.slice(0, 5).join(",") === "Modelo,Beer,Wine,Shot,Cocktail", names.join(","));
  await dialog.getByRole("button", { name: "One more Modelo" }).click();
  for (let i = 0; i < 20 && !backend.tables.food_entries.some((e) => e.date === target()); i++) await page.waitForTimeout(100);
  const row = backend.tables.food_entries.find((e) => e.date === target());
  check("a copy of your Modelo, on the day", row && row.name === "Modelo" && row.kcal === 144 && row.unit === "bottle" && row.basis?.perServing?.alcohol === 14, JSON.stringify(row));
  await dialog.getByRole("button", { name: "One more Modelo" }).click();
  await dialog.getByText("2 drinks · 196 kcal from alcohol").waitFor();
}, account({ prefs: wellOn, entries: [modelo(-3), modelo(-5), modelo(-9)] }));

test("wellness: a meal with alcohol in it is listed, not stepped", async ({ page }) => {
  await page.locator(".well-line").getByRole("button", { name: "Log it" }).click();
  const dialog = page.getByRole("dialog", { name: "Alcohol & cannabis" });
  await dialog.getByRole("group", { name: "Day" }).getByRole("button", { name: /^Today/ }).click();
  const meal = dialog.locator(".well-step").filter({ hasText: "Steak & Two Beers" });
  await meal.waitFor();
  check("no stepper on the meal", !(await meal.locator(".well-stepper").count()));
  check("its drinks are counted", await dialog.getByText("2 drinks · 196 kcal from alcohol").isVisible());
}, account({ prefs: wellOn, entries: [entry("Steak & Two Beers", "dinner", 0, { kcal: 1100, protein: 70, carbs: 60, fat: 40,
  basis: { perServing: { kcal: 1100, protein: 70, carbs: 60, fat: 40, alcohol: 28 }, servingLabel: "meal" } })] }));

test("wellness: any day of the last week from Today, and further back from the calendar", async ({ page, backend }) => {
  await page.locator(".well-line").getByRole("button", { name: "Log it" }).click();
  const dialog = page.getByRole("dialog", { name: "Alcohol & cannabis" });
  const chips = dialog.getByRole("group", { name: "Day" }).getByRole("button");
  check("a week of days", (await chips.count()) === 7, String(await chips.count()));
  await chips.nth(3).click();
  await dialog.getByRole("switch", { name: /Used cannabis/ }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  for (let i = 0; i < 30 && !savedState(backend).wellness?.[day(-3)]; i++) await page.waitForTimeout(100);
  check("saved three days back", savedState(backend).wellness?.[day(-3)]?.cannabis === true, JSON.stringify(savedState(backend).wellness));

  // The calendar opens on the latest workout, ten days back: log that day from there.
  await page.goto(new URL("#/progress/workouts", page.url()).href);
  await page.getByRole("button", { name: "Show as a calendar" }).click();
  await page.getByRole("button", { name: /^Log alcohol or cannabis for / }).click();
  const sheet = page.getByRole("dialog", { name: "Alcohol & cannabis" });
  const days = sheet.getByRole("group", { name: "Day" });
  check("it opens on that day, added after the week", (await days.getByRole("button").count()) === 8
    && (await days.getByRole("button", { pressed: true }).innerText()) === (await days.getByRole("button").last().innerText()));
  await sheet.getByRole("button", { name: "One more Wine" }).click();
  await sheet.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /^Edit alcohol or cannabis for / }).waitFor();
  for (let i = 0; i < 20 && !backend.tables.food_entries.length; i++) await page.waitForTimeout(100);
  check("the wine went on that day", backend.tables.food_entries.length === 1 && backend.tables.food_entries[0].date === day(-10) && backend.tables.food_entries[0].meal === "dinner",
    JSON.stringify(backend.tables.food_entries.map((e) => [e.name, e.date, e.meal])));
}, account({ sessions: [workout("w1", "push", day(-10), { "Flat DB Press": [[60, 10]] })], prefs: wellOn }));

test("wellness: Something else opens Add food over the sheet, and closing it comes back", async ({ page }) => {
  await page.locator(".well-line").getByRole("button", { name: "Log it" }).click();
  const sheet = page.getByRole("dialog", { name: "Alcohol & cannabis" });
  await sheet.getByRole("button", { name: "Something else" }).click();
  const add = page.getByRole("dialog", { name: /^Add to / });
  await add.waitFor();
  check("the search box is there to describe it", await add.getByRole("searchbox", { name: /search foods/i }).isVisible());
  await add.getByRole("button", { name: "Close" }).click();
  await add.waitFor({ state: "detached" });
  check("back on the sheet", await sheet.getByRole("button", { name: "Done" }).isVisible());
}, account({ prefs: wellOn }));

test("wellness: before noon the line asks about last night, and the sheet says why", async ({ page }) => {
  const line = page.locator(".well-line");
  await line.getByText("Alcohol or cannabis last night?").waitFor();
  await line.getByRole("button", { name: "Log it" }).click();
  const dialog = page.getByRole("dialog", { name: "Alcohol & cannabis" });
  await dialog.getByText("It's morning, so this is for last night.").waitFor();
  check("Yesterday is picked", (await dialog.getByRole("group", { name: "Day" }).getByRole("button", { pressed: true }).innerText()).startsWith("Yesterday"));
}, { ...account({ prefs: wellOn }), clock: "09:00" });

test("wellness: after noon the line asks about today", async ({ page }) => {
  const line = page.locator(".well-line");
  await line.getByText("Alcohol or cannabis today?").waitFor();
  await line.getByRole("button", { name: "Log it" }).click();
  const dialog = page.getByRole("dialog", { name: "Alcohol & cannabis" });
  check("Today is picked, with no morning note", (await dialog.getByRole("group", { name: "Day" }).getByRole("button", { pressed: true }).innerText()).startsWith("Today")
    && !(await dialog.getByText("It's morning").count()));
}, { ...account({ prefs: wellOn }), clock: "15:00" });

test("wellness: before noon, something already logged today shows instead of an empty last night", async ({ page }) => {
  await page.locator(".well-line").getByText("cannabis today").waitFor();
  check("Edit, not Log it", await page.locator(".well-line").getByRole("button", { name: "Edit" }).isVisible());
}, { ...account({ prefs: wellOn, wellness: { [day(0)]: { cannabis: true } } }), clock: "09:00" });

test("wellness: Escape on Add food goes back to the sheet, which still holds the page", async ({ page }) => {
  await page.locator(".well-line").getByRole("button", { name: "Log it" }).click();
  const sheet = page.getByRole("dialog", { name: "Alcohol & cannabis" });
  await sheet.getByRole("button", { name: "Something else" }).click();
  const add = page.getByRole("dialog", { name: /^Add to / });
  await add.waitFor();
  await page.keyboard.press("Escape");
  await add.waitFor({ state: "detached" });
  check("the alcohol sheet is still open", await sheet.getByRole("button", { name: "Done" }).isVisible());
  check("the page behind stays locked", (await page.evaluate(() => document.body.style.overflow)) === "hidden");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  check("unlocked once the last sheet closes", (await page.evaluate(() => document.body.style.overflow)) === "");
}, account({ prefs: wellOn }));

test("wellness: a drink logged as several counts each, and − takes one off", async ({ page, backend }) => {
  await page.locator(".well-line").getByRole("button", { name: /Log it|Edit/ }).click();
  const dialog = page.getByRole("dialog", { name: "Alcohol & cannabis" });
  await dialog.getByRole("group", { name: "Day" }).getByRole("button", { name: /^Today/ }).click();
  const beer = dialog.getByRole("group", { name: "Beer" });
  await beer.getByText("3", { exact: true }).waitFor();
  await beer.getByRole("button", { name: "One fewer Beer" }).click();
  await beer.getByText("2", { exact: true }).waitFor();
  for (let i = 0; i < 20 && backend.tables.food_entries[0]?.amount !== 2; i++) await page.waitForTimeout(100);
  const e = backend.tables.food_entries[0];
  check("the entry is now two beers, with two beers' calories", backend.tables.food_entries.length === 1 && e.amount === 2 && e.kcal === 300, JSON.stringify(e));
}, account({ prefs: wellOn, entries: [entry("Beer", "dinner", 0, { amount: 3, unit: "drink", kcal: 450, protein: 4.8, carbs: 39, fat: 0,
  source: "custom", basis: { perServing: { kcal: 150, protein: 1.6, carbs: 13, fat: 0, alcohol: 14 }, servingLabel: "drink" } })] }));

test("wellness: a drink from Tank splits the day's calories into food and alcohol", async ({ page }) => {
  await page.goto(new URL("#/nutrition", page.url()).href);
  const split = page.locator(".nut-split");
  await split.waitFor();
  // The beers' own carbs and protein (100 kcal) count as food; only the alcohol is split out.
  check("food and alcohol, with the drinks", (await split.innerText()).replace(/\s+/g, " ") === "600 food · 196 alcohol (2 drinks)", await split.innerText());
  check("the drink is marked in its meal", await page.getByRole("img", { name: "Has alcohol" }).count() === 1);
}, account({ prefs: wellOn, entries: [
  entry("Chicken Bowl", "lunch", 0),
  entry("Two Modelos", "dinner", 0, { kcal: 296, protein: 2, carbs: 25, fat: 0, basis: { perServing: { kcal: 296, protein: 2, carbs: 25, fat: 0, alcohol: 28 }, servingLabel: "meal" } }),
] }));

test("wellness: off by default; only the Settings switch turns it on", async ({ page }) => {
  // A new account: no wellness prefs at all, and a drink plus a cannabis day already in the data.
  await page.getByRole("region", { name: "Food today" }).waitFor();
  check("no line on Today", !(await page.locator(".well-line").count()));
  await page.goto(new URL("#/nutrition", page.url()).href);
  await page.getByText("Two Modelos").waitFor();
  check("no split on Nutrition", !(await page.locator(".nut-split").count()));
  check("no drink marker", !(await page.getByRole("img", { name: "Has alcohol" }).count()));
  await page.getByRole("group", { name: "Nutrition view" }).getByRole("button", { name: "Trends" }).click();
  await page.waitForURL(/#\/nutrition\/trends$/);
  check("no Alcohol section in Trends", !(await page.locator("#nt-drinks").count()));
  await page.goto(new URL("#/progress/workouts", page.url()).href);
  await page.getByRole("button", { name: "Show as a calendar" }).click();
  await page.locator(".cal-grid").waitFor();
  check("no layers, marks or legend on the calendar", !(await page.locator(".cal-layers, .cal-mark, .cal-legend, .cal-well").count()));

  await page.goto(new URL("#/settings", page.url()).href);
  const sw = page.getByRole("switch", { name: /Track alcohol & cannabis/ });
  check("the switch starts off", (await sw.getAttribute("aria-checked")) === "false");
  await sw.click();
  await page.goto(new URL("#/today", page.url()).href);
  await page.locator(".well-line").getByText("2 drinks · cannabis today").waitFor();

  await page.goto(new URL("#/settings", page.url()).href);
  await page.getByRole("switch", { name: /Track alcohol & cannabis/ }).click();
  await page.goto(new URL("#/today", page.url()).href);
  await page.getByRole("region", { name: "Food today" }).waitFor();
  check("off again: the line is gone", !(await page.locator(".well-line").count()));
}, account({ sessions: [workout("w1", "push", day(-1), { "Flat DB Press": [[60, 10]] })], wellness: { [day(0)]: { cannabis: true } },
  entries: [entry("Two Modelos", "dinner", 0, { kcal: 296, protein: 2, carbs: 25, fat: 0, basis: { perServing: { kcal: 296, protein: 2, carbs: 25, fat: 0, alcohol: 28 }, servingLabel: "meal" } })] }));

test("wellness: with food tracking off, drinks are a count", async ({ page, backend }) => {
  const line = page.locator(".well-line");
  await line.getByText(`Alcohol or cannabis ${when()}?`).waitFor();
  await line.getByRole("button", { name: "Log it" }).click();
  const dialog = page.getByRole("dialog");
  check("no Something else without a food log", !(await dialog.getByRole("button", { name: "Something else" }).count()));
  await dialog.getByRole("button", { name: "One more drink" }).click();
  await dialog.getByRole("button", { name: "One more drink" }).click();
  await dialog.getByRole("button", { name: "One more drink" }).click();
  await dialog.getByRole("button", { name: "One fewer drink" }).click();
  await dialog.locator(".well-count").getByText("2 drinks").waitFor();
  await dialog.getByRole("button", { name: "Done" }).click();
  await line.getByText(`2 drinks ${when()}`).waitFor();
  for (let i = 0; i < 30 && !savedState(backend).wellness?.[target()]; i++) await page.waitForTimeout(100);
  check("the count is saved on the account", savedState(backend).wellness?.[target()]?.drinks === 2, JSON.stringify(savedState(backend).wellness));
  check("nothing went to a food log", backend.tables.food_entries.length === 0);
}, account({ prefs: { ...wellOn, nutrition: { on: false } } }));

const run = tests.filter((t) => !only || t.name.includes(only));
const app = await startApp();
const browser = await launch();
let failed = 0;
for (const t of run) {
  const seen = [];
  const { page, backend, errors, context } = await openApp(browser, app.url, { ...t.seed, api: { ...apis(seen), ...t.seed.api } });
  page.setDefaultTimeout(5000);
  try {
    await t.fn({ page, backend }, seen);
    check("no errors on the page", !errors.length, [...errors, ...backend.requests.filter((r) => r.path.startsWith("/api/") && !(r.path in apis()) && !(r.path in (t.seed.api || {}))).map((r) => `unfaked: ${r.method} ${r.path}${r.search}`)].join("\n    "));
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
