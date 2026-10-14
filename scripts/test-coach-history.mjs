/* Checks what the head coach reads beyond 30 days: older history at less detail the further back it
   goes (weekly to about 6 months, then monthly), each lift's best by month, food from the daily
   totals, empty stretches folded into one line, and the whole thing small enough to send.
   Run: npm run test:coach   (exits 1 on any failure) */
import { createServer } from "vite";
import { iso } from "../src/lib/util.js";

let failed = 0;
const ok = (name, cond, detail = "") => { if (!cond) { failed++; console.error(`✗ ${name}${detail ? `\n    ${String(detail).slice(0, 2000)}` : ""}`); } };

process.env.VITE_SUPABASE_URL ||= "https://example.supabase.co"; // nothing here talks to it
process.env.VITE_SUPABASE_ANON_KEY ||= "test";
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { headContext } = await vite.ssrLoadModule("/src/lib/coachChat.js");
const { PROGRAM } = await vite.ssrLoadModule("/src/data/program.js");
await vite.close();

const day = (n) => iso(new Date(Date.now() - n * 864e5));
const DAYS = ["push", "pull", "legs", "shoulders"];
const LIFTS = { push: ["Flat DB Press", "Machine Pec Dec", "Tricep Pushdown (Rope)"], pull: ["Lat Pulldown (Wide Grip)", "Hammer Curl"], legs: ["Leg Press (Heavy)", "Romanian Deadlift"], shoulders: ["Seated DB Shoulder Press", "Lateral Raise (Cable)"] };
// Two years, four days a week, with a 6-week break from 300 to 258 days ago.
const sessions = [];
const BREAK = (i) => i <= 300 && i > 258;
let k = 0;
for (let i = 730; i >= 1; i--) {
  if (i % 7 >= 4 || BREAK(i)) continue;
  const d = DAYS[k++ % 4];
  const sets = Object.fromEntries(LIFTS[d].map((n, j) => [n, [{ w: (j ? 40 : 100) + Math.floor((730 - i) / 30) * 2.5, r: 10 }, { w: (j ? 40 : 100), r: 8 }]]));
  sessions.push({ id: `s${i}`, date: day(i), day: d, sets, finishedAt: i });
}
const weighins = Array.from({ length: 104 }, (_, w) => ({ date: day(728 - w * 7), bw: 175 + w * 0.1 }));
// Food: the last 120 days as entries, older days as daily totals.
const entries = [];
for (let i = 119; i >= 0; i--) entries.push({ id: `e${i}`, date: day(i), meal: "lunch", name: "Chicken Rice Bowl", kcal: 2400, protein: 170, carbs: 250, fat: 70 });
const foodDays = {};
for (let i = 500; i >= 120; i--) if (!BREAK(i)) foodDays[day(i)] = { kcal: 2100, protein: 140, n: 3 };
const n = { targets: { kcal: 2600, protein: 180, carbs: 300, fat: 80, burn: 2600 } };

const ctx = headContext({ sessions, program: PROGRAM, weighins, profile: {}, phase: null, n, entries, foodDays });
const lines = ctx.split("\n");
const at = (prefix) => lines.findIndex((l) => l.startsWith(prefix));

ok("states the whole history", ctx.includes(`Training history: ${sessions.length} workouts since ${day(730)}`), lines[0]);
ok("weekly section", at("Before that, week by week") > 0, ctx);
ok("monthly section", at("Before that, month by month") > 0, ctx);
const weekRows = lines.slice(at("Before that, week by week") + 1).filter((l, i, all) => l.startsWith("- 20") && all.slice(0, i).every((x) => x.startsWith("- 20")));
ok("about 22 weekly rows (30 to 182 days ago)", weekRows.length >= 20 && weekRows.length <= 23, weekRows.length + "\n" + weekRows.join("\n"));
ok("weekly rows carry food from entries and bodyweight", weekRows.some((l) => /4 workouts, \d+ sets, .* lb; food 7 days logged, avg 2400 kcal, 170 g protein; bodyweight/.test(l)), weekRows.join("\n"));
const monthRows = lines.slice(at("Before that, month by month") + 1).filter((l, i, all) => l.startsWith("- 20") && all.slice(0, i).every((x) => x.startsWith("- 20")));
ok("monthly rows back to the first workout", monthRows[0]?.startsWith(`- ${day(730)}`), monthRows[0]);
ok("monthly rows use the older daily food totals", monthRows.some((l) => l.includes("avg 2100 kcal, 140 g protein")), monthRows.join("\n"));
ok("months before food tracking say so", monthRows[0]?.includes("no food logged"), monthRows[0]);
ok("the break shows as no workouts", [...weekRows, ...monthRows].some((l) => l.includes("no workouts")), [...monthRows].join("\n"));
ok("each lift's best by month", at("Each lift's best e1RM by month") > 0 && lines.some((l) => /^- Flat DB Press: (\d{4}-\d{2} \d+, ){11}\d{4}-\d{2} \d+$/.test(l)), ctx);
ok("ranking still there", at("Long-term progress, most to least improved") > 0);
ok("fits what the server accepts (32,000 characters)", ctx.length < 32000, `${ctx.length} characters`);
console.log(`  two years of history: ${ctx.length.toLocaleString()} characters (${lines.length} lines)`);
if (process.env.SHOW) console.log(lines.filter((l, i) => i >= at("Before that, week by week") && i < at("Before that, week by week") + 4 || i >= at("Before that, month by month") && i < at("Before that, month by month") + 4 || i >= at("Each lift's best") && i < at("Each lift's best") + 2).join("\n"));

// A new lifter: nothing older than 30 days, so no older sections at all.
const fresh = headContext({ sessions: sessions.filter((x) => x.date >= day(20)), program: PROGRAM, weighins: [], profile: {}, phase: null, n: null });
ok("new lifter: no weekly or monthly sections", !fresh.includes("week by week (oldest first)") && !fresh.includes("month by month"), fresh);

// A gap with nothing at all folds into one line.
const gappy = headContext({ sessions: sessions.filter((x) => x.date < day(150) || x.date > day(60)), program: PROGRAM, weighins: [], profile: {}, phase: null, n: null });
const gl = gappy.split("\n");
const gWeeks = gl.slice(gl.findIndex((l) => l.startsWith("Before that, week by week")) + 1);
const gWeekRows = gWeeks.slice(0, gWeeks.findIndex((l) => !l.startsWith("- 20")));
const nothing = gWeekRows.filter((l) => l.endsWith("nothing logged"));
const [from, to] = (nothing[0] || "").slice(2).split(":")[0].split(" to ");
ok("an empty stretch of weeks folds into one line, oldest date first", nothing.length === 1 && from < to, gWeekRows.join("\n"));

if (failed) { console.error(`\n${failed} coach history check(s) failed`); process.exit(1); }
console.log("coach history: all checks passed");
