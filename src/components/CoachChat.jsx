import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bookmark, Check, ListChecks, Utensils } from "lucide-react";
import { BorderBeam } from "border-beam";
import { ThinkingOrb } from "thinking-orbs";
import { Sheet } from "./ui.jsx";
import Coach from "./Coach.jsx";
import { COACHES, coachFor } from "../data/coaches.js";
import { activeDays } from "../data/program.js";
import { askCoach, buildContext } from "../lib/coachChat.js";
import { applyChanges } from "../lib/programChange.js";
import { previewFoodEdits, applyFoodEdits } from "../lib/foodEdit.js";
import { useReducedMotion } from "../lib/motion.js";
import { useTheme } from "../lib/theme.js";
import { cleanNotes } from "../lib/coachThread.js";
import { byDateDesc, bestSet, bestE1rm, cardioTotals, daysBetween, fmtW, num, today } from "../lib/util.js";

/* When the coach can't answer, it still answers in character. */
const TROUBLE = {
  offline: "Can't reach me without a connection. Log your sets, ask me when you're back online.",
  auth: "Lost track of who you are. Sign in again and ask me.",
  unavailable: "Coach chat runs on the deployed app, not this dev server.",
  // A real 429 (a per-model rate limit): it clears on its own after a short wait.
  rate: "Too many questions too fast. Give me a minute, then ask again.",
  // The reply came back blank twice in a row (already retried once, quietly).
  empty: "Lost my train of thought there. Ask me that again.",
  busy: "Couldn't get an answer through. Ask me again in a moment.",
};

/* Failures worth one more tap; the others need the lifter to do something first. */
const TRYABLE = new Set(["rate", "empty", "busy", "offline"]);

/** Starters for food questions, from the Nutrition tab. */
const FOOD_STARTERS = ["What should I eat to hit my protein today?", "How's my eating this week?", "A high-protein snack idea", "Am I eating right for my goal?"];

/* A saved message (coach_messages row) as the chat shows it. A proposal reloaded from history can't
   be applied any more (the program or log may have moved on): it shows as decided or not applied. */
const fromRow = (r) => ({
  id: r.id, role: r.role, content: r.content, coach: r.coach, at: r.created_at,
  preview: r.meta?.preview, what: r.meta?.what, replies: r.meta?.replies, remembered: r.meta?.remembered,
  decision: r.meta?.decision || (r.meta?.preview ? "dismissed" : undefined),
});
const metaOf = (m) => {
  const meta = { preview: m.preview, what: m.what, decision: m.decision, replies: m.replies, remembered: m.remembered };
  return Object.values(meta).some((v) => v !== undefined) ? JSON.parse(JSON.stringify(meta)) : null;
};
// A new visit: the coach says hi again when the last message is this old.
const NEW_VISIT_MS = 6 * 3600_000;
// The lifter's own calendar day for a saved timestamp.
const localDay = (at) => { const d = new Date(at); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
function dayLabel(at) {
  const ago = daysBetween(localDay(at), today());
  return ago <= 0 ? "Today" : ago === 1 ? "Yesterday" : new Date(at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Chat with a coach. Answers stream in; the coach looks locked in while thinking and fired up when it lands.
 * Two kinds:
 * - The head coach (`thread`, from useCoachThread()): one ongoing conversation, saved to the account,
 *   with 30 days of training and food from `buildHead()` and the coach's memory notes. It can propose
 *   program changes and, with `foodLog` (useFood()), edits to today's food log, applied only from the card.
 *   `topic="nutrition"` (from the Nutrition tab) only changes the starters.
 * - A crew coach mid-workout: `exercise` is the lift the chat was opened from; the chat isn't kept.
 *   `notes` (the head coach's memory) and `head` go along so the crew knows what the head coach knows.
 */
export default function CoachChat({ coach, exercise, starter, sessions, program, weighins, profile, phase, nutrition, notes, head, live, topic, foodLog, thread, buildHead, onProgramChange, onClose }) {
  const food = topic === "nutrition";
  const headChat = !!thread;
  const c = COACHES[coach];
  // {id?, role, content, coach?, at?, trouble?, replies?, changes?, ops? (food log edits), what?, preview?: {lines, errors},
  //  decision?: "applied" | "dismissed", remembered?: [notes added]}
  const [messages, setMessages] = useState(() => (thread ? thread.messages.map(fromRow) : []));
  const undos = useRef({}); // message key -> undo for an applied program change or food edit
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("idle"); // idle | thinking | streaming | answered
  const busy = status === "thinking" || status === "streaming";
  const busyRef = useRef(false);
  busyRef.current = busy;
  const reduced = useReducedMotion();
  const theme = useTheme();
  const listRef = useRef(null);
  const abort = useRef(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);
  // The list resizes on every frame while the keyboard animates; stay pinned to the newest
  // message throughout, unless the lifter has scrolled up to reread something.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let pinned = true;
    const onScroll = () => { pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24; };
    const ro = new ResizeObserver(() => { if (pinned) el.scrollTop = el.scrollHeight; });
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    return () => { ro.disconnect(); el.removeEventListener("scroll", onScroll); };
  }, []);
  useEffect(() => {
    if (status !== "answered") return;
    const t = setTimeout(() => setStatus("idle"), 2200);
    return () => clearTimeout(t);
  }, [status]);

  // The saved conversation loads (or another phone adds to it) after the chat opens: take it in
  // between answers, keeping what only this screen has (a proposal's changes, so Apply still works).
  useEffect(() => {
    if (!thread || busyRef.current) return;
    setMessages((ms) => {
      const here = new Map(ms.filter((m) => m.id).map((m) => [m.id, m]));
      const rows = thread.messages.map((r) => {
        const m = here.get(r.id);
        // A proposal made on this screen keeps its changes, and stays open until decided.
        return m && (m.changes || m.ops) ? { ...fromRow(r), changes: m.changes, ops: m.ops, decision: m.decision } : fromRow(r);
      });
      return [...rows, ...ms.filter((m) => m.trouble)];
    });
  }, [thread?.messages]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions = useMemo(() => {
    if (food) return FOOD_STARTERS;
    if (headChat) return [
      "How's my training going?",
      nutrition ? "Am I eating enough for my goal?" : "What should I eat around workouts?",
      "What should I focus on this week?",
      "Adjust my program",
    ];
    const mine = activeDays(program).flatMap((d) => program[d].exercises.map((e) => e.n)).filter((n) => coachFor(n) === coach);
    const lift = exercise || mine[0];
    return [
      lift ? `What's a great mental cue for ${lift}?` : `What's a good ${c.group.toLowerCase()} lift to add?`,
      `How was my last ${c.group.toLowerCase()} work?`,
      // Opened mid-workout (from a lift) the day's focus matters; otherwise, the program does.
      exercise || !onProgramChange ? "What should I focus on today?" : `Adjust my program's ${c.group.toLowerCase()} work`,
    ];
  }, [program, coach, c.group, exercise, onProgramChange, food, headChat, nutrition]);

  // The head coach says hi on a new visit: first time, or hours since the last message.
  const lastAt = [...messages].reverse().find((m) => m.at)?.at;
  const [greeting] = useState(() => {
    if (!headChat) return exercise ? null : hello(coach, sessions);
    const latest = thread.messages[thread.messages.length - 1]?.created_at;
    if (latest && Date.now() - new Date(latest) < NEW_VISIT_MS) return null;
    return food ? "Food questions? Ask me: what to eat, your macros, how your week's going." : hello(coach, sessions, true);
  });
  const greetingShown = !!greeting && !messages.some((m) => m.greeting)
    && (headChat ? !lastAt || Date.now() - new Date(lastAt) >= NEW_VISIT_MS : messages.length === 0);

  const keyOf = (m, i) => m.id || `i${i}`;
  const save = (m) => (thread ? thread.addMessage({ role: m.role, coach: m.coach || coach, content: m.content, meta: metaOf(m), created_at: m.at }) : undefined);

  const send = async (text) => {
    const q = text.trim();
    if (!q || busy) return;
    // The model sees what it proposed earlier and whether the lifter took it, and in the head
    // coach's chat, when each message was said: the conversation spans days.
    const noteFor = (m) => (m.preview?.lines.length ? ` [Proposed: ${m.preview.lines.join("; ")}. Lifter ${m.decision === "applied" ? "applied it" : m.decision === "dismissed" ? "said no" : "hasn't decided"}.]` : "");
    const when = (m) => (headChat && m.at && localDay(m.at) !== today() ? `[${dayLabel(m.at)}] ` : "");
    let base = messages.filter((m) => !m.trouble);
    // The hello becomes part of the conversation once the lifter answers it.
    if (greetingShown && !exercise) {
      // A millisecond before the lifter's answer, so the two never tie on time.
      const g = { role: "assistant", content: greeting, coach, at: new Date(Date.now() - 1).toISOString(), greeting: true };
      g.id = save(g);
      base = [...base, g];
    }
    const userMsg = { role: "user", content: q, coach, at: new Date().toISOString() };
    userMsg.id = save(userMsg);
    const history = [...base, userMsg].slice(headChat ? -16 : -10).map((m) => ({ role: m.role, content: when(m) + m.content + noteFor(m) }));
    setMessages([...base, userMsg, { role: "assistant", content: "", coach }]);
    setDraft("");
    setStatus("thinking");
    busyRef.current = true;
    abort.current = new AbortController();
    const put = (patch) => setMessages((ms) => { const c2 = [...ms]; c2[c2.length - 1] = { ...c2[c2.length - 1], ...patch }; return c2; });
    const ask = () => askCoach({
      coach, head, messages: history, signal: abort.current.signal, mode: headChat ? "head" : undefined,
      context: headChat ? buildHead() : [live, buildContext({ coach, sessions, program, weighins, profile, phase, nutrition, notes })].filter(Boolean).join("\n"),
      onText: (t) => { setStatus("streaming"); put({ content: t }); },
    });
    try {
      // A blank reply is usually a one-off (the model ran long thinking); ask once more before saying so.
      const { text: reply, changes, replies, foodEdits, memory } = await ask().catch((e) => (e.kind === "empty" ? ask() : Promise.reject(e)));
      const done = { role: "assistant", coach, content: reply.trim(), replies, at: new Date().toISOString() };
      if (changes.length && onProgramChange) Object.assign(done, { content: done.content || "Here's the change I'd make.", changes, what: "program", preview: applyChanges(program, changes) });
      else if (foodEdits.length && foodLog) {
        // Checked against the log now; the ops keep entry ids, so Apply hits the same entries later.
        const { ops, lines, errors } = previewFoodEdits(foodLog.entries, foodEdits);
        Object.assign(done, { content: done.content || "Here's the change I'd make.", ops, what: "food", preview: { lines, errors } });
      }
      if (memory && thread) {
        const had = new Set(thread.notes.map((x) => x.toLowerCase()));
        const added = cleanNotes(memory).filter((x) => !had.has(x.toLowerCase()));
        thread.setNotes(memory);
        if (added.length) done.remembered = added;
      }
      if (!done.content) done.content = done.remembered ? "Got it." : "";
      done.id = save(done);
      put(done);
      setStatus("answered");
    } catch (e) {
      if (e.name === "AbortError") return;
      put({ content: TROUBLE[e.kind] || TROUBLE.busy, trouble: true, kind: e.kind, retry: q });
      setStatus("idle");
    }
  };

  const decide = (i, decision) => {
    const m = messages[i];
    setMessages((ms) => ms.map((x, j) => (j === i ? { ...x, decision } : x)));
    if (thread && m.id) thread.updateMessage(m.id, { meta: metaOf({ ...m, decision }) });
  };
  const apply = (i) => {
    const m = messages[i], k = keyOf(m, i);
    if (m.ops) {
      const undo = applyFoodEdits(foodLog, m.ops);
      if (!undo) return;
      undos.current[k] = undo;
      decide(i, "applied");
      return;
    }
    // Re-check against the program as it is now; the lifter may have edited it since the proposal.
    const r = applyChanges(program, m.changes);
    if (!r.lines.length) return;
    undos.current[k] = onProgramChange(r.program);
    decide(i, "applied");
  };
  const undo = (i) => { const k = keyOf(messages[i], i); undos.current[k]?.(); delete undos.current[k]; decide(i, "dismissed"); };

  // Handed a first question (e.g. a lift's "how should this feel"): ask it as soon as the chat opens.
  const asked = useRef(false);
  useEffect(() => {
    if (starter && !asked.current) { asked.current = true; send(starter); }
  }, [starter]); // eslint-disable-line react-hooks/exhaustive-deps

  const mood = status === "thinking" ? "focused" : status === "answered" ? "hyped" : "idle";

  /* Tap-to-reply buttons under the latest answer, so the lifter rarely has to type: the coach's own
     suggestions, else a retry after a failed answer, else the starter questions not yet asked. */
  const last = messages[messages.length - 1];
  const askedAlready = new Set(messages.filter((m) => m.role === "user").map((m) => m.content));
  const unasked = suggestions.filter((x) => !askedAlready.has(x));
  const replies = busy ? []
    : greetingShown && messages.length ? unasked.slice(0, 3)
    : !last || last.role !== "assistant" ? []
    : last.trouble ? (last.retry && TRYABLE.has(last.kind) ? ["Try again"] : [])
    : (last.replies?.length ? last.replies : unasked).slice(0, 3);
  const tapReply = (r) => (r === "Try again" && last?.retry ? send(last.retry) : send(r));

  return (
    <Sheet title={headChat ? c.name : `Ask ${c.name}`} sub={headChat ? "Your head coach" : `${c.group} coach`} onClose={onClose} labelledBy="coach-chat-title" className={"sheet-chat" + (headChat ? " sheet-head-chat" : "")}>
      <div className="chat" style={{ "--c": c.color }}>
        <div className="chat-coach"><Coach id={coach} mood={mood} size={88} /></div>
        <div className="chat-list" ref={listRef} aria-live="polite">
          {messages.map((m, i) => {
            const day = headChat && m.at && localDay(m.at);
            const prevDay = headChat && i > 0 && messages[i - 1].at && localDay(messages[i - 1].at);
            return (
              <React.Fragment key={keyOf(m, i)}>
                {day && day !== prevDay && <p className="chat-day">{dayLabel(m.at)}</p>}
                <p className={m.role === "user" ? "chat-me" : "coach-bubble"} style={m.role !== "user" && m.coach && m.coach !== coach ? { "--c": COACHES[m.coach]?.color } : undefined}>
                  {m.content || (
                    // Fades in only after a beat, so a fast reply never flashes an orb.
                    <span className="chat-wait">
                      <ThinkingOrb state="breathing" size={20} theme={theme} aria-hidden="true" />
                      {c.name} is thinking…
                    </span>
                  )}
                </p>
                {m.remembered && <p className="chat-memory"><Bookmark size={13} strokeWidth={2.6} aria-hidden="true" /> Remembered: {m.remembered.join("; ")}</p>}
                {m.preview && <Proposal preview={m.preview} decision={m.decision} what={m.what || (m.ops ? "food" : "program")}
                  canUndo={!!undos.current[keyOf(m, i)]} onApply={() => apply(i)} onDismiss={() => decide(i, "dismissed")} onUndo={() => undo(i)} />}
              </React.Fragment>
            );
          })}
          {greetingShown && (
            <div className="chat-empty">
              {headChat && lastAt && localDay(lastAt) !== today() && <p className="chat-day">Today</p>}
              <p className="coach-bubble">{greeting}</p>
              {messages.length === 0 && (
                <div className="chat-suggest">
                  {suggestions.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
                </div>
              )}
            </div>
          )}
          {!greetingShown && messages.length === 0 && (
            <div className="chat-empty">
              <p className="coach-bubble">What do you want to know? Ask me anything about your training.</p>
              <div className="chat-suggest">
                {suggestions.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {replies.length > 0 && (
            <div className="chat-suggest chat-replies" role="group" aria-label="Quick replies">
              {replies.map((r) => <button key={r} type="button" className="chip" onClick={() => tapReply(r)}>{r}</button>)}
            </div>
          )}
        </div>
        {/* Line beam from send until the answer finishes; the line type ignores reduced motion, so gate it here. */}
        <BorderBeam size="line" theme={theme} active={busy && !reduced} className="chat-input-wrap">
          <form className="chat-input" aria-busy={busy} onSubmit={(e) => { e.preventDefault(); send(draft); }}>
            <label htmlFor="coach-q" className="sr-only">Your message for {c.name}</label>
            <textarea id="coach-q" rows={1} value={draft} placeholder={headChat ? `Message ${c.name}…` : `Ask ${c.name}…`} maxLength={600}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
            <button type="submit" aria-label="Send" disabled={!draft.trim() || busy}><ArrowUp size={20} strokeWidth={2.8} /></button>
          </form>
        </BorderBeam>
        <p className="chat-note">
          {headChat ? "Knows your last 30 days and what you've told it." : nutrition ? "Answers use your logged sets and food log." : "Answers use your logged sets."} AI can be wrong. Not medical advice.
        </p>
      </div>
    </Sheet>
  );
}

/** How a coach says hi: like a coach who was there, from the last time you trained one of their lifts
    (`any`: the head coach, who watches every lift). */
function hello(coach, sessions, any = false) {
  const mine = (s) => Object.entries(s.sets).filter(([n, v]) => v?.length && (any || coachFor(n) === coach));
  const last = [...sessions].sort(byDateDesc).find((s) => mine(s).length);
  if (!last) return any ? "Ready when you are. Ask me anything about your training or food." : sessions.length ? `We haven't trained together yet. Want to talk ${COACHES[coach].group.toLowerCase()}?` : "What do you want to know? Ask me anything about your training.";
  const d = daysBetween(last.date, today());
  if (d >= 7) return `${d >= 14 ? "Been a while" : "Been about a week"} since ${any ? "your last workout" : "we trained"}. Everything good?`;
  // Their heaviest lift that day, which is usually the one the lifter cares about.
  const [lift, sets] = mine(last).sort((a, b) => bestE1rm(b[1]) - bestE1rm(a[1]))[0];
  const name = lift.replace(/\s*\(.*?\)/g, "");
  const b = bestSet(sets);
  const what = !b ? `${num(cardioTotals(sets).min)}-minute ${name}` : b.w ? `${fmtW(b.w)}×${b.r} on ${name}` : `${b.r} reps of ${name}`;
  if (d <= 0) return `Nice ${what} today. Anything on your mind?`;
  if (d === 1) return `Yesterday's ${what} looked solid. How's the body feeling?`;
  const day = new Date(last.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });
  return `How are you feeling after ${day}'s ${what}?`;
}

const PROPOSAL = {
  program: { icon: ListChecks, label: "Proposed program change", applied: "Program updated" },
  food: { icon: Utensils, label: "Proposed change to today's log", applied: "Food log updated" },
};

/** A coach's proposed program or food log edit. Nothing is saved until the lifter taps Apply; Undo puts it back. */
function Proposal({ preview, decision, what = "program", canUndo = true, onApply, onDismiss, onUndo }) {
  const { lines, errors } = preview;
  const p = PROPOSAL[what];
  return (
    <div className={"proposal" + (decision ? ` ${decision}` : "")} role="group" aria-label={p.label}>
      <span className="proposal-head"><p.icon size={16} strokeWidth={2.6} aria-hidden="true" />
        {decision === "applied" ? p.applied : decision === "dismissed" ? "Not applied" : p.label}</span>
      {lines.length > 0 && <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      {errors.length > 0 && <p className="proposal-skip">{lines.length ? "Skipped: " : "Couldn't apply: "}{errors.join(" ")}</p>}
      {!decision && lines.length > 0 && (
        <div className="proposal-actions">
          <button type="button" className="btn btn-day" onClick={onApply}><Check size={17} strokeWidth={3} aria-hidden="true" /> Apply</button>
          <button type="button" className="btn btn-ghost" onClick={onDismiss}>No thanks</button>
        </div>
      )}
      {decision === "applied" && canUndo && <button type="button" className="proposal-undo" onClick={onUndo}>Undo</button>}
    </div>
  );
}
