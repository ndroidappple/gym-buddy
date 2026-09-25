import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { BorderBeam } from "border-beam";
import { ThinkingOrb } from "thinking-orbs";
import { Sheet } from "./ui.jsx";
import Coach from "./Coach.jsx";
import { COACHES, coachFor } from "../data/coaches.js";
import { DAYS } from "../data/program.js";
import { askCoach, buildContext } from "../lib/coachChat.js";
import { useReducedMotion } from "../lib/motion.js";
import { useTheme } from "../lib/theme.js";

/* When the coach can't answer, it still answers in character. */
const TROUBLE = {
  offline: "Can't reach me without a connection. Log your sets, ask me when you're back online.",
  auth: "Lost track of who you are. Sign in again and ask me.",
  unavailable: "Coach chat runs on the deployed app, not this dev server.",
  busy: "Catching my breath. Free-tier limit, give me a minute and ask again.",
};

/** Chat with one coach. Answers stream in; the coach looks locked in while thinking and fired up when it lands.
    `exercise` is the lift the chat was opened from, so the first suggestion is about that lift. */
export default function CoachChat({ coach, exercise, sessions, program, weighins, onClose }) {
  const c = COACHES[coach];
  const [messages, setMessages] = useState([]); // {role, content, trouble?}
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("idle"); // idle | thinking | streaming | answered
  const busy = status === "thinking" || status === "streaming";
  const reduced = useReducedMotion();
  const theme = useTheme();
  const listRef = useRef(null);
  const abort = useRef(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);
  // When the keyboard opens the list gets shorter; keep the newest message in view.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const keep = () => listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    vv.addEventListener("resize", keep);
    return () => vv.removeEventListener("resize", keep);
  }, []);
  useEffect(() => {
    if (status !== "answered") return;
    const t = setTimeout(() => setStatus("idle"), 2200);
    return () => clearTimeout(t);
  }, [status]);

  const suggestions = useMemo(() => {
    const mine = DAYS.flatMap((d) => program[d].exercises.map((e) => e.n)).filter((n) => coachFor(n) === coach);
    const lift = exercise || mine[0];
    return [
      lift ? `What's a great mental cue for ${lift}?` : `What's a good ${c.group.toLowerCase()} lift to add?`,
      `How was my last ${c.group.toLowerCase()} work?`,
      "What should I focus on today?",
    ];
  }, [program, coach, c.group, exercise]);

  const send = async (text) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = [...messages.filter((m) => !m.trouble), { role: "user", content: q }];
    setMessages([...messages, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setDraft("");
    setStatus("thinking");
    abort.current = new AbortController();
    const put = (patch) => setMessages((ms) => { const c2 = [...ms]; c2[c2.length - 1] = { ...c2[c2.length - 1], ...patch }; return c2; });
    try {
      await askCoach({
        coach, messages: history, signal: abort.current.signal,
        context: buildContext({ coach, sessions, program, weighins }),
        onText: (t) => { setStatus("streaming"); put({ content: t }); },
      });
      setStatus("answered");
    } catch (e) {
      if (e.name === "AbortError") return;
      put({ content: TROUBLE[e.kind] || TROUBLE.busy, trouble: true });
      setStatus("idle");
    }
  };

  const mood = status === "thinking" ? "focused" : status === "answered" ? "hyped" : "idle";

  return (
    <Sheet title={`Ask ${c.name}`} sub={`${c.group} coach`} onClose={onClose} labelledBy="coach-chat-title" className="sheet-chat">
      <div className="chat" style={{ "--c": c.color }}>
        <div className="chat-coach"><Coach id={coach} mood={mood} size={88} /></div>
        <div className="chat-list" ref={listRef} aria-live="polite">
          {messages.length === 0 && (
            <div className="chat-empty">
              <p className="coach-bubble">What do you want to know? Ask me anything about your training.</p>
              <div className="chat-suggest">
                {suggestions.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <p key={i} className={m.role === "user" ? "chat-me" : "coach-bubble"}>
              {m.content || (
                // Fades in only after a beat, so a fast reply never flashes an orb.
                <span className="chat-wait">
                  <ThinkingOrb state="breathing" size={20} theme={theme} aria-hidden="true" />
                  {c.name} is thinking…
                </span>
              )}
            </p>
          ))}
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
        <p className="chat-note">Answers use your logged sets. AI can be wrong. Not medical advice.</p>
      </div>
    </Sheet>
  );
}
