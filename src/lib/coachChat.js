import { supabase } from "../supabase-client.js";
import { COACHES, coachFor } from "../data/coaches.js";
import { isCardio, activeDays } from "../data/program.js";
import { describeProgram, applyChanges } from "./programChange.js";
import { GOALS } from "./setup.js";
import { cleanMeal, todayFood, totals, addDays } from "./nutrition.js";
import { PHASE_TYPES, phaseStatus, statusLine } from "./phase.js";
import { fmtSet, liftSeries, trend, num, fmtW, bestSet, bodyweightSeries, byDateAsc, byDateDesc, daysBetween, today, nextDayAfter, readyToIncrease, compact, lifting, volume, longTrend, iso, longDate, mmss, bestE1rm, priorSessions, isCardioSet } from "./util.js";
import { heartLine } from "./heart.js";

const signed = (x, unit = "%") => `${x >= 0 ? "+" : ""}${x.toFixed(1)}${unit}`;

/** One lift for the coach: its plan, latest best set, its trend since the lifter started it (the
    long-term one), how it's gone lately, RIR, and whether it's earned more weight. */
function describeLift(sessions, plan, n) {
  if (isCardio(n)) {
    const logs = [...sessions].sort(byDateDesc).filter((x) => x.sets[n]?.length);
    return logs.length ? `${n}: last ${logs[0].date} ${logs[0].sets[n].map(fmtSet).join(" + ")}, ${logs.length} sessions` : `${n}: not logged yet`;
  }
  const s = liftSeries(sessions, n);
  if (!s.length) return `${n}: not logged yet`;
  const last = s[s.length - 1];
  const b = bestSet(last.sets);
  const lt = longTrend(s);
  const lately = trend(s.map((x) => x.orm));
  const best = s.reduce((a, x) => (x.orm > a.orm ? x : a), s[0]);
  const rir = last.sets.filter((x) => x.rir != null).map((x) => x.rir);
  const up = readyToIncrease(plan[n], last.sets);
  const target = plan[n] ? `plan ${plan[n].sets}x${plan[n].reps[0]}-${plan[n].reps[1]}, ` : "";
  return `${n}: ${target}last ${last.date} best set ${fmtW(b.w)}x${b.r}, e1RM ${num(last.orm)} lb, ${s.length} sessions since ${s[0].date}` +
    (lt ? `, trend since start ${signed(lt.pct)} (e1RM ${num(lt.start)} -> ${num(lt.now)} lb${lt.perMonth != null ? `, ${signed(lt.perMonth)}/month` : ""})` : "") +
    (best.orm > last.orm ? `, best ever e1RM ${num(best.orm)} lb on ${best.date}` : "") +
    (lately != null ? `, lately ${signed(lately)} (last 3 sessions vs the 3 before)` : "") + (rir.length ? `, RIR ${rir.join("/")}` : "") +
    (up ? `, READY TO ADD WEIGHT (hit ${up.sets}x${up.reps} at ${up.from} lb; next: ${up.to} lb)` : "");
}
const planOf = (program) => Object.fromEntries(activeDays(program).flatMap((d) => program[d].exercises.map((e) => [e.n, e])));
const liftsOf = (program) => [...new Set(activeDays(program).flatMap((d) => program[d].exercises.map((e) => e.n)))];
/** Every lift ranked by long-term progress per month, most to least, worked out here so the model
    never sorts numbers itself. Lifts with under 4 sessions or 3 weeks of history are listed as too new. */
function progressRanking(sessions, lifts) {
  const rows = lifts.filter((n) => !isCardio(n)).map((n) => { const s = liftSeries(sessions, n); return { n, s, lt: longTrend(s) }; }).filter((x) => x.s.length);
  const ranked = rows.filter((x) => x.lt?.perMonth != null && x.s.length >= 4).sort((a, b) => b.lt.perMonth - a.lt.perMonth);
  const fresh = rows.filter((x) => !ranked.includes(x)).map((x) => x.n);
  const lines = [];
  if (ranked.length) lines.push(`Long-term progress, most to least improved (e1RM per month since each lift was started): ${ranked.map((x) => `${x.n} ${signed(x.lt.perMonth)}/month (${signed(x.lt.pct)} since ${x.lt.from})`).join("; ")}.`);
  if (fresh.length) lines.push(`Too new to rank (under 4 sessions or 3 weeks): ${fresh.join(", ")}.`);
  return lines;
}

/** A workout as one line: each lift's best set (cardio: what was logged), and heart rate from their watch when there is some. */
function workoutLine(s, program) {
  const done = Object.entries(s.sets).filter(([, v]) => v?.length).map(([n, v]) => {
    const b = bestSet(v);
    const peaks = v.some((x) => x.hr) ? `; set peak HR ${v.map((x) => x.hr ?? "?").join("/")}${v.some((x) => x.hrRest) ? `, came down to ${v.map((x) => x.hrRest ?? "?").join("/")}` : ""}` : "";
    return b ? `${n} ${fmtW(b.w)}x${b.r} (${lifting(v).length} sets${peaks})` : `${n} ${v.map(fmtSet).join(" + ")}`;
  });
  const hr = heartLine(s);
  return `- ${s.date} ${program[s.day]?.name || s.day}: ${done.join(", ") || "nothing logged"}${hr ? `. ${hr}` : ""}`;
}
function phaseLine(phase, sessions, weighins) {
  const s = phaseStatus(phase, sessions, weighins);
  return `Current phase: ${PHASE_TYPES[phase.type].label}, week ${s.week} of ${s.weeks}, ${phase.startWeight} -> ${phase.target} lb (planned ${phase.rate} lb/week, ends ${phase.end}). Status: ${statusLine(phase, s)} Advise on food for pace; keep heavy lifts heavy on a cut.`;
}
export function goalsLine(profile) {
  const goals = (profile.goals || []).map((g) => GOALS.find((x) => x.id === g)?.label).filter(Boolean);
  return `Goals: ${goals.join(", ") || "not given"}. Trains about ${profile.days || "?"} days a week (flexible).` + (profile.note ? ` Lifter's note: ${profile.note}` : "");
}
const notesLines = (notes, whose) => (notes?.length ? [`${whose} (kept between chats):`, ...notes.map((n) => `- ${n}`)] : []);

/** A compact, plain-text picture of the lifter for a crew coach: their lifts, recent bests, trends, bodyweight.
    `notes` are the head coach's memory of the lifter, so the crew knows about a bad knee too. */
export function buildContext({ coach, sessions, program, weighins, profile, phase, nutrition, notes }) {
  // Most needed first, so if the server ever cuts the end (api/coach.js), what goes is the least needed.
  const lines = [...notesLines(notes, "Head coach's notes on the lifter")];
  // A bulk or cut in progress, with the pace read from the weigh-in trend.
  if (phase) lines.push(phaseLine(phase, sessions, weighins));
  // What the lifter told the head coach at setup.
  if (profile?.doneAt) lines.push(goalsLine(profile));
  const sorted = [...sessions].sort(byDateDesc);
  if (sorted[0]) lines.push(`Last workout: ${program[sorted[0].day]?.name || sorted[0].day}, ${daysBetween(sorted[0].date, today())} days ago.`);
  // The last few workouts as logged, so the coach can talk about what the lifter has actually been doing.
  if (sorted.length) {
    const within = (n) => sorted.filter((s) => daysBetween(s.date, today()) < n).length;
    lines.push(`Workouts: ${within(7)} in the last 7 days, ${within(28)} in the last 28.`, "Recent workouts (newest first, best set per lift):",
      ...sorted.slice(0, 3).map((s) => workoutLine(s, program)));
  }
  lines.push(`Next up: ${program[nextDayAfter(sessions, program)].name}.`);

  const lifts = liftsOf(program);
  const plan = planOf(program);
  const mine = lifts.filter((n) => coachFor(n) === coach);
  const describe = (n) => describeLift(sessions, plan, n);
  lines.push(`Your lifts (${COACHES[coach].group}):`, ...mine.map((n) => `- ${describe(n)}`));
  // Every day's lifts with their plan, so the coach can propose edits by exact day key and name.
  lines.push("Program (day key (name): lift sets x rep range, rest):", describeProgram(program));
  // Food tracking, when it's on: targets, today so far, the week.
  if (nutrition) lines.push(nutrition);
  const bw = bodyweightSeries(sessions, weighins);
  if (bw.length) {
    const f = bw[0], l = bw[bw.length - 1];
    lines.push(`Bodyweight: ${num(l.bw)} lb on ${l.date}` + (bw.length > 1 ? ` (${num(l.bw - f.bw)} lb since ${f.date})` : "") + ".");
  }
  lines.push(...progressRanking(sessions, lifts));
  const others = lifts.filter((n) => coachFor(n) !== coach).map(describe).filter((x) => !x.endsWith("not logged yet"));
  if (others.length) lines.push("Other lifts:", ...others.slice(0, 12).map((x) => `- ${x}`));
  return lines.join("\n");
}

export const HEAD_DAYS = 30;
const WEEKLY_DAYS = 182; // beyond the 30 days in full, a line a week back to here (about 6 months), then a line a month
/* How much older history fits, by detail level: the head coach context is rebuilt at the next level
   down until it fits HEAD_BUDGET, trimming the oldest detail first. */
const DETAIL = [
  { log: 24, weeks: 22, months: 36, liftMonths: 12 },
  { log: 16, weeks: 22, months: 12, liftMonths: 6 },
  { log: 12, weeks: 12, months: 6, liftMonths: 3 },
  { log: 8, weeks: 8, months: 0, liftMonths: 0 },
];

/**
 * Everything older than the 30 days in full, at less detail the further back it goes, so the coach
 * can see trends across the whole history while the context stays bounded: a line per week back to
 * about 6 months, a line per month before that (up to 3 years), and each lift's best e1RM by month.
 * `foodDays` is { date: { kcal, protein, n } } for days before the loaded food window.
 */
function olderHistory({ sessions, weighins, n, entries, foodDays }, detail = DETAIL[0]) {
  const t = today();
  const ago = (d) => daysBetween(d, t);
  const food = { ...foodDays };
  for (const e of entries) {
    const f = (food[e.date] = food[e.date]?.fresh ? food[e.date] : { kcal: 0, protein: 0, n: 0, fresh: true });
    f.kcal += +e.kcal || 0; f.protein += +e.protein || 0; f.n++;
  }
  const bw = bodyweightSeries(sessions, weighins);
  const dates = [...sessions.map((x) => x.date), ...bw.map((x) => x.date), ...(n ? Object.keys(food) : [])].filter((d) => ago(d) >= HEAD_DAYS);
  if (!dates.length) return [];
  const first = dates.reduce((a, d) => (d < a ? d : a));

  // One period's line: training, food (when tracked) and bodyweight. null when nothing was logged.
  const row = (from, to) => {
    const ss = sessions.filter((x) => x.date >= from && x.date <= to);
    const fd = n ? Object.entries(food).filter(([d, v]) => d >= from && d <= to && v.n).map(([, v]) => v) : [];
    const ws = bw.filter((x) => x.date >= from && x.date <= to);
    if (!ss.length && !fd.length && !ws.length) return null;
    const sets = ss.reduce((a, x) => a + Object.values(x.sets).reduce((b, v) => b + lifting(v).length, 0), 0);
    const vol = ss.reduce((a, x) => a + Object.values(x.sets).reduce((b, v) => b + volume(v), 0), 0);
    const avg = (xs, k) => Math.round(xs.reduce((a, x) => a + x[k], 0) / xs.length);
    return [
      ss.length ? `${ss.length} workouts, ${sets} sets, ${compact(vol)} lb` : "no workouts",
      n && (fd.length ? `food ${fd.length} days logged, avg ${avg(fd, "kcal")} kcal, ${avg(fd, "protein")} g protein` : "no food logged"),
      ws.length && `bodyweight ${num(ws.reduce((a, x) => a + x.bw, 0) / ws.length)} lb`,
    ].filter(Boolean).join("; ");
  };
  // Runs of empty periods (oldest first) fold into one "nothing logged" line.
  const fold = (periods) => {
    const out = [];
    for (const p of periods) {
      const last = out[out.length - 1];
      if (!p.text && last && !last.text) last.to = p.to;
      else out.push({ ...p });
    }
    return out.map((p) => `- ${p.from}${p.to !== p.from ? ` to ${p.to}` : ""}: ${p.text || "nothing logged"}`);
  };

  const lines = [];
  const weeks = [];
  for (let start = HEAD_DAYS; start < WEEKLY_DAYS; start += 7) {
    const to = addDays(t, -start), from = addDays(t, -(start + 6));
    if (to < first) break;
    weeks.unshift({ from: from < first ? first : from, to, text: row(from, to) });
  }
  const shownWeeks = weeks.slice(-detail.weeks);
  if (shownWeeks.length) lines.push("Before that, week by week (oldest first):", ...fold(shownWeeks));

  const cut = addDays(t, -WEEKLY_DAYS); // monthly rows end the day before the weekly ones begin
  if (first < cut && detail.months) {
    const months = [];
    for (let m = first.slice(0, 7); m + "-01" < cut; ) {
      const from = m + "-01" < first ? first : m + "-01";
      const end = iso(new Date(+m.slice(0, 4), +m.slice(5, 7), 0)); // last day of the month
      const to = end < cut ? end : addDays(cut, -1);
      months.push({ from, to, text: row(from, to) });
      const d = new Date(+m.slice(0, 4), +m.slice(5, 7), 1);
      m = iso(d).slice(0, 7);
    }
    const shown = months.slice(-detail.months);
    if (months.length > shown.length) lines.push(`History before ${shown[0].from} is left out (${months.length - shown.length} older months).`);
    lines.push("Before that, month by month (oldest first):", ...fold(shown));
  }

  // Each lift's best e1RM by month, the last 12 months it was trained, for lifts with history past the 30 days.
  const lifts = [...new Set(sessions.flatMap((x) => Object.keys(x.sets).filter((k) => lifting(x.sets[k]).length)))];
  const byMonth = !detail.liftMonths ? [] : lifts.map((name) => {
    const ser = liftSeries(sessions, name);
    if (ser.length < 4 || ago(ser[0].date) < HEAD_DAYS) return null;
    const best = {};
    for (const x of ser) best[x.date.slice(0, 7)] = Math.max(best[x.date.slice(0, 7)] || 0, x.orm);
    const ms = Object.entries(best).slice(-detail.liftMonths);
    return `- ${name}: ${ms.map(([m, v]) => `${m} ${Math.round(v)}`).join(", ")}`;
  }).filter(Boolean);
  if (byMonth.length) lines.push(`Each lift's best e1RM by month (lb, last ${detail.liftMonths} months trained):`, ...byMonth);
  return lines;
}

/**
 * What the head coach reads: the last 30 days of training and food side by side, so trends across
 * both show (protein short in the weeks a lift stalled, fewer workouts, weight off pace), plus
 * every lift's trend, bodyweight, today's food numbered for edits, the program, and the coach's
 * own notes from earlier chats. `n` is prefs.nutrition (null when food tracking is off).
 */
/**
 * One workout in full, for the head coach when the chat is opened from its recap: every set in the
 * order it was done, with when, the rest before it, and its heart rate (peak, and how far it came down
 * after), each lift against the last time it was done and its best ever, and the workout's heart rate.
 * Goes first in the context, so "this workout" is never ambiguous.
 */
export function workoutFocus(s, sessions, program) {
  const clock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const mins = s.startedAt && s.finishedAt ? Math.round((s.finishedAt - s.startedAt) / 60000) : null;
  const lines = [
    "The lifter opened this chat from the recap of one workout. Their questions are about this workout unless they say otherwise; use the rest of the data below to compare it with earlier ones.",
    `This workout: ${program[s.day]?.name || s.day} on ${longDate(s.date)} (${s.date})${s.startedAt && s.finishedAt ? `, ${clock(s.startedAt)} to ${clock(s.finishedAt)}` : ""}${mins ? `, ${mins} min` : ""}.${s.bw != null ? ` Bodyweight ${num(s.bw)} lb.` : ""}${s.note ? ` Their note: "${s.note}"` : ""}`,
  ];
  const hr = heartLine(s);
  if (hr) lines.push(`Heart rate (from their watch): ${hr}.`);
  // Rest before each set: the time since the set before it, whatever the lift (only sets that know when they were done).
  const timed = Object.entries(s.sets).flatMap(([n, v]) => v.map((x, i) => ({ n, i, t: x.t }))).filter((x) => x.t).sort((a, b) => a.t - b.t);
  const restBefore = new Map(timed.map((x, k) => [`${x.n}#${x.i}`, k ? Math.round((x.t - timed[k - 1].t) / 1000) : null]));
  const prior = priorSessions(sessions, s).sort(byDateDesc);
  const order = s.order?.length ? s.order.map((o) => o.n).filter((n) => s.sets[n]) : [];
  const lifts = [...new Set([...order, ...[...timed].map((x) => x.n), ...Object.keys(s.sets)])];
  lines.push(`Lifts in the order done${timed.length ? " (each set: weight x reps, when it was marked done, rest before it, peak heart rate and what it came down to before the next set)" : ""}:`);
  for (const n of lifts) {
    const v = s.sets[n];
    if (!v?.length) continue;
    const sets = v.map((x, i) => {
      const bits = [];
      if (x.rir != null) bits.push(`RIR ${num(x.rir)}`);
      if (x.t) bits.push(clock(x.t));
      const rest = restBefore.get(`${n}#${i}`);
      if (rest != null) bits.push(`rest ${mmss(rest)}`);
      if (x.hr) bits.push(`HR ${x.hr}${x.hrRest ? `, down to ${x.hrRest}` : ""}`);
      return `${fmtSet(x)}${bits.length ? ` (${bits.join(", ")})` : ""}`;
    });
    let vs = "";
    if (!isCardioSet(v[0])) {
      const last = prior.find((p) => lifting(p.sets[n]).length);
      const now = bestE1rm(v), was = last ? bestE1rm(last.sets[n]) : 0;
      const ever = Math.max(0, ...prior.map((p) => bestE1rm(p.sets[n] || [])));
      vs = last ? `; last time ${last.date}: ${last.sets[n].map(fmtSet).join(", ")} (best e1RM ${Math.round(was)} -> ${Math.round(now)} now${ever ? `, best ever before ${Math.round(ever)}` : ""})` : "; first time logged";
    }
    lines.push(`- ${n}: ${sets.join(", ")}${vs}`);
  }
  // The walkthrough you already gave them on this recap, so a follow-up question can pick it up.
  if (s.walk?.steps?.length) lines.push("Your walkthrough of this workout (what they've read):", ...s.walk.steps.map((x) => `- ${x.title}: ${x.text}`));
  return lines.join("\n");
}

export const HEAD_BUDGET = 30000; // characters, about 8,000 tokens; api/coach.js accepts up to 48,000
export function headContext(args) {
  for (let level = 0; ; level++) {
    const c = headLines(args, DETAIL[level]);
    if (c.length <= HEAD_BUDGET || level === DETAIL.length - 1) return c;
  }
}

function headLines({ sessions, program, weighins, profile, phase, n, entries = [], foodDays = {}, notes, day }, detail) {
  const t = today();
  const ago = (d) => daysBetween(d, t);
  const lines = notes?.length ? notesLines(notes, "Your notes on the lifter") : ["Your notes on the lifter: none yet."];
  const first = [...sessions].sort(byDateAsc)[0];
  if (first) lines.push(`Training history: ${sessions.length} workouts since ${first.date}. The last ${HEAD_DAYS} days are in full; older weeks and months are summarized at the end. Lift trends cover the whole history.`);
  if (profile?.doneAt) lines.push(goalsLine(profile));
  if (phase) lines.push(phaseLine(phase, sessions, weighins));

  // Training, week by week and workout by workout.
  const recent = sessions.filter((s) => ago(s.date) >= 0 && ago(s.date) < HEAD_DAYS).sort(byDateAsc);
  // Four buckets over 30 days: three weeks, then the 9 days before (21-29 days ago).
  const bucket = (daysAgo) => Math.min(3, Math.floor(daysAgo / 7));
  const span = (w) => `${w * 7}-${w === 3 ? HEAD_DAYS - 1 : w * 7 + 6} days ago`;
  const weeks = [0, 1, 2, 3].map((w) => {
    const xs = recent.filter((s) => bucket(ago(s.date)) === w);
    const sets = xs.reduce((a, s) => a + Object.values(s.sets).reduce((b, v) => b + lifting(v).length, 0), 0);
    const vol = xs.reduce((a, s) => a + Object.values(s.sets).reduce((b, v) => b + volume(v), 0), 0);
    return `${span(w)}: ${xs.length} workouts, ${sets} sets, ${compact(vol)} lb volume`;
  });
  lines.push(`Training, last ${HEAD_DAYS} days: ${recent.length} workouts. Week by week: ${weeks.join("; ")}.`);
  const sorted = [...sessions].sort(byDateDesc);
  if (sorted[0]) lines.push(`Last workout: ${program[sorted[0].day]?.name || sorted[0].day}, ${ago(sorted[0].date)} days ago. Next up: ${program[nextDayAfter(sessions, program)].name}.`);
  if (recent.length) lines.push("Every workout in that time (oldest first, best set per lift):", ...recent.slice(-detail.log).map((s) => workoutLine(s, program)));
  const plan = planOf(program);
  const lifts = liftsOf(program).map((x) => [x, describeLift(sessions, plan, x)]);
  const unlogged = lifts.filter(([, d]) => d.endsWith("not logged yet")).map(([x]) => x);
  lines.push("Each lift in the program:", ...lifts.filter(([x]) => !unlogged.includes(x)).map(([, d]) => `- ${d}`));
  if (unlogged.length) lines.push(`Never logged: ${unlogged.join(", ")}.`);
  // Lifts trained before but no longer in the program still count toward "since I started".
  const dropped = [...new Set(sessions.flatMap((x) => Object.keys(x.sets).filter((n) => lifting(x.sets[n]).length)))].filter((n) => !plan[n]);
  lines.push(...progressRanking(sessions, [...liftsOf(program), ...dropped]));

  // Bodyweight over the same 30 days.
  const bw = bodyweightSeries(sessions, weighins);
  const bw30 = bw.filter((x) => ago(x.date) < HEAD_DAYS);
  if (bw30.length > 1) {
    const f = bw30[0], l = bw30[bw30.length - 1], span = Math.max(1, daysBetween(f.date, l.date));
    lines.push(`Bodyweight, last ${HEAD_DAYS} days: ${bw30.slice(-10).map((x) => `${x.date.slice(5)} ${num(x.bw)}`).join(", ")} (${num(l.bw - f.bw)} lb, about ${num(((l.bw - f.bw) / span) * 7)} lb/week).`);
  } else if (bw.length) lines.push(`Bodyweight: ${num(bw[bw.length - 1].bw)} lb on ${bw[bw.length - 1].date}.`);

  // Food: today in full (for edits; the day open on the Nutrition tab instead, when that's another day), then each day and each week over the same 30 days.
  if (n?.targets) {
    lines.push(...todayFood(n, entries, day || t));
    const days = [];
    for (let i = HEAD_DAYS - 1; i >= 1; i--) {
      const d = addDays(t, -i);
      const x = totals(entries.filter((e) => e.date === d));
      days.push({ d, i, ...x, logged: entries.some((e) => e.date === d) });
    }
    lines.push(`Food by day before today (kcal/protein g, - = nothing logged): ${days.map((x) => `${x.d.slice(5)} ${x.logged ? `${Math.round(x.kcal)}/${Math.round(x.protein)}` : "-"}`).join(", ")}.`);
    const fw = [0, 1, 2, 3].map((w) => {
      const xs = days.filter((x) => x.logged && bucket(x.i) === w);
      if (!xs.length) return `${span(w)}: nothing logged`;
      const avg = (k) => Math.round(xs.reduce((a, x) => a + x[k], 0) / xs.length);
      const hit = xs.filter((x) => x.protein >= n.targets.protein * 0.9).length;
      return `${span(w)}: ${xs.length} days logged, avg ${avg("kcal")} kcal, ${avg("protein")} g protein, protein target hit ${hit} days`;
    });
    lines.push(`Food week by week (not counting today): ${fw.join("; ")}.`);
  } else lines.push("Food tracking is off, so there's no food log. They can turn it on in Settings.");

  lines.push("Program (day key (name): lift sets x rep range, rest):", describeProgram(program));
  // Older history last: it's the first to go when the context is trimmed, never the program.
  lines.push(...olderHistory({ sessions, weighins, n: n?.targets ? n : null, entries, foodDays }, detail));
  return lines.join("\n");
}

/**
 * Streams a coach reply. Calls onText with the text so far. Throws an Error whose `kind` is
 * "offline" | "auth" | "unavailable" | "rate" | "empty" | "busy" so the chat can answer in the coach's voice.
 */
const PROPOSAL_MARK = "\u001E"; // must match api/coach.js
const withName = (context, first) => (first ? `Lifter's first name: ${first}.\n${context}` : context);

export async function askCoach({ coach, messages, context, onText, signal, mode, head }) {
  if (!navigator.onLine) throw Object.assign(new Error("offline"), { kind: "offline" });
  const { data } = await supabase.auth.getSession();
  let res;
  try {
    res = await fetch("/api/coach", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` },
      body: JSON.stringify({ coach, mode, head, messages, context: withName(context, data.session?.user?.user_metadata?.first_name) }),
      signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw Object.assign(new Error("offline"), { kind: "offline" });
  }
  if (res.status === 401) throw Object.assign(new Error("auth"), { kind: "auth" });
  if (res.status === 404) throw Object.assign(new Error("unavailable"), { kind: "unavailable" }); // e.g. `vite` dev has no /api
  if (!res.ok || !res.body) throw Object.assign(new Error("busy"), { kind: "busy" });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    onText(raw.split(PROPOSAL_MARK)[0]);
  }
  // Text first, then records after the mark: program-change proposals, food log edits, a meal,
  // tap-to-reply options, and a final status when the reply failed or came back empty
  // ("rate" = a real 429, "empty" = nothing written, "error").
  const [text, ...rest] = raw.split(PROPOSAL_MARK);
  const records = rest.map((line) => { try { return JSON.parse(line.trim()); } catch { return null; } }).filter(Boolean);
  const proposals = records.map((r) => r.changes).filter((c) => Array.isArray(c) && c.length);
  const { status, finish } = records.find((r) => r.status) || {};
  const meal = records.filter((r) => r.meal).map((r) => r.meal).pop() || null;
  const foodEdits = records.map((r) => r.foodEdits).filter((x) => Array.isArray(x) && x.length).flat();
  // The head coach's memory, as the whole new list (null: unchanged).
  const memory = records.filter((r) => Array.isArray(r.memory)).map((r) => r.memory).pop() || null;
  // A workout walkthrough (mode "walk"): its steps, checked by cleanWalk in walkthrough.js.
  const walk = records.filter((r) => r.walk && typeof r.walk === "object").map((r) => r.walk).pop() || null;
  if (!text.trim() && !proposals.length && !meal && !foodEdits.length && !memory && !walk) {
    const kind = status === "rate" ? "rate" : status === "error" ? "busy" : "empty";
    // capped: the model thought until it ran out of room and never answered.
    throw Object.assign(new Error(kind), { kind, capped: finish === "length" });
  }
  const replies = [...new Set(records.flatMap((r) => (Array.isArray(r.replies) ? r.replies : []))
    .filter((x) => typeof x === "string").map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, 3);
  return { text, changes: proposals.flat(), replies, meal, foodEdits, memory, walk };
}

/** What Tank reads to review a program the lifter brought in: their goals, days, and every workout. */
export function reviewContext(program, profile = {}) {
  const goals = (profile.goals || []).map((g) => GOALS.find((x) => x.id === g)?.label).filter(Boolean);
  return [
    `Goals: ${goals.join(", ") || "not given (assume building muscle)"}.`,
    `Trains about ${profile.days || activeDays(program).length} days a week, rotating through the workouts below in order.`,
    "Program (day key (name): lift sets x rep range, rest):",
    describeProgram(program),
  ].join("\n");
}

/**
 * Tank looks over the lifter's own program. Resolves to { text, suggestions } where each suggestion is
 * { change, line, why } and already checked against the program (anything that doesn't match is
 * dropped), so the checklist only offers changes that will apply. Throws like askCoach.
 */
export async function reviewProgram({ coach = "tank", program, profile, onText, signal }) {
  const ask = () => askCoach({
    coach, mode: "review", signal, onText: onText || (() => {}),
    messages: [{ role: "user", content: "I've been running this program. Look it over and suggest anything that would make it better for my goals." }],
    context: reviewContext(program, profile),
  });
  // A blank reply is usually a one-off (long thinking); try once more before giving up.
  const { text, changes } = await ask().catch((e) => (e.kind === "empty" ? ask() : Promise.reject(e)));
  const suggestions = changes.flatMap((change) => {
    const r = applyChanges(program, [change]);
    return r.lines.length ? [{ change, line: r.lines[0], why: typeof change.why === "string" ? change.why.trim() : "" }] : [];
  });
  return { text: text.trim(), suggestions };
}

/**
 * One turn of logging a meal with Tank. `messages` is the conversation so far (the lifter's
 * description, any questions and answers). Resolves { text, replies, meal } where meal is null
 * while Tank still needs amounts, else the checked meal from cleanMeal(). Throws like askCoach.
 */
export async function describeMeal({ coach = "tank", messages, mealSlot, onText, signal }) {
  const ask = () => askCoach({ coach, mode: "food", messages, signal, onText: onText || (() => {}), context: mealSlot ? `Logging to: ${mealSlot}.` : "" });
  // A blank reply is retried once, unless the model ran out of room thinking: then the retry would
  // most likely do the same, and the lifter would wait twice as long for nothing.
  const r = await ask().catch((e) => (e.kind === "empty" && !e.capped ? ask() : Promise.reject(e)));
  return { text: r.text.trim(), replies: r.replies, meal: r.meal ? cleanMeal(r.meal) : null };
}
