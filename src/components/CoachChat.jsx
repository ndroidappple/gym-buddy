import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Sheet } from "./ui.jsx";
import Coach from "./Coach.jsx";
import { COACHES, coachFor } from "../data/coaches.js";
import { DAYS } from "../data/program.js";
import { askCoach, buildContext } from "../lib/coachChat.js";

/* When the coach can't answer, it still answers in character. */
const TROUBLE = {
  offline: "Can't reach me without a connection. Log your sets, ask me when you're back online.",
  auth: "Lost track of who you are. Sign in again and ask me.",
  unavailable: "Coach chat runs on the deployed app, not this dev server.",
  busy: "Catching my breath. Free-tier limit, give me a minute and ask again.",
};

/** Chat with one coach. Answers stream in; the coach looks locked in while thinking and fired up when it lands. */
export default function CoachChat({ coach, sessions, program, weighins, onClose }) {
  const c = COACHES[coach];
  const [messages, setMessages] = useState([]); // {role, content, trouble?}
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("idle"); // idle | thinking | streaming | answered
  const listRef = useRef(null);
  const abort = useRef(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);
  useEffect(() => {
    if (status !== "answered") return;
    const t = setTimeout(() => setStatus("idle"), 2200);
    return () => clearTimeout(t);
  }, [status]);

  const suggestions = useMemo(() => {
    const mine = DAYS.flatMap((d) => program[d].exercises.map((e) => e.n)).filter((n) => coachFor(n) === coach);
    return [
      mine[0] ? `How do I push my ${mine[0]} up?` : `What's a good ${c.group.toLowerCase()} lift to add?`,
      `How was my last ${c.group.toLowerCase()} work?`,
      "What should I focus on today?",
    ];
  }, [program, coach, c.group]);

  const send = async (text) => {
    const q = text.trim();
    if (!q || status === "thinking" || status === "streaming") return;
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
    <Sheet title={`Ask ${c.name}`} sub={`${c.group} coach · answers use your logged sets`} onClose={onClose} labelledBy="coach-chat-title">
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
              {m.content || <span className="chat-dots" aria-label={`${c.name} is thinking`}><i /><i /><i /></span>}
            </p>
          ))}
        </div>
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <label htmlFor="coach-q" className="sr-only">Your question for {c.name}</label>
          <textarea id="coach-q" rows={1} value={draft} placeholder={`Ask ${c.name}…`} maxLength={600}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
          <button type="submit" aria-label="Send" disabled={!draft.trim() || status === "thinking" || status === "streaming"}><ArrowUp size={20} strokeWidth={2.8} /></button>
        </form>
        <p className="chat-note">AI answers can be wrong. Not medical advice.</p>
      </div>
    </Sheet>
  );
}
