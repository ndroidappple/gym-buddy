import React, { useEffect, useRef, useState } from "react";
import { Check, Utensils, Pencil, BadgeCheck, RotateCcw } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import Coach from "./Coach.jsx";
import { COACHES } from "../data/coaches.js";
import { MEALS } from "../lib/nutrition.js";
import { describeMeal } from "../lib/coachChat.js";
import { useTheme } from "../lib/theme.js";

/* The head coach's answer to a meal described in Add food's search box, shown on the search page
   itself, like an AI overview above search results: it builds in place (what was understood, then the
   coach working, then the itemized meal and its total), asks there when an amount matters (with
   tap-to-answer replies, always "Make your best estimate"), and logs with one tap. Corrections and
   additions are follow-ups from the box at the bottom of the sheet (`follow`), each giving a whole
   new card. Labels: a named product's numbers come from its label; the lifter's own foods are theirs. */

const TROUBLE = {
  offline: "No connection, so I can't work it out. Pick from your foods below, or try again when you're back online.",
  auth: "Lost track of who you are. Sign in again.",
  unavailable: "Describing a meal runs on the deployed app, not this dev server.",
  rate: "Too many requests at once. Give me a minute and try again.",
  empty: "Lost my train of thought. Say it again?",
  busy: "Couldn't get that through. Try again in a moment.",
};
const ESTIMATE = "Make your best estimate";
const SLOW_MS = 20000; // past this, offer manual entry (a slow fallback model can take a minute or more)
const fmt = (n) => Math.round(n).toLocaleString();
const r = (n) => Math.round(n);

/** What the model sees of an earlier card, so a correction edits the same meal. */
const mealNote = (m) => ` [Meal shown: ${m.name}: ${m.items.map((x) => `${x.food} ${x.amount} ${x.kcal} kcal${x.label ? ` (label: ${x.label})` : ""}`).join("; ")}.]`;

/**
 * One described meal and its follow-ups. ask(text, known) starts over with a new description;
 * follow(text) corrects or adds to it; reset() drops it. `known`: the lifter's own foods it mentions
 * ("Name: amount = numbers"), so the coach uses theirs. Returns the state the card shows:
 * { asked, status: idle | working | meal | asking | trouble, meal, question, replies, slow, ... }.
 */
export function useMealAnswer({ coach = "tank", mealSlot }) {
  const [messages, setMessages] = useState([]); // { role, content, meal?, replies?, trouble?, retry? }
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [asked, setAsked] = useState("");
  const known = useRef([]);
  const abort = useRef(null);
  const seen = useRef(new Map()); // first answers by what was asked: typing back to it doesn't ask again
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [busy]);

  const send = async (text, base) => {
    const q = text.trim();
    if (!q) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const history = [...base.filter((m) => !m.trouble).map((m) => ({ role: m.role, content: m.content + (m.meal ? mealNote(m.meal) : "") })), { role: "user", content: q }];
    setMessages([...base, { role: "user", content: q }]);
    setBusy(true);
    try {
      const res = await describeMeal({ coach, messages: history, mealSlot, known: known.current, signal: ctl.signal });
      // A question with no suggested answers still gets the estimate button.
      const replies = res.meal ? [] : [...new Set([...(res.replies || []), ESTIMATE])].slice(0, 4);
      const reply = { role: "assistant", content: res.text || (res.meal ? "" : "How much of each?"), meal: res.meal, replies };
      if (!base.length) seen.current.set(q, [{ role: "user", content: q }, reply]);
      setMessages((ms) => [...ms, reply]);
    } catch (e) {
      if (e.name === "AbortError") return;
      setMessages((ms) => [...ms, { role: "assistant", content: TROUBLE[e.kind] || TROUBLE.busy, trouble: true, retry: ["rate", "empty", "busy", "offline"].includes(e.kind) ? q : null }]);
    } finally {
      if (abort.current === ctl) setBusy(false);
    }
  };

  const last = messages[messages.length - 1];
  const meal = [...messages].reverse().find((m) => m.meal)?.meal || null;
  const status = !asked ? "idle" : busy ? "working" : last?.trouble ? "trouble" : last?.meal ? "meal" : last?.role === "assistant" ? "asking" : "working";
  return {
    asked, status, slow, meal, earlier: busy ? meal : null,
    text: last?.role === "assistant" ? last.content : "",
    replies: status === "asking" ? last.replies || [] : [],
    canRetry: status === "trouble" && !!last.retry,
    ask: (text, k = []) => {
      const q = text.trim();
      known.current = k;
      setAsked(q);
      if (seen.current.has(q)) { abort.current?.abort(); setBusy(false); setMessages(seen.current.get(q)); } else send(q, []);
    },
    follow: (text) => send(text, messages),
    retry: () => send(last.retry, messages.slice(0, -2)),
    reset: () => { abort.current?.abort(); setBusy(false); setMessages([]); setAsked(""); },
  };
}

/* Quick refinements under a finished meal, like suggested follow-ups: its size, and leaving out the
   smallest extra (the butter, the sauce) when there's more than a couple of things in it. */
export function refinements(meal) {
  if (!meal) return [];
  const extra = meal.items.length > 2 ? [...meal.items].sort((a, b) => a.kcal - b.kcal)[0] : null;
  return ["Bigger portion", "Smaller portion", extra && `No ${extra.food.toLowerCase()}`].filter(Boolean);
}

/**
 * The answer card. `a`: useMealAnswer's state; `pending`: something new is typed and about to be asked,
 * so it shows as working; `items`: what was understood while typing ({ amount, label, own } chips),
 * shown while it works; `action`: the Add button's words; `onAdd({ meal, save })`; `onManual`;
 * `onFollow(text)`: a reply or a refinement.
 */
export function MealAnswer({ a, pending = false, coach = "tank", items = [], action, onAdd, onManual, onFollow }) {
  const who = COACHES[coach].name;
  const theme = useTheme();
  const [name, setName] = useState("");
  const [save, setSave] = useState(false); // logged meals show in Your foods anyway; save the ones you repeat
  useEffect(() => { if (a.meal) setName(a.meal.name); }, [a.meal]);
  const working = pending || a.status === "working";
  const updating = working && !pending && a.earlier; // a follow-up: the meal so far stays, dimmed, until the new one
  return (
    <section className={"answer" + (working ? " working" : "")} aria-live="polite" aria-busy={working} style={{ "--c": COACHES[coach].color }}>
      <header className="answer-head">
        <Coach id={coach} size={26} mood={working ? "focused" : a.status === "meal" ? "hyped" : "idle"} still decorative />
        <b>{who}</b>
        {working && <span className="answer-state"><ThinkingOrb state="breathing" size={20} theme={theme} aria-hidden="true" />{updating ? "Updating" : "Working it out"}</span>}
      </header>

      {updating && <div className="answer-stale" aria-hidden="true"><MealCard meal={a.earlier} who={who} name={name} /></div>}
      {working && !updating && (
        // What was understood, then the meal's shape forming: rows that shimmer where the items will go.
        <>
          {items.length > 0 && (
            <div className="meal-chips" aria-label="Understood as">{items.map((it, k) => (
              <span key={k} className={"meal-chip" + (it.own ? " own" : "")}>
                {it.own && <Check size={12} strokeWidth={3} aria-hidden="true" />}{it.amount && <b>{it.amount}</b>}{it.label}
              </span>
            ))}</div>
          )}
          <div className="answer-skel" aria-hidden="true">{items.slice(0, 4).concat(items.length ? [] : [0, 1]).map((_, k) => <i key={k} />)}<i className="answer-skel-total" /></div>
          {a.slow && onManual && <button type="button" className="btn-quiet food-manual" onClick={onManual}><Pencil size={14} aria-hidden="true" /> Taking a while. Enter it yourself</button>}
        </>
      )}

      {!working && a.status === "asking" && (
        <>
          <p className="answer-text">{a.text}</p>
          <div className="answer-chips" role="group" aria-label="Quick replies">
            {a.replies.map((c) => <button key={c} type="button" className="chip" onClick={() => onFollow(c)}>{c}</button>)}
          </div>
        </>
      )}

      {!working && a.status === "trouble" && (
        <>
          <p className="answer-text">{a.text}</p>
          {a.canRetry && <button type="button" className="chip" onClick={a.retry}><RotateCcw size={14} aria-hidden="true" /> Try again</button>}
        </>
      )}

      {!working && a.status === "meal" && a.meal && (
        <>
          {a.text && <p className="answer-text">{a.text}</p>}
          <MealCard meal={a.meal} who={who} name={name} onName={setName} />
          <button type="button" className="btn btn-ink answer-add" onClick={() => onAdd({ meal: { ...a.meal, name: name.trim() || a.meal.name }, save })}>
            <Check size={18} strokeWidth={3} aria-hidden="true" /> {action}
          </button>
          <div className="answer-foot">
            <div className="answer-chips" role="group" aria-label="Change it">
              {refinements(a.meal).map((c) => <button key={c} type="button" className="chip" onClick={() => onFollow(c)}>{c}</button>)}
            </div>
            <label className="answer-save"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Save to my foods</label>
          </div>
        </>
      )}
    </section>
  );
}

/** The coach's itemized meal: each food with its amount and macros (~ marks an estimate), and the total. */
function MealCard({ meal, who, name, onName }) {
  const t = meal.total;
  return (
    <div className="meal-card" role="group" aria-label={`${meal.name}: ${fmt(t.kcal)} calories`}>
      <span className="proposal-head"><Utensils size={16} strokeWidth={2.6} aria-hidden="true" />
        {onName ? <input className="meal-name" value={name} maxLength={60} onChange={(e) => onName(e.target.value)} aria-label="Meal name" /> : <b className="meal-name">{name || meal.name}</b>}
        {onName && <Pencil size={15} aria-hidden="true" className="muted" />}</span>
      <ul className="meal-items">
        {meal.items.map((x, i) => (
          <li key={i}>
            <span className="meal-item"><span className="meal-item-name"><b>{x.food}</b>
              {x.label && <small className="meal-label"><BadgeCheck size={13} strokeWidth={2.6} aria-hidden="true" /> {x.label === "your food" ? "Your food" : `Label: ${x.label}`}</small>}</span>
              <small>{x.estimated ? "~" : ""}{x.amount} · P {r(x.protein)} · C {r(x.carbs)} · F {r(x.fat)}</small></span>
            <span className="meal-kcal-n">{x.estimated ? "~" : ""}{fmt(x.kcal)}</span>
          </li>
        ))}
      </ul>
      <div className="meal-total">
        <b>{fmt(t.kcal)} kcal</b>
        <span>{r(t.protein)} g protein · {r(t.carbs)} g carbs · {r(t.fat)} g fat{meal.estimated ? ` · ~ ${who}'s estimate` : ""}</span>
      </div>
    </div>
  );
}

export { MEALS };
