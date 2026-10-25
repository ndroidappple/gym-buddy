import React, { useEffect, useMemo, useRef, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { Plus, Search, ChevronRight, ArrowUp, RotateCcw } from "lucide-react";
import { Sheet } from "./ui.jsx";
import Coach from "./Coach.jsx";
import { COACHES } from "../data/coaches.js";
import { LIBRARY, specLine } from "../data/program.js";
import { readLiftQuery, rankLifts, liftMatch } from "../lib/liftQuery.js";
import { suggestLifts } from "../lib/coachChat.js";
import { useTheme } from "../lib/theme.js";

/* Adding a lift: one box, the same as Add food's. A lift's name searches the library and the lifter's
   own plan. What they want in words ("something for upper chest, no bench", "rows I can do at home")
   is understood on the phone (lib/liftQuery.js): the coach's face takes the box's icon, and once typing
   pauses the head coach's picks build in place under the box, like an AI overview, with the library's
   best fits (each with why) below them. The coach handles what the phone can't read, like a sore joint;
   a follow-up ("no machines either") goes in the box at the bottom once there are picks to change.
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
const AUTO_MS = 900; // a description is asked about once typing pauses this long (Return asks at once)

export default function ExercisePicker({ title, sub, existingNames, onPick, onClose, coach = "tank", known = [], context = "" }) {
  const who = COACHES[coach]?.name || "Tank";
  const [q, setQ] = useState("");
  const [more, setMore] = useState(""); // a follow-up to the coach, typed at the bottom
  const [typing, setTyping] = useState(false); // the box at the top has the keyboard
  const [custom, setCustom] = useState(null);
  // The coach's picks: { base: the box's text they answer, asked, status: loading | done | error, text, lifts, kind, prev }
  const [ai, setAi] = useState(null);
  const input = useRef(null);
  const abort = useRef(null);
  const seen = useRef(new Map()); // picks by what was asked: typing back to it doesn't ask again
  const theme = useTheme();
  useEffect(() => () => abort.current?.abort(), []);

  // The library and the lifter's own plan, once each, minus what's already in this workout.
  const lifts = useMemo(() => {
    const taken = new Set(existingNames);
    const seenNames = new Set();
    return [...LIBRARY, ...known.map((e) => ({ ...e, g: "Your plan" }))]
      .filter((e) => !taken.has(e.n) && !seenNames.has(e.n.toLowerCase()) && seenNames.add(e.n.toLowerCase()));
  }, [existingNames, known]);
  const isName = useMemo(() => q.trim() && lifts.some((e) => liftMatch(e, q) >= 2), [lifts, q]);
  const read = useMemo(() => readLiftQuery(q, { known: isName }), [q, isName]);
  const describing = read.kind === "describe";
  const fits = useMemo(() => (describing ? rankLifts(lifts, read) : []), [describing, lifts, read]);
  const grouped = useMemo(() => {
    if (describing) return {};
    const t = q.trim();
    const m = {};
    lifts.filter((e) => !t || liftMatch(e, t) > 0).sort((a, b) => (t ? liftMatch(b, t) - liftMatch(a, t) : 0)).forEach((e) => { (m[e.g] ||= []).push(e); });
    return m;
  }, [lifts, q, describing]);

  // `base`: the box's text these picks answer; a follow-up keeps it and asks the whole thing, narrowed.
  const ask = (text, base = text) => {
    abort.current?.abort();
    if (seen.current.has(text)) { setAi({ ...seen.current.get(text), base }); return; }
    const ctl = new AbortController();
    abort.current = ctl;
    setAi((cur) => ({ base, asked: text, status: "loading", prev: cur?.base === base && cur.status === "done" ? cur : null }));
    const lib = lifts.map((e) => e.n).join(", ");
    suggestLifts({ coach, text, taken: existingNames, signal: ctl.signal, context: [context, `Already in this workout: ${existingNames.join(", ") || "nothing yet"}.`, `Library and their plan: ${lib}.`].filter(Boolean).join("\n") })
      .then((r) => { const v = { base, asked: text, status: "done", text: r.text, lifts: r.lifts }; seen.current.set(text, v); setAi(v); })
      .catch((e) => { if (e.name !== "AbortError") setAi({ base, asked: text, status: "error", kind: e.kind }); });
  };
  const stop = () => { abort.current?.abort(); setAi(null); };
  // A description is asked about once typing pauses; something else typed drops the picks.
  useEffect(() => {
    if (!read.text) { stop(); return; }
    if (!describing) { if (ai && ai.base !== read.text) stop(); return; }
    if (read.text === ai?.base) return;
    const t = setTimeout(() => ask(read.text), AUTO_MS);
    return () => clearTimeout(t);
  }, [read.text, describing]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = describing && read.text !== ai?.base;
  const working = pending || ai?.status === "loading";
  const updating = working && !pending && ai?.prev;
  const canFollow = ai && !pending && (ai.status !== "loading" || !!ai.prev) && !typing;
  const toTop = () => input.current?.closest(".sheet-body")?.scrollTo({ top: 0, behavior: "smooth" });
  const submit = (e) => {
    e.preventDefault();
    input.current?.blur();
    if (describing && pending) ask(read.text);
  };
  // A follow-up builds on what was asked: "no machines either" means the same ask, narrowed.
  const followUp = (e) => {
    e.preventDefault();
    if (!more.trim() || ai?.status === "loading") return;
    ask(`${ai.asked}. ${more.trim()}`, ai.base);
    setMore("");
    toTop();
  };
  const picked = new Set(!pending && ai?.status === "done" ? ai.lifts.map((e) => e.n.toLowerCase()) : []);
  const rest = fits.filter(({ e }) => !picked.has(e.n.toLowerCase()));
  const pick = (e) => onPick({ n: e.n, sets: e.sets, reps: e.reps, rest: e.rest, cue: e.cue || "" });

  if (custom) return <CustomLift custom={custom} setCustom={setCustom} existingNames={existingNames} onPick={onPick} onClose={onClose} />;

  const box = (
    <form className="food-search" role="search" onSubmit={submit}>
      {describing ? <span className="food-search-coach" aria-hidden="true"><Coach id={coach} size={22} still decorative /></span> : <Search size={18} aria-hidden="true" />}
      <label htmlFor="lift-search" className="sr-only">Search lifts, or describe what you want</label>
      <input id="lift-search" ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
        onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}
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
      <div className="food-box">{box}</div>

      {/* The coach's picks, first, like an overview above the results. */}
      {(pending || ai) && (
        <section className={"answer lift-answer" + (working ? " working" : "")} aria-live="polite" aria-busy={working} style={{ "--c": COACHES[coach]?.color }}>
          <header className="answer-head">
            <Coach id={coach} size={26} mood={working ? "focused" : ai?.status === "done" ? "hyped" : "idle"} still decorative />
            <b>{who}</b>
            {working && <span className="answer-state"><ThinkingOrb state="breathing" size={20} theme={theme} aria-hidden="true" />{updating ? "Updating" : "Picking lifts"}</span>}
          </header>
          {working && !updating && (
            <>
              {read.chips.length > 0 && (
                <div className="meal-chips" aria-label="Understood as">
                  {read.chips.map((c, k) => <span key={k} className={"meal-chip" + (c.avoid ? " avoid" : " own")}>{c.text}</span>)}
                </div>
              )}
              <div className="answer-skel" aria-hidden="true"><i /><i /><i /></div>
            </>
          )}
          {updating && <div className="answer-stale answer-lifts" aria-hidden="true">{ai.prev.lifts.map((e) => <span key={e.n} className="lib-row"><span className="name">{e.n}</span></span>)}</div>}
          {!working && ai?.status === "error" && (
            <>
              <p className="answer-text">{TROUBLE[ai.kind] || TROUBLE.busy}</p>
              <button type="button" className="chip" onClick={() => ask(ai.asked, ai.base)}><RotateCcw size={14} aria-hidden="true" /> Try again</button>
            </>
          )}
          {!working && ai?.status === "done" && (
            <>
              {ai.text && <p className="answer-text">{ai.text}</p>}
              <div className="answer-lifts">{ai.lifts.map((e) => row(e, e.why))}</div>
            </>
          )}
        </section>
      )}

      {/* The library's best fits for what was described, each with why (less what the coach already picked). */}
      {describing && rest.length > 0 && (
        <div className="section">
          <div className="lbl group-lbl">{picked.size ? "More from the library" : "Best fits"}</div>
          {rest.map(({ e, why }) => row(e, why.join(" · ")))}
        </div>
      )}

      {!describing && (
        <>
          {Object.keys(grouped).length === 0 && <p className="muted small" style={{ textAlign: "center", padding: "16px 0" }}>Nothing in the library matches <q>{q.trim()}</q>.</p>}
          {Object.entries(grouped).map(([g, items]) => (
            <div key={g} className="section">
              <div className="lbl group-lbl">{g}</div>
              {items.map((e) => row(e))}
            </div>
          ))}
          {q.trim() && !ai && (
            <button type="button" className="tank-row" onClick={() => { ask(q.trim()); toTop(); }}>
              <Coach id={coach} size={28} still decorative />
              <span className="tank-row-text"><b>Ask {who} about <q>{q.trim()}</q></b><small>Say what you want and {who} picks lifts for it.</small></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
          )}
        </>
      )}

      <button className="btn btn-ink" onClick={() => setCustom({ n: describing ? "" : q.trim(), sets: 3, min: 8, max: 12, rest: 90, cue: "" })}>
        <Plus size={18} aria-hidden="true" /> {q.trim() && !describing ? `Create "${q.trim()}"` : "Create your own"}
      </button>

      {/* Once there are picks: narrow them or say more, here at the bottom. */}
      {canFollow && (
        <form className="chat-input answer-follow" onSubmit={followUp} aria-busy={ai.status === "loading"}>
          <label htmlFor="lift-more" className="sr-only">Say more to {who}</label>
          <input id="lift-more" className="lift-reply-input" value={more} onChange={(e) => setMore(e.target.value)} placeholder="Say more, e.g. no machines either" autoComplete="off" enterKeyHint="send" />
          <button type="submit" aria-label="Send" disabled={!more.trim() || ai.status === "loading"}><ArrowUp size={20} strokeWidth={2.8} /></button>
        </form>
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
