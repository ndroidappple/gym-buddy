import React, { useMemo, useRef, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { Plus, Search, ChevronRight, ChevronLeft, ArrowUp } from "lucide-react";
import { Sheet } from "./ui.jsx";
import Coach from "./Coach.jsx";
import { COACHES } from "../data/coaches.js";
import { LIBRARY, specLine } from "../data/program.js";
import { readLiftQuery, rankLifts, liftMatch } from "../lib/liftQuery.js";
import { suggestLifts } from "../lib/coachChat.js";
import { useTheme } from "../lib/theme.js";

/* Adding a lift: one box, the same as Add food's. A lift's name searches the library and the lifter's
   own plan. What they want in words ("something for upper chest, no bench", "rows I can do at home")
   is understood on the phone (lib/liftQuery.js): the coach's face takes the box's icon, chips show
   what it read, and the best fits are listed with why. Return (or the coach's row) asks the head coach,
   who answers with lifts to tap, for what the phone can't read, like a sore joint; a follow-up goes in
   the box at the bottom, like any chat, and Back at the top returns to the list.
   Calls onPick({ n, sets, reps, rest, cue }). `known`: lifts from the lifter's plan, searched too.
   `context`: what the coach reads about the workout it's for. */

const TROUBLE = {
  offline: "No connection, so I can't think it through. Pick from the list, or try again online.",
  auth: "Lost track of who you are. Sign in again.",
  unavailable: "Asking the coach runs on the deployed app, not this dev server.",
  rate: "Too many requests at once. Give it a minute.",
  empty: "Couldn't come up with lifts for that. Say it another way?",
  busy: "Couldn't get that through. Try again in a moment.",
};

export default function ExercisePicker({ title, sub, existingNames, onPick, onClose, coach = "tank", known = [], context = "" }) {
  const who = COACHES[coach]?.name || "Tank";
  const [q, setQ] = useState("");
  const [more, setMore] = useState(""); // a follow-up to the coach, typed at the bottom
  const [custom, setCustom] = useState(null);
  const [ai, setAi] = useState(null); // { asked, status: loading | done | error, text, lifts, kind }
  const input = useRef(null);
  const abort = useRef(null);
  const theme = useTheme();

  // The library and the lifter's own plan, once each, minus what's already in this workout.
  const lifts = useMemo(() => {
    const taken = new Set(existingNames);
    const seen = new Set();
    return [...LIBRARY, ...known.map((e) => ({ ...e, g: "Your plan" }))]
      .filter((e) => !taken.has(e.n) && !seen.has(e.n.toLowerCase()) && seen.add(e.n.toLowerCase()));
  }, [existingNames, known]);
  const isName = useMemo(() => q.trim() && lifts.some((e) => liftMatch(e, q) >= 2), [lifts, q]);
  const read = useMemo(() => readLiftQuery(q, { known: isName }), [q, isName]);
  const describing = !ai && read.kind === "describe";
  const fits = useMemo(() => (describing ? rankLifts(lifts, read) : []), [describing, lifts, read]);
  const grouped = useMemo(() => {
    if (describing || ai) return {};
    const t = q.trim();
    const m = {};
    lifts.filter((e) => !t || liftMatch(e, t) > 0).sort((a, b) => (t ? liftMatch(b, t) - liftMatch(a, t) : 0)).forEach((e) => { (m[e.g] ||= []).push(e); });
    return m;
  }, [lifts, q, describing, ai]);

  const ask = (text) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setAi({ asked: text, status: "loading" });
    setMore("");
    input.current?.blur();
    const lib = lifts.map((e) => e.n).join(", ");
    suggestLifts({ coach, text, taken: existingNames, signal: ctl.signal, context: [context, `Already in this workout: ${existingNames.join(", ") || "nothing yet"}.`, `Library and their plan: ${lib}.`].filter(Boolean).join("\n") })
      .then((r) => setAi({ asked: text, status: "done", text: r.text, lifts: r.lifts }))
      .catch((e) => { if (e.name !== "AbortError") setAi({ asked: text, status: "error", kind: e.kind }); });
  };
  const stop = () => { abort.current?.abort(); setAi(null); };
  const submit = (e) => {
    e.preventDefault();
    if (describing) return ask(read.text);
    input.current?.blur();
  };
  // A follow-up builds on what was asked: "no machines either" means the same ask, narrowed.
  const followUp = (e) => {
    e.preventDefault();
    if (more.trim() && ai?.status !== "loading") ask(`${ai.asked}. ${more.trim()}`);
  };
  const pick = (e) => onPick({ n: e.n, sets: e.sets, reps: e.reps, rest: e.rest, cue: e.cue || "" });

  if (custom) return <CustomLift custom={custom} setCustom={setCustom} existingNames={existingNames} onPick={onPick} onClose={onClose} />;

  const busy = ai?.status === "loading";
  const box = (
    <form className="food-search" role="search" onSubmit={submit}>
      {describing ? <span className="food-search-coach" aria-hidden="true"><Coach id={coach} size={22} still decorative /></span> : <Search size={18} aria-hidden="true" />}
      <label htmlFor="lift-search" className="sr-only">Search lifts, or describe what you want</label>
      <input id="lift-search" ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
        placeholder="Search or describe a lift" enterKeyHint={describing ? "send" : "search"} />
    </form>
  );
  const row = (e, why) => (
    <button key={e.n} className="lib-row" onClick={() => pick(e)}>
      <span style={{ flex: 1 }}><span className="name">{e.n}</span><span className="sub">{why ? `${why} · ` : ""}{specLine(e)}</span></span>
      <Plus size={18} aria-hidden="true" />
    </button>
  );

  return (
    <Sheet title={title} sub={sub} onClose={onClose} className="sheet-tall">
      {ai
        ? <button type="button" className="btn-quiet food-back" onClick={stop}><ChevronLeft size={16} aria-hidden="true" /> Back to the list</button>
        : <div className="food-box">{box}</div>}

      {/* What the phone understood, then the library's best fits for it, each with why. */}
      {describing && (
        <>
          {read.chips.length > 0 && (
            <div className="meal-chips lift-chips" aria-label="Understood as">
              {read.chips.map((c, k) => <span key={k} className={"meal-chip" + (c.avoid ? " avoid" : " own")}>{c.text}</span>)}
            </div>
          )}
          {fits.length > 0 && (
            <div className="section">
              <div className="lbl group-lbl">Best fits</div>
              {fits.map(({ e, why }) => row(e, why.join(" · ")))}
            </div>
          )}
          <button type="button" className={"tank-row" + (fits.length ? "" : " lead")} onClick={() => ask(read.text)}>
            <Coach id={coach} size={fits.length ? 28 : 34} still decorative />
            <span className="tank-row-text">
              <b>{fits.length ? `Ask ${who} for more ideas` : `Ask ${who}`}</b>
              <small>{fits.length ? "Return asks. Good for a sore joint or a feel you're after." : `${who} picks lifts for what you described. Return asks.`}</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" className="muted" />
          </button>
        </>
      )}

      {/* The coach's picks, right here under the box. */}
      {ai && (
        <div className="lift-ai" aria-live="polite">
          <p className="chat-me">{ai.asked}</p>
          {ai.status === "loading" && <p className="coach-bubble"><span className="chat-wait"><ThinkingOrb state="breathing" size={20} theme={theme} aria-hidden="true" />{who} is picking lifts…</span></p>}
          {ai.status === "error" && (
            <>
              <p className="coach-bubble">{TROUBLE[ai.kind] || TROUBLE.busy}</p>
              <button type="button" className="chip" onClick={() => ask(ai.asked)}>Try again</button>
            </>
          )}
          {ai.status === "done" && (
            <>
              {ai.text && <p className="coach-bubble" style={{ "--c": COACHES[coach]?.color }}>{ai.text}</p>}
              <div className="section">
                {ai.lifts.map((e) => row(e, e.why))}
              </div>
            </>
          )}
          {/* A follow-up, at the bottom like any chat. */}
          <form className="chat-input lift-reply" onSubmit={followUp} aria-busy={busy}>
            <label htmlFor="lift-more" className="sr-only">Say more to {who}</label>
            <input id="lift-more" className="lift-reply-input" value={more} onChange={(e) => setMore(e.target.value)} placeholder="Say more, e.g. no machines either" autoComplete="off" enterKeyHint="send" />
            <button type="submit" aria-label="Send" disabled={!more.trim() || busy}><ArrowUp size={20} strokeWidth={2.8} /></button>
          </form>
        </div>
      )}

      {!describing && !ai && (
        <>
          {Object.keys(grouped).length === 0 && <p className="muted small" style={{ textAlign: "center", padding: "16px 0" }}>Nothing in the library matches <q>{q.trim()}</q>.</p>}
          {Object.entries(grouped).map(([g, items]) => (
            <div key={g} className="section">
              <div className="lbl group-lbl">{g}</div>
              {items.map((e) => row(e))}
            </div>
          ))}
          {q.trim() && (
            <button type="button" className="tank-row" onClick={() => ask(q.trim())}>
              <Coach id={coach} size={28} still decorative />
              <span className="tank-row-text"><b>Ask {who} about <q>{q.trim()}</q></b><small>Say what you want and {who} picks lifts for it.</small></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
          )}
        </>
      )}

      {!ai && (
        <button className="btn btn-ink" onClick={() => setCustom({ n: describing ? "" : q.trim(), sets: 3, min: 8, max: 12, rest: 90, cue: "" })}>
          <Plus size={18} aria-hidden="true" /> {q.trim() && !describing ? `Create "${q.trim()}"` : "Create your own"}
        </button>
      )}
    </Sheet>
  );
}

/** A lift of the lifter's own, with its defaults. */
function CustomLift({ custom, setCustom, existingNames, onPick, onClose }) {
  const valid = custom.n.trim() && !existingNames.includes(custom.n.trim());
  const set = (k) => (e) => setCustom({ ...custom, [k]: e.target.value });
  return (
    <Sheet title="New exercise" sub="Set your defaults. You can change them later in Settings." onClose={onClose}>
      <label className="field"><span className="lbl">Exercise name</span>
        <input id="custom-name" className="input" value={custom.n} onChange={set("n")} placeholder="e.g. Smith Machine Row" /></label>
      <div className="grid-4">
        {[["sets", "Sets"], ["min", "Min reps"], ["max", "Max reps"], ["rest", "Rest (sec)"]].map(([k, l]) => (
          <label key={k} className="field"><span className="lbl">{l}</span>
            <input id={`custom-${k}`} className="input tn" type="number" inputMode="numeric" value={custom[k]} onChange={set(k)} /></label>
        ))}
      </div>
      <label className="field"><span className="lbl">Cue (optional)</span>
        <input id="custom-cue" className="input" value={custom.cue} onChange={set("cue")} placeholder="Form reminder you want to see mid-set" /></label>
      <div className="btn-row">
        <button className="btn btn-ghost" onClick={() => setCustom(null)}>Back</button>
        <button className="btn btn-ink" disabled={!valid} onClick={() => onPick({
          n: custom.n.trim(),
          sets: Math.max(1, parseInt(custom.sets) || 3),
          reps: [parseInt(custom.min) || 8, parseInt(custom.max) || 12],
          rest: Math.max(15, parseInt(custom.rest) || 90),
          cue: custom.cue.trim(),
        })}>Add</button>
      </div>
    </Sheet>
  );
}
