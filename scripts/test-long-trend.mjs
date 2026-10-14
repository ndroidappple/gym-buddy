/* Checks that "trend" means long-term progress: what the coaches read ranks lifts by how much they've
   improved since they were started (per month), not by the last few sessions. The case that matters:
   a lift that jumped early and has been flat for a few weeks still beats one that crept up slowly.
   Loads lib/coachChat.js through Vite (it reads the Supabase env like the app does).
   Run: npm run test:coach   (exits 1 on any failure) */
import { createServer } from "vite";
import { longTrend, liftSeries, iso } from "../src/lib/util.js";

let failed = 0;
const ok = (name, cond, detail = "") => { if (!cond) { failed++; console.error(`✗ ${name}${detail ? `\n    ${detail}` : ""}`); } };

const day = (n) => iso(new Date(Date.now() - n * 864e5));
// 12 weeks of push days, one a week. Press: +5 lb a week for 8 weeks, then flat for 4.
// Pec Dec: +1 lb a week throughout. Cable Fly: two sessions only.
const sessions = [];
for (let w = 0; w < 12; w++) {
  const press = 100 + Math.min(w, 8) * 5, dec = 60 + w;
  const sets = { "Flat DB Press": [{ w: press, r: 10 }, { w: press, r: 9 }], "Machine Pec Dec": [{ w: dec, r: 12 }] };
  if (w >= 10) sets["Cable Fly (Low to High)"] = [{ w: 30, r: 12 }];
  sessions.push({ id: `s${w}`, date: day(84 - w * 7), day: "push", sets, finishedAt: w });
}

const press = longTrend(liftSeries(sessions, "Flat DB Press"));
const dec = longTrend(liftSeries(sessions, "Machine Pec Dec"));
ok("press: long-term trend is up a lot", press.pct > 30, JSON.stringify(press));
ok("pec dec: long-term trend is up a little", dec.pct > 0 && dec.pct < press.pct, JSON.stringify(dec));
ok("per month is set with 3+ weeks of history", press.perMonth != null && dec.perMonth != null);
ok("two sessions over a week: no per-month rate yet", longTrend(liftSeries(sessions, "Cable Fly (Low to High)")).perMonth === null);
ok("one session: no trend", longTrend(liftSeries(sessions.slice(0, 1), "Flat DB Press")) === null);

// The Supabase client needs a URL to load; nothing here talks to it.
process.env.VITE_SUPABASE_URL ||= "https://example.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY ||= "test";
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { headContext, buildContext } = await vite.ssrLoadModule("/src/lib/coachChat.js");
const { PROGRAM } = await vite.ssrLoadModule("/src/data/program.js");
await vite.close();

const head = headContext({ sessions, program: PROGRAM, weighins: [], profile: {}, phase: null, n: null });
const rank = head.split("\n").find((l) => l.startsWith("Long-term progress"));
ok("head coach gets a long-term ranking", !!rank, head);
ok("ranked most to least: press before pec dec", rank && rank.indexOf("Flat DB Press") < rank.indexOf("Machine Pec Dec"), rank);
ok("too-new lifts aren't ranked", rank && !rank.includes("Cable Fly") && head.includes("Too new to rank (under 4 sessions or 3 weeks): Cable Fly (Low to High)"), head);
const pressLine = head.split("\n").find((l) => l.startsWith("- Flat DB Press:"));
ok("each lift says its trend since start", pressLine?.includes("trend since start +"), pressLine);
ok("and labels the short-term one as lately", pressLine?.includes("lately +0.0% (last 3 sessions vs the 3 before)"), pressLine);
ok("history beyond the 30-day log is stated", head.includes(`Training history: 12 workouts since ${day(84)}`));

const crew = buildContext({ coach: "tank", sessions, program: PROGRAM, weighins: [], profile: {}, phase: null });
ok("crew coaches get the ranking too", crew.includes("Long-term progress, most to least improved"), crew);

if (failed) { console.error(`\n${failed} long-term trend check(s) failed`); process.exit(1); }
console.log("long-term trend: all checks passed");
