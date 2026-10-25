import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bookmark, Check, ChevronRight, History, ListChecks, SquarePen, Utensils } from "lucide-react";
import { BorderBeam } from "border-beam";
import { ThinkingOrb } from "thinking-orbs";
import { Sheet } from "./ui.jsx";
import Coach from "./Coach.jsx";
import { COACHES, coachFor } from "../data/coaches.js";
import { activeDays } from "../data/program.js";
import { askCoach, buildContext, workoutFocus } from "../lib/coachChat.js";
import { applyChanges } from "../lib/programChange.js";
import { previewFoodEdits, applyFoodEdits } from "../lib/foodEdit.js";
import { useReducedMotion } from "../lib/motion.js";
import { useTheme } from "../lib/theme.js";
import { cleanNotes } from "../lib/coachThread.js";
import { daysBetween, today, shortDate } from "../lib/util.js";

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
  id: r.id, role: r.role, content: r.content, coach: r.coach, at: r.created_at, chat: r.meta?.chat,
  preview: r.meta?.preview, what: r.meta?.what, replies: r.meta?.replies, remembered: r.meta?.remembered,
  decision: r.meta?.decision || (r.meta?.preview ? "dismissed" : undefined),
});
const metaOf = (m) => {
  const meta = { chat: m.chat, preview: m.preview, what: m.what, decision: m.decision, replies: m.replies, remembered: m.remembered };
  return Object.values(meta).some((v) => v !== undefined) ? JSON.parse(JSON.stringify(meta)) : null;
};
// The lifter's own calendar day for a saved timestamp.
const localDay = (at) => { const d = new Date(at); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
function dayLabel(at) {
  const ago = daysBetween(localDay(at), today());
  return ago <= 0 ? "Today" : ago === 1 ? "Yesterday" : new Date(at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Chat with a coach. Answers stream in; the coach looks locked in while thinking and fired up when it lands.
 * Two kinds:
 * - The head coach (`thread`, from useCoachThread()): chats saved to the account. It opens on the
 *   chat still going (a message within the hour), else a new one; past chats are a tap away. The coach
 *   sees the open chat, 30 days of training and food from `buildHead()`, and its memory notes. It can propose
 *   program changes and, with `foodLog` (useFood()), edits to the food log, applied only from the card.
 *   `topic="nutrition"` (from the Nutrition tab) changes the starters, and `day` is the date open there:
 *   the coach reads that day's log and edits go to it.
 *   `workout` (a session, from its recap) puts that workout in full at the top of what the coach reads
 *   (every set, rest and heart rate: workoutFocus), and the starters ask about it.
 * - A crew coach mid-workout: `exercise` is the lift the chat was opened from; the chat isn't kept.
 *   `notes` (the head coach's memory) and `head` go along so the crew knows what the head coach knows.
 */
export default function CoachChat({ coach, name, exercise, starter, sessions, program, weighins, profile, phase, nutrition, notes, head, live, topic, foodLog, thread, buildHead, day, workout, recovery, onProgramChange, onClose }) {
  const food = topic === "nutrition";
  const hi = () => hello(name, food ? "food" : workout ? "workout" : null);
  const headChat = !!thread;
  const c = COACHES[coach];
  // {id?, role, content, coach?, at?, trouble?, replies?, changes?, ops? (food log edits), what?, preview?: {lines, errors},
  //  decision?: "applied" | "dismissed", remembered?: [notes added]}
  // The head coach chat on screen (null: a new one, given an id when the first message is saved).
  const [chatId, setChatIdState] = useState(() => thread?.chatId ?? null);
  const chatRef = useRef(chatId);
  const setChatId = (id) => { chatRef.current = id; setChatIdState(id); };
  const rowsOf = (id) => (id && thread?.chats.find((x) => x.id === id)?.messages) || [];
  const [messages, setMessages] = useState(() => (thread ? rowsOf(chatId).map(fromRow) : []));
  const [past, setPast] = useState(false); // the past chats list in place of the chat
  const undos = useRef({}); // message key -> undo for an applied program change or food edit
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("idle"); // idle | thinking | streaming | answered
  const busy = status === "thinking" || status === "streaming";
  const busyRef = useRef(false);
  busyRef.current = busy;
  const reduced = useReducedMotion();
  const theme = useTheme();
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const abort = useRef(null);
  // Scrolled up to reread: new messages don't yank the list down, and a button jumps back.
  const pinned = useRef(true);
  const [away, setAway] = useState(false);
  const toEnd = (smooth) => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: smooth && !reduced ? "smooth" : "auto" });
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { if (pinned.current) toEnd(); }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps
  // The list resizes on every frame while the keyboard animates; stay pinned to the newest
  // message throughout, unless the lifter has scrolled up to reread something.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Only the lifter's own scrolling unpins. Ours fires a scroll event too, and by the time it runs
    // the list has shrunk again (it does every frame while the keyboard comes up), which would read
    // as scrolling away from the bottom.
    let ours = -1;
    const onScroll = () => {
      if (Math.abs(el.scrollTop - ours) < 2) return;
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      pinned.current = gap < 24;
      setAway(gap > 240);
    };
    const ro = new ResizeObserver(() => {
      if (!pinned.current) return;
      el.scrollTop = el.scrollHeight;
      ours = el.scrollTop;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    return () => { ro.disconnect(); el.removeEventListener("scroll", onScroll); };
  }, []);
  // The message box grows with what's typed, up to about five lines, then scrolls.
  useLayoutEffect(() => {
    const t = inputRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 132)}px`;
  }, [draft]);
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
      const rows = rowsOf(chatRef.current).map((r) => {
        const m = here.get(r.id);
        // A proposal made on this screen keeps its changes, and stays open until decided.
        return m && (m.changes || m.ops) ? { ...fromRow(r), changes: m.changes, ops: m.ops, decision: m.decision } : fromRow(r);
      });
      return [...rows, ...ms.filter((m) => m.trouble)];
    });
  }, [thread?.messages, chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions = useMemo(() => {
    if (food) return FOOD_STARTERS;
    if (workout) {
      const timed = Object.values(workout.sets).some((v) => v.some((x) => x.t));
      const hr = workout.hr && !workout.hr.none;
      return [
        "How did this workout go?",
        hr ? "Which lift pushed me hardest?" : "Where did I improve on last time?",
        timed ? "Were my rests long enough?" : "Where can I add weight next time?",
        "What should I change next time?",
      ];
    }
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
  }, [program, coach, c.group, exercise, onProgramChange, food, headChat, nutrition, workout]);

  // The coach says hi to start a chat (not a crew chat opened from a lift).
  const [greeting, setGreeting] = useState(() => (exercise ? null : hi()));
  const greetingShown = !!greeting && messages.length === 0;

  /* A fresh chat, or one from the past list (sending in it carries it on). */
  const startChat = () => {
    if (busy) return;
    setChatId(thread.newChat());
    setMessages([]);
    setGreeting(hi());
    setPast(false);
    setDraft("");
  };
  const openChat = (id) => {
    setChatId(thread.openChat(id));
    setMessages(rowsOf(id).map(fromRow));
    pinned.current = true;
    setPast(false);
  };

  const keyOf = (m, i) => m.id || `i${i}`;
  const save = (m) => {
    if (!thread) return undefined;
    m.chat = chatRef.current;
    return thread.addMessage({ role: m.role, coach: m.coach || coach, content: m.content, meta: metaOf(m), created_at: m.at });
  };

  const send = async (text) => {
    const q = text.trim();
    if (!q || busy) return;
    // The model sees what it proposed earlier and whether the lifter took it, and in the head
    // coach's chat, when each message was said: the conversation spans days.
    const noteFor = (m) => (m.preview?.lines.length ? ` [Proposed: ${m.preview.lines.join("; ")}. Lifter ${m.decision === "applied" ? "applied it" : m.decision === "dismissed" ? "said no" : "hasn't decided"}.]` : "");
    const when = (m) => (headChat && m.at && localDay(m.at) !== today() ? `[${dayLabel(m.at)}] ` : "");
    let base = messages.filter((m) => !m.trouble);
    if (headChat && !chatRef.current) setChatId(thread.newChat());
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
    pinned.current = true; // what was just sent is what they want to see
    setMessages([...base, userMsg, { role: "assistant", content: "", coach }]);
    setDraft("");
    setStatus("thinking");
    busyRef.current = true;
    abort.current = new AbortController();
    const put = (patch) => setMessages((ms) => { const c2 = [...ms]; c2[c2.length - 1] = { ...c2[c2.length - 1], ...patch }; return c2; });
    const ask = () => askCoach({
      coach, head, messages: history, signal: abort.current.signal, mode: headChat ? "head" : undefined,
      context: headChat ? [workout && workoutFocus(workout, sessions, program, recovery), buildHead(day)].filter(Boolean).join("\n\n")
        : [live, buildContext({ coach, sessions, program, weighins, profile, phase, nutrition, notes, recovery })].filter(Boolean).join("\n"),
      onText: (t) => { setStatus("streaming"); put({ content: t }); },
    });
    try {
      // A blank reply is usually a one-off (the model ran long thinking); ask once more before saying so.
      const { text: reply, changes, replies, foodEdits, memory } = await ask().catch((e) => (e.kind === "empty" ? ask() : Promise.reject(e)));
      const done = { role: "assistant", coach, content: reply.trim(), replies, at: new Date().toISOString() };
      if (changes.length && onProgramChange) Object.assign(done, { content: done.content || "Here's the change I'd make.", changes, what: "program", preview: applyChanges(program, changes) });
      else if (foodEdits.length && foodLog) {
        // Checked against the log now; the ops keep entry ids, so Apply hits the same entries later.
        const date = day || today();
        const { ops, lines, errors } = previewFoodEdits(foodLog.entries, foodEdits, foodLog.foods, date);
        Object.assign(done, { content: done.content || "Here's the change I'd make.", ops, what: "food", preview: { lines, errors, ...(date !== today() ? { day: date } : {}) } });
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

  // Tapping the conversation puts the keyboard away, like iMessage, so there's more to read.
  const dismiss = (e) => {
    if (e.target.closest("button, a, input, textarea, label")) return;
    if (document.activeElement === inputRef.current) inputRef.current.blur();
  };
  const note = `${headChat ? "Knows your training and food history, and what you've told it." : nutrition ? "Answers use your logged sets and food log." : "Answers use your logged sets."} AI can be wrong. Not medical advice.`;
  const empty = messages.length === 0;

  return (
    <Sheet title={headChat ? c.name : `Ask ${c.name}`} sub={headChat ? (past ? "Past chats" : "Your head coach") : `${c.group} coach`} onClose={onClose} labelledBy="coach-chat-title"
      actions={headChat && (
        <>
          <button type="button" className="icon-btn" onClick={() => setPast(!past)} aria-pressed={past} aria-label={past ? "Back to the chat" : "Past chats"}><History size={20} /></button>
          <button type="button" className="icon-btn" onClick={startChat} disabled={busy || (!past && empty)} aria-label="New chat"><SquarePen size={20} /></button>
        </>
      )}
      lead={<span className="chat-head-coach" style={{ "--c": c.color }}><Coach id={coach} mood={mood} size={40} /></span>}
      className={"sheet-chat sheet-convo" + (headChat ? " sheet-head-chat" : "")} focusField={false} dragFromHead>
      {past ? <PastChats chats={thread.chats} open={chatId} coachName={c.name} onOpen={openChat} /> : (
      <div className="chat" style={{ "--c": c.color }}>
        <div className="chat-list" ref={listRef} aria-live="polite" onPointerDown={dismiss}>
          {/* The footnote leads the conversation and scrolls away with it, instead of taking room by the keyboard. */}
          <p className="chat-note">{note}</p>
          {empty && <div className="chat-hero" aria-hidden="true"><Coach id={coach} mood={mood} size={96} /></div>}
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
          {greetingShown && <p className="coach-bubble">{greeting}</p>}
          {!greetingShown && empty && <p className="coach-bubble">What do you want to know? Ask me anything about your training.</p>}
        </div>
        <div className="chat-dock">
          {away && (
            <button type="button" className="chat-jump" onClick={() => { pinned.current = true; toEnd(true); }} aria-label="Jump to the latest message">
              <ArrowDown size={18} strokeWidth={2.8} />
            </button>
          )}
          {/* Tap-to-reply in one row that scrolls sideways, so it never crowds out the conversation;
              out of the way while typing. On a first visit it holds the starter questions. */}
          {(empty ? suggestions : replies).length > 0 && !busy && !draft.trim() && (
            <div className="chat-replies" role="group" aria-label={empty ? "Suggested questions" : "Quick replies"}>
              {(empty ? suggestions : replies).map((r) => <button key={r} type="button" className="chip" onClick={() => (empty ? send(r) : tapReply(r))}>{r}</button>)}
            </div>
          )}
          {/* Line beam from send until the answer finishes; the line type ignores reduced motion, so gate it here. */}
          <BorderBeam size="line" theme={theme} active={busy && !reduced} className="chat-input-wrap">
            <form className="chat-input" aria-busy={busy} onSubmit={(e) => { e.preventDefault(); send(draft); }}>
              <label htmlFor="coach-q" className="sr-only">Your message for {c.name}</label>
              <textarea id="coach-q" ref={inputRef} rows={1} value={draft} placeholder={headChat ? `Message ${c.name}…` : `Ask ${c.name}…`} maxLength={600}
                enterKeyHint="send" autoComplete="off"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
              <button type="submit" aria-label="Send" disabled={!draft.trim() || busy}><ArrowUp size={20} strokeWidth={2.8} /></button>
            </form>
          </BorderBeam>
        </div>
      </div>
      )}
    </Sheet>
  );
}

/** The head coach's chats from the last 30 days, newest first. Opening one carries it on. */
function PastChats({ chats, open, coachName, onOpen }) {
  const list = [...chats].sort((a, b) => b.end.localeCompare(a.end));
  const time = (at) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!list.length) return <p className="note-box">No past chats yet. Chats are kept for 30 days.</p>;
  return (
    <div className="chat-past">
      <div className="list">
        {list.map((x) => {
          const first = x.messages.find((m) => m.role === "user") || x.messages[0];
          return (
            <button key={x.id} type="button" className="list-row" onClick={() => onOpen(x.id)} aria-current={x.id === open || undefined}>
              <span className="name"><span className="chat-past-title">{first.content}</span>
                <span className="sub">{x.id === open ? "Open now · " : ""}{dayLabel(x.end)}, {time(x.end)} · {x.messages.length} message{x.messages.length === 1 ? "" : "s"}</span>
              </span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
          );
        })}
      </div>
      <p className="small muted chat-past-note">Chats are kept for 30 days. What {coachName} remembers about you stays either way.</p>
    </div>
  );
}

/* How a coach says hi: casual, like texting a coach you know, with the lifter's first name when
   there is one. One is picked per visit so it doesn't read the same every time. */
const HELLOS = [
  (n) => `How can I help${n}?`,
  (n) => `Hey${n}. What's on your mind?`,
  (n) => `What can I do for you${n}?`,
  (n) => `Hey${n}, what are we working on?`,
  (n) => `What's up${n}?`,
  (n) => `Talk to me${n}. What do you need?`,
];
const FOOD_HELLOS = [
  (n) => `Hey${n}. What can I help you with food-wise?`,
  (n) => `Hungry${n}? Ask me anything about food.`,
  (n) => `What are we eating${n}?`,
];
const WORKOUT_HELLOS = [
  (n) => `Ask me anything about this workout${n}.`,
  (n) => `Good work${n}. What do you want to know about this one?`,
  (n) => `Let's look at this workout${n}. What's on your mind?`,
];
const PART_OF_DAY = (h) => (h < 5 ? null : h < 12 ? "Morning" : h < 17 ? null : "Evening");
/** The coach's hello: `kind` "food" (Nutrition), "workout" (a recap) or none. */
function hello(name, kind = null) {
  const n = name ? `, ${name}` : "";
  const pool = kind === "food" ? FOOD_HELLOS : kind === "workout" ? WORKOUT_HELLOS : HELLOS;
  const line = pool[Math.floor(Math.random() * pool.length)](n);
  // Now and then, the time of day leads instead: "Morning, Nick. How can I help?"
  const part = PART_OF_DAY(new Date().getHours());
  return !kind && part && Math.random() < 0.3 ? `${part}${n}. How can I help?` : line;
}

const PROPOSAL = {
  program: { icon: ListChecks, label: "Proposed program change", applied: "Program updated" },
  food: { icon: Utensils, label: "Proposed change to today's log", applied: "Food log updated" },
};

/** A coach's proposed program or food log edit. Nothing is saved until the lifter taps Apply; Undo puts it back. */
function Proposal({ preview, decision, what = "program", canUndo = true, onApply, onDismiss, onUndo }) {
  const { lines, errors } = preview;
  // A food edit to a day other than today names the day.
  const p = what === "food" && preview.day ? { ...PROPOSAL.food, label: `Proposed change to ${shortDate(preview.day)}'s log` } : PROPOSAL[what];
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
