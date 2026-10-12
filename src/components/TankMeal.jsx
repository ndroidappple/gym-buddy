import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Utensils, Pencil } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import Coach from "./Coach.jsx";
import { COACHES } from "../data/coaches.js";
import { MEALS } from "../lib/nutrition.js";
import { describeMeal } from "../lib/coachChat.js";
import { useTheme } from "../lib/theme.js";

/* Logging a meal by describing it to Tank. He asks for any amount that matters (with tap-to-answer
   replies, always including "Make your best estimate"), then returns the meal itemized. The card
   shows every item and the total; the lifter can name it, save it to their foods, and add it.
   A correction typed after the card ("it was 2 tbsp") gets a whole new card. */

const TROUBLE = {
  offline: "No connection, so I can't work it out. Enter it manually, or try again when you're back online.",
  auth: "Lost track of who you are. Sign in again.",
  unavailable: "Adding with Tank runs on the deployed app, not this dev server.",
  rate: "Too many requests at once. Give me a minute and try again.",
  empty: "Lost my train of thought. Say it again?",
  busy: "Couldn't get that through. Try again in a moment.",
};
const ESTIMATE = "Make your best estimate";
const SLOW_MS = 20000; // past this, offer manual entry (a slow fallback model can take a minute or more)
const fmt = (n) => Math.round(n).toLocaleString();
const r = (n) => Math.round(n);

/** What the model sees of an earlier card, so a correction edits the same meal. */
const mealNote = (m) => ` [Meal shown: ${m.name}: ${m.items.map((x) => `${x.food} ${x.amount} ${x.kcal} kcal`).join("; ")}.]`;

export default function TankMeal({ meal: slot, onMeal, action, onSave, onManual }) {
  const [messages, setMessages] = useState([]); // { role, content, meal?, replies?, trouble?, retry? }
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [save, setSave] = useState(false); // logged meals show in Your foods anyway; save the ones you repeat
  const [slow, setSlow] = useState(false);
  const listRef = useRef(null);
  const abort = useRef(null);
  const theme = useTheme();
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy, slow]);
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [busy]);

  const last = messages[messages.length - 1];
  const card = [...messages].reverse().find((m) => m.meal)?.meal || null;
  const cardIsLatest = !!last?.meal;

  // `base` is the conversation to continue from (Try again drops the failed turn first).
  const send = async (text, base = messages) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = [...base.filter((m) => !m.trouble).map((m) => ({ role: m.role, content: m.content + (m.meal ? mealNote(m.meal) : "") })), { role: "user", content: q }];
    setMessages([...base, { role: "user", content: q }]);
    setDraft("");
    setBusy(true);
    abort.current = new AbortController();
    try {
      const res = await describeMeal({ messages: history, mealSlot: MEALS.find((m) => m.id === slot)?.label, signal: abort.current.signal });
      if (res.meal) setName(res.meal.name);
      // A question with no suggested answers still gets the estimate button.
      const replies = res.meal ? [] : [...new Set([...(res.replies || []), ESTIMATE])].slice(0, 4);
      setMessages((ms) => [...ms, { role: "assistant", content: res.text || (res.meal ? `Here's your ${res.meal.name.toLowerCase()}.` : "How much of each?"), meal: res.meal, replies }]);
    } catch (e) {
      if (e.name === "AbortError") return;
      setMessages((ms) => [...ms, { role: "assistant", content: TROUBLE[e.kind] || TROUBLE.busy, trouble: true, retry: ["rate", "empty", "busy", "offline"].includes(e.kind) ? q : null }]);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!card) return;
    onSave({ meal: { ...card, name: name.trim() || card.name }, save });
  };

  const chips = !busy && last?.role === "assistant" ? (last.trouble ? (last.retry ? ["Try again"] : []) : last.replies || []) : [];
  const tap = (c) => {
    if (c === "Try again") send(last.retry, messages.slice(0, -2)); // resend without showing it twice
    else send(c);
  };

  return (
    <div className="chat tank-meal" style={{ "--c": COACHES.tank.color }}>
      <div className="chat-list" ref={listRef} aria-live="polite">
        <div className="tank-meal-hello">
          <Coach id="tank" size={44} mood={busy ? "focused" : card && cardIsLatest ? "hyped" : "idle"} decorative />
          <p className="coach-bubble">What did you eat? List everything, with amounts if you know them. I'll ask if I need more.</p>
        </div>
        {messages.map((m, i) => (
          <React.Fragment key={i}>
            <p className={m.role === "user" ? "chat-me" : "coach-bubble"}>{m.content}</p>
            {m.meal && (i === messages.length - 1
              ? <MealCard meal={m.meal} name={name} onName={setName} />
              : <p className="small muted meal-old">Earlier version: {fmt(m.meal.total.kcal)} kcal</p>)}
          </React.Fragment>
        ))}
        {busy && (
          <p className="coach-bubble"><span className="chat-wait"><ThinkingOrb state="breathing" size={20} theme={theme} aria-hidden="true" />Tank is working it out…</span></p>
        )}
        {busy && slow && onManual && (
          <div className="tank-meal-slow">
            <p className="small muted">Taking longer than usual. Keep waiting, or enter it yourself.</p>
            <button type="button" className="chip" onClick={onManual}><Pencil size={14} aria-hidden="true" /> Enter manually</button>
          </div>
        )}
        {chips.length > 0 && (
          <div className="chat-suggest chat-replies" role="group" aria-label="Quick replies">
            {chips.map((c) => <button key={c} type="button" className="chip" onClick={() => tap(c)}>{c}</button>)}
          </div>
        )}
        {card && cardIsLatest && !busy && (
          <div className="tank-meal-save">
            <label className="check-row"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
              <span>Save to my foods<small className="detail">It shows in Your foods for a while anyway. Saving keeps it for good.</small></span></label>
            <div className="setup-choices food-meals" role="group" aria-label="Meal">
              {MEALS.map((m) => <button key={m.id} type="button" className="chip" aria-pressed={slot === m.id} onClick={() => onMeal(m.id)}>{m.label}</button>)}
            </div>
            <button type="button" className="btn btn-ink" onClick={confirm}><Check size={18} strokeWidth={3} aria-hidden="true" /> {action}</button>
            <p className="small muted detail">Something off? Tell Tank below, e.g. "it was 2 tbsp".</p>
          </div>
        )}
      </div>
      <form className="chat-input" aria-busy={busy} onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <label htmlFor="tank-meal-q" className="sr-only">Describe your meal</label>
        <textarea id="tank-meal-q" rows={2} value={draft} maxLength={1000} autoFocus={!messages.length}
          placeholder={messages.length ? "Reply to Tank…" : "e.g. ½ cup oatmeal, 1 tbsp peanut butter, half a small apple, ½ scoop protein"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
        <button type="submit" aria-label="Send" disabled={!draft.trim() || busy}><ArrowUp size={20} strokeWidth={2.8} /></button>
      </form>
    </div>
  );
}

/** Tank's itemized meal: each food with its amount and macros (~ marks an estimate), and the total. */
function MealCard({ meal, name, onName }) {
  const t = meal.total;
  return (
    <div className="proposal meal-card" role="group" aria-label={`${meal.name}: ${fmt(t.kcal)} calories`}>
      <span className="proposal-head"><Utensils size={16} strokeWidth={2.6} aria-hidden="true" />
        <input className="meal-name" value={name} maxLength={60} onChange={(e) => onName(e.target.value)} aria-label="Meal name" />
        <Pencil size={15} aria-hidden="true" className="muted" /></span>
      <ul className="meal-items">
        {meal.items.map((x, i) => (
          <li key={i}>
            <span className="meal-item"><b>{x.food}</b><small>{x.estimated ? "~" : ""}{x.amount} · P {r(x.protein)} · C {r(x.carbs)} · F {r(x.fat)}</small></span>
            <span className="meal-kcal-n">{x.estimated ? "~" : ""}{fmt(x.kcal)}</span>
          </li>
        ))}
      </ul>
      <div className="meal-total">
        <b>{fmt(t.kcal)} kcal</b>
        <span>{r(t.protein)} g protein · {r(t.carbs)} g carbs · {r(t.fat)} g fat</span>
      </div>
      {meal.estimated && <p className="proposal-skip">~ marks Tank's estimates.</p>}
    </div>
  );
}
