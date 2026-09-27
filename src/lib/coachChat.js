import { supabase } from "../supabase-client.js";
import { COACHES, coachFor } from "../data/coaches.js";
import { isCardio, activeDays } from "../data/program.js";
import { describeProgram, applyChanges } from "./programChange.js";
import { GOALS } from "./setup.js";
import { PHASE_TYPES, phaseStatus, statusLine } from "./phase.js";
import { fmtSet, liftSeries, trend, num, fmtW, bestSet, bodyweightSeries, byDateDesc, daysBetween, today, nextDayAfter, readyToIncrease } from "./util.js";

/** A compact, plain-text picture of the lifter for the coach: their lifts, recent bests, trends, bodyweight. */
export function buildContext({ coach, sessions, program, weighins, profile, phase }) {
  const lines = [];
  // A bulk or cut in progress, with the pace read from the weigh-in trend.
  if (phase) {
    const s = phaseStatus(phase, sessions, weighins);
    lines.push(`Current phase: ${PHASE_TYPES[phase.type].label}, week ${s.week} of ${s.weeks}, ${phase.startWeight} -> ${phase.target} lb (planned ${phase.rate} lb/week, ends ${phase.end}). Status: ${statusLine(phase, s)} Advise on food for pace; keep heavy lifts heavy on a cut.`);
  }
  // What the lifter told Tank at setup.
  if (profile?.doneAt) {
    const goals = (profile.goals || []).map((g) => GOALS.find((x) => x.id === g)?.label).filter(Boolean);
    lines.push(`Goals: ${goals.join(", ") || "not given"}. Trains about ${profile.days || "?"} days a week (flexible).` + (profile.note ? ` Lifter's note: ${profile.note}` : ""));
  }
  const sorted = [...sessions].sort(byDateDesc);
  if (sorted[0]) lines.push(`Last workout: ${program[sorted[0].day]?.name || sorted[0].day}, ${daysBetween(sorted[0].date, today())} days ago.`);
  lines.push(`Next up: ${program[nextDayAfter(sessions, program)].name}. Program: ${activeDays(program).map((d) => `${program[d].name} (${program[d].detail})`).join(", ")}.`);

  const lifts = [...new Set(activeDays(program).flatMap((d) => program[d].exercises.map((e) => e.n)))];
  const plan = Object.fromEntries(activeDays(program).flatMap((d) => program[d].exercises.map((e) => [e.n, e])));
  const mine = lifts.filter((n) => coachFor(n) === coach);
  const describe = (n) => {
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
  };
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

/**
 * Streams a coach reply. Calls onText with the text so far. Throws an Error whose `kind` is
 * "offline" | "auth" | "unavailable" | "rate" | "empty" | "busy" so the chat can answer in the coach's voice.
 */
const PROPOSAL_MARK = "\u001E"; // must match api/coach.js
const withName = (context, first) => (first ? `Lifter's first name: ${first}.\n${context}` : context);

export async function askCoach({ coach, messages, context, onText, signal, mode }) {
  if (!navigator.onLine) throw Object.assign(new Error("offline"), { kind: "offline" });
  const { data } = await supabase.auth.getSession();
  let res;
  try {
    res = await fetch("/api/coach", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` },
      body: JSON.stringify({ coach, mode, messages, context: withName(context, data.session?.user?.user_metadata?.first_name) }),
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
  // Text first, then records after the mark: program-change proposals, tap-to-reply options, and a
  // final status when the reply failed or came back empty ("rate" = a real 429, "empty" = nothing written, "error").
  const [text, ...rest] = raw.split(PROPOSAL_MARK);
  const records = rest.map((line) => { try { return JSON.parse(line.trim()); } catch { return null; } }).filter(Boolean);
  const proposals = records.map((r) => r.changes).filter((c) => Array.isArray(c) && c.length);
  const status = records.find((r) => r.status)?.status;
  if (!text.trim() && !proposals.length) {
    const kind = status === "rate" ? "rate" : status === "error" ? "busy" : "empty";
    throw Object.assign(new Error(kind), { kind });
  }
  const replies = [...new Set(records.flatMap((r) => (Array.isArray(r.replies) ? r.replies : []))
    .filter((x) => typeof x === "string").map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, 3);
  return { text, changes: proposals.flat(), replies };
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
export async function reviewProgram({ program, profile, onText, signal }) {
  const ask = () => askCoach({
    coach: "tank", mode: "review", signal, onText: onText || (() => {}),
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
