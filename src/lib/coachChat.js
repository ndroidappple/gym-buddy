import { supabase } from "../supabase-client.js";
import { COACHES, coachFor } from "../data/coaches.js";
import { DAYS, isCardio } from "../data/program.js";
import { describeProgram } from "./programChange.js";
import { fmtSet, liftSeries, trend, num, fmtW, bestSet, bodyweightSeries, byDateDesc, daysBetween, today, nextDayAfter, readyToIncrease } from "./util.js";

/** A compact, plain-text picture of the lifter for the coach: their lifts, recent bests, trends, bodyweight. */
export function buildContext({ coach, sessions, program, weighins }) {
  const lines = [];
  const sorted = [...sessions].sort(byDateDesc);
  if (sorted[0]) lines.push(`Last workout: ${program[sorted[0].day]?.name || sorted[0].day}, ${daysBetween(sorted[0].date, today())} days ago.`);
  lines.push(`Next up: ${program[nextDayAfter(sessions)].name}. Program: ${DAYS.map((d) => `${program[d].name} (${program[d].detail})`).join(", ")}.`);

  const lifts = [...new Set(DAYS.flatMap((d) => program[d].exercises.map((e) => e.n)))];
  const plan = Object.fromEntries(DAYS.flatMap((d) => program[d].exercises.map((e) => [e.n, e])));
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
 * "offline" | "auth" | "unavailable" | "busy" so the chat can answer in the coach's voice.
 */
const PROPOSAL_MARK = "\u001E"; // must match api/coach.js
const withName = (context, first) => (first ? `Lifter's first name: ${first}.\n${context}` : context);

export async function askCoach({ coach, messages, context, onText, signal }) {
  if (!navigator.onLine) throw Object.assign(new Error("offline"), { kind: "offline" });
  const { data } = await supabase.auth.getSession();
  let res;
  try {
    res = await fetch("/api/coach", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` },
      body: JSON.stringify({ coach, messages, context: withName(context, data.session?.user?.user_metadata?.first_name) }),
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
  // Text first, then each proposed program change on its own line after the mark.
  const [text, ...rest] = raw.split(PROPOSAL_MARK);
  const proposals = rest.map((line) => { try { return JSON.parse(line.trim()).changes; } catch { return null; } })
    .filter((c) => Array.isArray(c) && c.length);
  // Free-tier limits end the stream early with nothing in it.
  if (!text.trim() && !proposals.length) throw Object.assign(new Error("busy"), { kind: "busy" });
  return { text, changes: proposals.flat() };
}
