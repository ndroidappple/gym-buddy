import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, ListChecks, Utensils } from "lucide-react";
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

/** Chat with one coach. Answers stream in; the coach looks locked in while thinking and fired up when it lands.
    `exercise` is the lift the chat was opened from, so the first suggestion is about that lift. */
/** Starters for the nutrition chat, from the Nutrition tab. */
const FOOD_STARTERS = ["What should I eat to hit my protein today?", "How's my eating this week?", "A high-protein snack idea", "Am I eating right for my goal?"];

/** `topic="nutrition"`: Tank as the nutrition coach, from the Nutrition tab, with `foodContext` as his data.
    With `foodLog` (useFood()), he can propose edits to today's log, applied only from the card. */
export default function CoachChat({ coach, exercise, starter, sessions, program, weighins, profile, phase, nutrition, live, topic, foodContext, foodLog, onProgramChange, onClose }) {
  const food = topic === "nutrition";
  const c = COACHES[coach];
  // {role, content, trouble?, replies?, changes?, ops? (food log edits), preview?: {lines, errors}, decision?: "applied" | "dismissed"}
  const [messages, setMessages] = useState([]);
  const undos = useRef({}); // message index -> undo for an applied program change or food edit
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("idle"); // idle | thinking | streaming | answered
  const busy = status === "thinking" || status === "streaming";
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

  const suggestions = useMemo(() => {
    if (food) return FOOD_STARTERS;
    const mine = activeDays(program).flatMap((d) => program[d].exercises.map((e) => e.n)).filter((n) => coachFor(n) === coach);
    const lift = exercise || mine[0];
    return [
      lift ? `What's a great mental cue for ${lift}?` : `What's a good ${c.group.toLowerCase()} lift to add?`,
      `How was my last ${c.group.toLowerCase()} work?`,
      // Opened mid-workout (from a lift) the day's focus matters; from Meet your coaches, the program does.
      exercise || !onProgramChange ? "What should I focus on today?" : `Adjust my program's ${c.group.toLowerCase()} work`,
      // Tank runs the program as a whole, so renaming workouts is his to offer.
      ...(coach === "tank" && onProgramChange && !exercise ? ["Rename my workouts"] : []),
    ];
  }, [program, coach, c.group, exercise, onProgramChange, food]);

  const send = async (text) => {
    const q = text.trim();
    if (!q || busy) return;
    // The model sees what it proposed earlier and whether the lifter took it.
    const noteFor = (m) => (m.preview?.lines.length ? ` [Proposed: ${m.preview.lines.join("; ")}. Lifter ${m.decision === "applied" ? "applied it" : m.decision === "dismissed" ? "said no" : "hasn't decided"}.]` : "");
    const history = [...messages.filter((m) => !m.trouble).map((m) => ({ role: m.role, content: m.content + noteFor(m) })), { role: "user", content: q }];
    setMessages([...messages, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setDraft("");
    setStatus("thinking");
    abort.current = new AbortController();
    const put = (patch) => setMessages((ms) => { const c2 = [...ms]; c2[c2.length - 1] = { ...c2[c2.length - 1], ...patch }; return c2; });
    const ask = () => askCoach({
      coach, messages: history, signal: abort.current.signal, mode: food ? "nutrition" : undefined,
      context: food ? foodContext : [live, buildContext({ coach, sessions, program, weighins, profile, phase, nutrition })].filter(Boolean).join("\n"),
      onText: (t) => { setStatus("streaming"); put({ content: t }); },
    });
    try {
      // A blank reply is usually a one-off (the model ran long thinking); ask once more before saying so.
      const { text: reply, changes, replies, foodEdits } = await ask().catch((e) => (e.kind === "empty" ? ask() : Promise.reject(e)));
      if (changes.length && onProgramChange) {
        put({ content: reply.trim() || "Here's the change I'd make.", changes, preview: applyChanges(program, changes), replies });
      } else if (foodEdits.length && foodLog) {
        // Checked against the log now; the ops keep entry ids, so Apply hits the same entries later.
        const { ops, lines, errors } = previewFoodEdits(foodLog.entries, foodEdits);
        put({ content: reply.trim() || "Here's the change I'd make.", ops, preview: { lines, errors }, replies });
      } else put({ replies });
      setStatus("answered");
    } catch (e) {
      if (e.name === "AbortError") return;
      put({ content: TROUBLE[e.kind] || TROUBLE.busy, trouble: true, kind: e.kind, retry: q });
      setStatus("idle");
    }
  };

  const decide = (i, decision) => setMessages((ms) => ms.map((m, j) => (j === i ? { ...m, decision } : m)));
  const apply = (i) => {
    if (messages[i].ops) {
      const undo = applyFoodEdits(foodLog, messages[i].ops);
      if (!undo) return;
      undos.current[i] = undo;
      decide(i, "applied");
      return;
    }
    // Re-check against the program as it is now; the lifter may have edited it since the proposal.
    const r = applyChanges(program, messages[i].changes);
    if (!r.lines.length) return;
    undos.current[i] = onProgramChange(r.program);
    decide(i, "applied");
  };
  const undo = (i) => { undos.current[i]?.(); delete undos.current[i]; decide(i, "dismissed"); };

  // Handed a first question (e.g. Tank reading the setup note): ask it as soon as the chat opens.
  const asked = useRef(false);
  useEffect(() => {
    if (starter && !asked.current) { asked.current = true; send(starter); }
  }, [starter]); // eslint-disable-line react-hooks/exhaustive-deps

  const mood = status === "thinking" ? "focused" : status === "answered" ? "hyped" : "idle";

  /* Tap-to-reply buttons under the latest answer, so the lifter rarely has to type: the coach's own
     suggestions, else a retry after a failed answer, else the starter questions not yet asked. */
  const last = messages[messages.length - 1];
  const askedAlready = new Set(messages.filter((m) => m.role === "user").map((m) => m.content));
  const replies = !last || last.role !== "assistant" || busy ? []
    : last.trouble ? (last.retry && TRYABLE.has(last.kind) ? ["Try again"] : [])
    : (last.replies?.length ? last.replies : suggestions.filter((x) => !askedAlready.has(x))).slice(0, 3);
  const tapReply = (r) => (r === "Try again" && last?.retry ? send(last.retry) : send(r));

  return (
    <Sheet title={`Ask ${c.name}`} sub={food ? "Nutrition coach" : `${c.group} coach`} onClose={onClose} labelledBy="coach-chat-title" className="sheet-chat">
      <div className="chat" style={{ "--c": c.color }}>
        <div className="chat-coach"><Coach id={coach} mood={mood} size={88} /></div>
        <div className="chat-list" ref={listRef} aria-live="polite">
          {messages.length === 0 && (
            <div className="chat-empty">
              <p className="coach-bubble">{food ? "Food questions? Ask me: what to eat, your macros, how your week's going." : "What do you want to know? Ask me anything about your training."}</p>
              <div className="chat-suggest">
                {suggestions.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <React.Fragment key={i}>
              <p className={m.role === "user" ? "chat-me" : "coach-bubble"}>
                {m.content || (
                  // Fades in only after a beat, so a fast reply never flashes an orb.
                  <span className="chat-wait">
                    <ThinkingOrb state="breathing" size={20} theme={theme} aria-hidden="true" />
                    {c.name} is thinking…
                  </span>
                )}
              </p>
              {m.preview && <Proposal preview={m.preview} decision={m.decision} what={m.ops ? "food" : "program"}
                onApply={() => apply(i)} onDismiss={() => decide(i, "dismissed")} onUndo={() => undo(i)} />}
            </React.Fragment>
          ))}
          {replies.length > 0 && (
            <div className="chat-suggest chat-replies" role="group" aria-label="Quick replies">
              {replies.map((r) => <button key={r} type="button" className="chip" onClick={() => tapReply(r)}>{r}</button>)}
            </div>
          )}
        </div>
        {/* Line beam from send until the answer finishes; the line type ignores reduced motion, so gate it here. */}
        <BorderBeam size="line" theme={theme} active={busy && !reduced} className="chat-input-wrap">
          <form className="chat-input" aria-busy={busy} onSubmit={(e) => { e.preventDefault(); send(draft); }}>
            <label htmlFor="coach-q" className="sr-only">Your question for {c.name}</label>
            <textarea id="coach-q" rows={1} value={draft} placeholder={`Ask ${c.name}…`} maxLength={600}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
            <button type="submit" aria-label="Send" disabled={!draft.trim() || busy}><ArrowUp size={20} strokeWidth={2.8} /></button>
          </form>
        </BorderBeam>
        <p className="chat-note">{food ? "Answers use your food log and targets." : "Answers use your logged sets."} AI can be wrong. Not medical advice.</p>
      </div>
    </Sheet>
  );
}

const PROPOSAL = {
  program: { icon: ListChecks, label: "Proposed program change", applied: "Program updated" },
  food: { icon: Utensils, label: "Proposed change to today's log", applied: "Food log updated" },
};

/** A coach's proposed program or food log edit. Nothing is saved until the lifter taps Apply; Undo puts it back. */
function Proposal({ preview, decision, what = "program", onApply, onDismiss, onUndo }) {
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
      {decision === "applied" && <button type="button" className="proposal-undo" onClick={onUndo}>Undo</button>}
    </div>
  );
}
