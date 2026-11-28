/* Screenshots of Nutrition → Trends against the fake backend, for design review (not a test).
   Run: node scripts/shot-trends.mjs <outDir> [sparse|full] [route ...] */
import { startApp, launch, openApp } from "./e2e/app.mjs";
import { account, entry, day } from "./e2e/fixtures.mjs";

const [out = ".", kind = "full", ...routes] = process.argv.slice(2);
const T = { kcal: 2300, protein: 160, carbs: 270, fat: 65, burn: 2650, rate: -0.7 };
const nutrition = { on: true, goal: "lose", targets: T, history: [{ from: day(-60), ...T }] };
const mk = (d, kcal, protein, carbs, fat, name = "Meal") => entry(name, "lunch", d, { kcal, protein, carbs, fat });
let entries = [], weighins = [];
if (kind === "sparse") {
  entries = [mk(-25, 2250, 165, 250, 70), mk(-24, 2700, 150, 300, 80), mk(-23, 1650, 140, 150, 55), mk(-21, 900, 60, 100, 20), mk(-18, 1600, 138, 160, 50), mk(-1, 1300, 90, 90, 30)];
  weighins = [{ date: day(-26), bw: 201.2 }, { date: day(-15), bw: 201.0 }, { date: day(-3), bw: 200.6 }];
} else {
  for (let d = -28; d <= -1; d++) {
    if ([-20, -13, -12, -5].includes(d)) continue;
    const wkend = [0, 6].includes(new Date(Date.now() + d * 864e5).getDay());
    const k = (wkend ? 2750 : 2150) + ((d * 37) % 180);
    entries.push(mk(d, k, 135 + ((d * 13) % 40), 240 + ((d * 7) % 60), 60 + ((d * 3) % 18), d % 3 ? "Chicken rice bowl" : "Pizza"));
  }
  entries.push(mk(-9, 700, 40, 60, 20));
  entries.push(entry("Beer", "dinner", -7, { kcal: 300, protein: 2, carbs: 26, fat: 0, alcohol: 28 }));
  for (let d = -28; d <= -1; d += 3) weighins.push({ date: day(d), bw: 203 + d * -0.06 + ((d * 7) % 5) / 10 });
}
const seedFor = (theme) => {
  const seed = account({ entries, prefs: { nutrition, theme } });
  const kv = JSON.parse(seed.tables.storage_kv[0].value);
  kv.weighins = weighins;
  seed.tables.storage_kv[0].value = JSON.stringify(kv);
  return seed;
};

const app = await startApp();
const browser = await launch();
for (const theme of ["light", "dark"]) {
  const { page, errors } = await openApp(browser, app.url, seedFor(theme));
  for (const r of routes.length ? routes : ["nutrition/trends"]) {
    await page.goto(new URL("#/" + r, page.url()).href);
    await page.waitForTimeout(1200);
    const name = `${out}/${kind}-${theme}-${r.replace(/\//g, "_")}.png`;
    await page.screenshot({ path: name });
    console.log(name);
  }
  if (errors.length) console.log("errors:", errors);
  await page.context().close();
}
await browser.close();
await app.close();
