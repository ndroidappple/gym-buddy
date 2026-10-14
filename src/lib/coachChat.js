import { supabase } from "../supabase-client.js";
import { COACHES, coachFor } from "../data/coaches.js";
import { isCardio, activeDays } from "../data/program.js";
import { describeProgram, applyChanges } from "./programChange.js";
import { GOALS } from "./setup.js";
import { cleanMeal, todayFood, totals, addDays } from "./nutrition.js";
import { PHASE_TYPES, phaseStatus, statusLine } from "./phase.js";
import { fmtSet, liftSeries, trend, num, fmtW, bestSet, bodyweightSeries, byDateAsc, byDateDesc, daysBetween, today, nextDayAfter, readyToIncrease, compact, lifting, volume } from "./util.js";

/** One lift for the coach: its plan, latest best set, e1RM trend, RIR, and whether it's earned more weight. */
function describeLift(sessions, plan, n) {
  if (isCardio(n)) {
    const logs = [...sessions].sort(byDateDesc).filter((x) => x.sets[n]?.length);
    return logs.length ? `${n}: last ${logs[0].date} ${logs[0].sets[n].map(fmtSet).join(" + ")}, ${logs.length} sessions` : `${n}: not logged yet`;
  }
  const s = liftSeries(sessions, n);
  if (!s.length) return `${n}: not logged yet`;
  const last = s[s.length - 1];
  const b = bestSet(last.sets);
  const t = trend(s.map((x) => x.orm));
  const rir = last.sets.filter((x) => x.rir != null).map((x) => x.rir);
  const up = readyToIncrease(plan[n], last.sets);
  const target = plan[n] ? `plan ${plan[n].sets}x${plan[n].reps[0]}-${plan[n].reps[1]}, ` : "";
  return `${n}: ${target}last ${last.date} best set ${fmtW(b.w)}x${b.r}, e1RM ${num(last.orm)} lb, ${s.length} sessions` +
    (t != null ? `, trend ${t >= 0 ? "+" : ""}${t.toFixed(1)}%` : "") + (rir.length ? `, RIR ${rir.join("/")}` : "") +
    (up ? `, READY TO ADD WEIGHT (hit ${up.sets}x${up.reps} at ${up.from} lb; next: ${up.to} lb)` : "");
}
const planOf = (program) => Object.fromEntries(activeDays(program).flatMap((d) => program[d].exercises.map((e) => [e.n, e])));
const liftsOf = (program) => [...new Set(activeDays(program).flatMap((d) => program[d].exercises.map((e) => e.n)))];
/** A workout as one line: each lift's best set (cardio: what was logged). */
function workoutLine(s, program) {
  const done = Object.entries(s.sets).filter(([, v]) => v?.length).map(([n, v]) => {
    const b = bestSet(v);
    return b ? `${n} ${fmtW(b.w)}x${b.r} (${lifting(v).length} sets)` : `${n} ${v.map(fmtSet).join(" + ")}`;
  });
  return `- ${s.date} ${program[s.day]?.name || s.day}: ${done.join(", ") || "nothing logged"}`;
}
function phaseLine(phase, sessions, weighins) {
  const s = phaseStatus(phase, sessions, weighins);
  return `Current phase: ${PHASE_TYPES[phase.type].label}, week ${s.week} of ${s.weeks}, ${phase.startWeight} -> ${phase.target} lb (planned ${phase.rate} lb/week, ends ${phase.end}). Status: ${statusLine(phase, s)} Advise on food for pace; keep heavy lifts heavy on a cut.`;
}
function goalsLine(profile) {
  const goals = (profile.goals || []).map((g) => GOALS.find((x) => x.id === g)?.label).filter(Boolean);
  return `Goals: ${goals.join(", ") || "not given"}. Trains about ${profile.days || "?"} days a week (flexible).` + (profile.note ? ` Lifter's note: ${profile.note}` : "");
}
const notesLines = (notes, whose) => (notes?.length ? [`${whose} (kept between chats):`, ...notes.map((n) => `- ${n}`)] : []);

/** A compact, plain-text picture of the lifter for a crew coach: their lifts, recent bests, trends, bodyweight.
    `notes` are the head coach's memory of the lifter, so the crew knows about a bad knee too. */
export function buildContext({ coach, sessions, program, weighins, profile, phase, nutrition, notes }) {
  const lines = [...notesLines(notes, "Head coach's notes on the lifter")];
  // Food tracking, when it's on: targets, today so far, the week.
  if (nutrition) lines.push(nutrition);
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
      ...sorted.slice(0, 5).map((s) => workoutLine(s, program)));
  }
  lines.push(`Next up: ${program[nextDayAfter(sessions, program)].name}. Program: ${activeDays(program).map((d) => `${program[d].name} (${program[d].detail})`).join(", ")}.`);

  const lifts = liftsOf(program);
  const plan = planOf(program);
  const mine = lifts.filter((n) => coachFor(n) === coach);
  const describe = (n) => describeLift(sessions, plan, n);
  lines.push(`Your lifts (${COACHES[coach].group}):`, ...mine.map((n) => `- ${describe(n)}`));
  const others = lifts.filter((n) => coachFor(n) !== coach).map(describe).filter((x) => !x.endsWith("not logged yet"));
  if (others.length) lines.push("Other lifts:", ...others.slice(0, 12).map((x) => `- ${x}`));

  const bw = bodyweightSeries(sessions, weighins);
  if (bw.length) {
    const f = bw[0], l = bw[bw.length - 1];
    lines.push(`Bodyweight: ${num(l.bw)} lb on ${l.date}` + (bw.length > 1 ? ` (${num(l.bw - f.bw)} lb since ${f.date})` : "") + ".");
  }
  // Every day's lifts with their plan, so the coach can propose edits by exact day key and name.
  lines.push("Program (day key (name): lift sets x rep range, rest):", describeProgram(program));
  return lines.join("\n");
}

export const HEAD_DAYS = 30;

/**
 * What the head coach reads: the last 30 days of training and food side by side, so trends across
 * both show (protein short in the weeks a lift stalled, fewer workouts, weight off pace), plus
 * every lift's trend, bodyweight, today's food numbered for edits, the program, and the coach's
 * own notes from earlier chats. `n` is prefs.nutrition (null when food tracking is off).
 */
export function headContext({ sessions, program, weighins, profile, phase, n, entries = [], notes }) {
  const t = today();
  const ago = (d) => daysBetween(d, t);
  const lines = notes?.length ? notesLines(notes, "Your notes on the lifter") : ["Your notes on the lifter: none yet."];
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
  if (recent.length) lines.push("Every workout in that time (oldest first, best set per lift):", ...recent.slice(-24).map((s) => workoutLine(s, program)));
  const plan = planOf(program);
  const lifts = liftsOf(program).map((x) => [x, describeLift(sessions, plan, x)]);
  const unlogged = lifts.filter(([, d]) => d.endsWith("not logged yet")).map(([x]) => x);
  lines.push("Each lift in the program:", ...lifts.filter(([x]) => !unlogged.includes(x)).map(([, d]) => `- ${d}`));
  if (unlogged.length) lines.push(`Never logged: ${unlogged.join(", ")}.`);

  // Bodyweight over the same 30 days.
  const bw = bodyweightSeries(sessions, weighins);
  const bw30 = bw.filter((x) => ago(x.date) < HEAD_DAYS);
  if (bw30.length > 1) {
    const f = bw30[0], l = bw30[bw30.length - 1], span = Math.max(1, daysBetween(f.date, l.date));
    lines.push(`Bodyweight, last ${HEAD_DAYS} days: ${bw30.slice(-10).map((x) => `${x.date.slice(5)} ${num(x.bw)}`).join(", ")} (${num(l.bw - f.bw)} lb, about ${num(((l.bw - f.bw) / span) * 7)} lb/week).`);
  } else if (bw.length) lines.push(`Bodyweight: ${num(bw[bw.length - 1].bw)} lb on ${bw[bw.length - 1].date}.`);

  // Food: today in full (for edits), then each day and each week over the same 30 days.
  if (n?.targets) {
    lines.push(...todayFood(n, entries));
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
  if (!text.trim() && !proposals.length && !meal && !foodEdits.length && !memory) {
    const kind = status === "rate" ? "rate" : status === "error" ? "busy" : "empty";
    // capped: the model thought until it ran out of room and never answered.
    throw Object.assign(new Error(kind), { kind, capped: finish === "length" });
  }
  const replies = [...new Set(records.flatMap((r) => (Array.isArray(r.replies) ? r.replies : []))
    .filter((x) => typeof x === "string").map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, 3);
  return { text, changes: proposals.flat(), replies, meal, foodEdits, memory };
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
