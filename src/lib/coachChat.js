import { supabase } from "../supabase-client.js";
import { COACHES, coachFor } from "../data/coaches.js";
import { DAYS } from "../data/program.js";
import { liftSeries, trend, num, fmtW, bestSet, bodyweightSeries, byDateDesc, daysBetween, today, nextDayAfter } from "./util.js";

/** A compact, plain-text picture of the lifter for the coach: their lifts, recent bests, trends, bodyweight. */
export function buildContext({ coach, sessions, program, weighins }) {
  const lines = [];
  const sorted = [...sessions].sort(byDateDesc);
  if (sorted[0]) lines.push(`Last workout: ${program[sorted[0].day]?.name || sorted[0].day}, ${daysBetween(sorted[0].date, today())} days ago.`);
  lines.push(`Next up: ${program[nextDayAfter(sessions)].name}. Program: ${DAYS.map((d) => `${program[d].name} (${program[d].detail})`).join(", ")}.`);

  const lifts = [...new Set(DAYS.flatMap((d) => program[d].exercises.map((e) => e.n)))];
  const mine = lifts.filter((n) => coachFor(n) === coach);
  const describe = (n) => {
    const s = liftSeries(sessions, n);
    if (!s.length) return `${n}: not logged yet`;
    const last = s[s.length - 1];
    const b = bestSet(last.sets);
    const t = trend(s.map((x) => x.orm));
    const rir = last.sets.filter((x) => x.rir != null).map((x) => x.rir);
    return `${n}: last ${last.date} best set ${fmtW(b.w)}x${b.r}, e1RM ${num(last.orm)} lb, ${s.length} sessions` +
      (t != null ? `, trend ${t >= 0 ? "+" : ""}${t.toFixed(1)}%` : "") + (rir.length ? `, RIR ${rir.join("/")}` : "");
  };
  lines.push(`Your lifts (${COACHES[coach].group}):`, ...mine.map((n) => `- ${describe(n)}`));
  const others = lifts.filter((n) => coachFor(n) !== coach).map(describe).filter((x) => !x.endsWith("not logged yet"));
  if (others.length) lines.push("Other lifts:", ...others.slice(0, 12).map((x) => `- ${x}`));

  const bw = bodyweightSeries(sessions, weighins);
  if (bw.length) {
    const f = bw[0], l = bw[bw.length - 1];
    lines.push(`Bodyweight: ${num(l.bw)} lb on ${l.date}` + (bw.length > 1 ? ` (${num(l.bw - f.bw)} lb since ${f.date})` : "") + ".");
  }
  return lines.join("\n");
}

/**
 * Streams a coach reply. Calls onText with the text so far. Throws an Error whose `kind` is
 * "offline" | "auth" | "unavailable" | "busy" so the chat can answer in the coach's voice.
 */
export async function askCoach({ coach, messages, context, onText, signal }) {
  if (!navigator.onLine) throw Object.assign(new Error("offline"), { kind: "offline" });
  const { data } = await supabase.auth.getSession();
  let res;
  try {
    res = await fetch("/api/coach", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` },
      body: JSON.stringify({ coach, messages, context }),
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
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
  // Free-tier limits end the stream early with nothing in it.
  if (!text.trim()) throw Object.assign(new Error("busy"), { kind: "busy" });
  return text;
}
