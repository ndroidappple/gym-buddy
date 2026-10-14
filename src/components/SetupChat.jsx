import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleCheck, ListChecks, Plus, ArrowUp, ClipboardList } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import { Sheet, ExercisePicker } from "./ui.jsx";
import Coach from "./Coach.jsx";
import { COACHES } from "../data/coaches.js";
import { activeDays } from "../data/program.js";
import { plural } from "../lib/util.js";
import { GOALS, DAY_CHOICES, EVERY_DAY, planFor, coachLifts, coachOptions, applyPicks } from "../lib/setup.js";
import { parseProgram, programFromImport, liftLine, MAX_PASTE } from "../lib/importProgram.js";
import { reviewProgram } from "../lib/coachChat.js";
import { applyChanges } from "../lib/programChange.js";
import { useTheme } from "../lib/theme.js";

/* A coach's first chat: scripted, so it's instant, free and can't misread an answer. The head coach first asks
   whether the lifter already runs a program: if so they paste it in, check what was read, and later
   can have them review it (the one step that calls the model, and optional). Then goals, weight and
   training days, and either the plan to confirm or, for their own program, the review offer. Every coach (the head coach included) then
   lets the lifter keep, drop or add their lifts, and ends on a card saying exactly what was saved.
   The head coach's answers are saved as they're given (`onSave`), so closing the sheet part way loses nothing;
   `onDone` gets { coach, program?, profile?, weight? } and marks the coach met.
   `next` is the next coach still to meet (null when this is the last), `left` how many remain.
   `importOnly` (from Settings) runs just the paste, check and review steps; the result goes to `onImport`. */
const TANK_STEPS = ["import", "goals", "weight", "days", "plan", "lifts"];
// Steps shown under the numbered step they belong to.
const STEP_OF = { paste: "import", check: "import", offer: "plan", reviewing: "plan", suggest: "plan" };

/* When the review can't run, the coach says so and setup carries on with the program as pasted. */
const REVIEW_TROUBLE = {
  offline: "Can't review it without a connection.",
  auth: "Lost track of who you are, so I couldn't review it.",
  unavailable: "The review runs on the deployed app, not this dev server.",
  rate: "The free tier's busy right now, so I couldn't review it.",
};

export default function SetupChat({ coach, head = "tank", program, profile, name, next, left = 0, importOnly = false, onSave, onDone, onImport, onClose, onNext, onFinish }) {
  const c = COACHES[coach];
  const theme = useTheme();
  // Fixed when the chat opens: saving the profile mid-chat must not flip it out of setup mode.
  // The head coach asks the goals questions; the crew only their lifts.
  const [tankIntro] = useState(() => !importOnly && coach === head && !profile?.doneAt);
  const [step, setStep] = useState(importOnly ? "paste" : tankIntro ? "import" : "lifts");
  const [log, setLog] = useState([]); // answered exchanges: { q, a }
  const [goals, setGoals] = useState(profile?.goals || []);
  const [weight, setWeight] = useState("");
  const [weightBad, setWeightBad] = useState(false);
  const [loggedWeight, setLoggedWeight] = useState(null);
  const [days, setDays] = useState(profile?.days || null);
  const [working, setWorking] = useState(program); // program as it will be after this chat
  const [planNote, setPlanNote] = useState(null); // what the plan step did, for the summary
  const [saved, setSaved] = useState([]); // lines for the closing summary card
  // Their own program: the pasted text, what was read from it, and the head coach's review.
  const [paste, setPaste] = useState("");
  const [parsed, setParsed] = useState(null); // { workouts, notes, errors }
  const [own, setOwn] = useState(false); // the lifter's pasted program is in `working`
  const [review, setReview] = useState(null); // { text, suggestions } | { trouble }
  const [picked, setPicked] = useState(() => new Set()); // indexes of suggestions to apply
  const [ownNote, setOwnNote] = useState(null); // summary line for what happened to their program
  const listRef = useRef(null);
  const abort = useRef(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [log, step, parsed, review]);

  const hi = name ? `, ${name}` : "";
  const QUESTIONS = {
    import: `Welcome in${hi}. I'm ${c.name}, your head coach. A few quick questions and your plan's set. First up: are you already following a program you like?`,
    paste: "Paste it in. Workout names on their own lines, then each lift with sets × reps. Straight from your notes app is fine.",
    check: "Here's what I read. Look right?",
    offer: "Want me to look it over and suggest tweaks for your goals? Totally optional. Nothing changes unless you pick it.",
    goals: tankIntro && !own ? "No problem, I'll build you one. What are you training for? Pick any." : "What are you training for? Pick any.",
    weight: "What do you weigh right now? It starts your bodyweight chart.",
    days: "About how many days a week can you train? Rough is fine. You can flex week to week.",
  };
  const say = (q, a) => setLog((l) => [...l, { q, a }]);
  const goalLabels = (gs) => gs.map((g) => GOALS.find((x) => x.id === g)?.label).filter(Boolean).join(", ");

  const answerGoals = (gs) => {
    setGoals(gs);
    say(QUESTIONS.goals, gs.length ? goalLabels(gs) : "Skip for now");
    onSave?.({ profile: { goals: gs } });
    setStep("weight");
  };
  const answerWeight = (e) => {
    e.preventDefault();
    if (weight.trim() === "") { say(QUESTIONS.weight, "Skip for now"); setStep("days"); return; }
    const w = parseFloat(weight);
    if (!(w > 50 && w < 800)) { setWeightBad(true); return; }
    const bw = Math.round(w * 10) / 10;
    setLoggedWeight(bw);
    say(QUESTIONS.weight, `${bw} lb`);
    onSave?.({ weight: bw });
    setStep("days");
  };
  const answerDays = (d) => {
    setDays(d);
    say(QUESTIONS.days, `${d === 6 ? "6+" : d} days`);
    onSave?.({ profile: { days: d } });
    setStep(own ? "offer" : "plan");
  };

  /* ── their own program ── */
  const answerImport = (yes) => {
    say(QUESTIONS.import, yes ? "Yes, I'll paste it in." : "No, build me one.");
    setStep(yes ? "paste" : "goals");
  };
  const readPaste = (e) => {
    e.preventDefault();
    const r = parseProgram(paste);
    setParsed(r);
    if (r.errors.length) return;
    const lifts = r.workouts.reduce((n, w) => n + w.exercises.length, 0);
    say(QUESTIONS.paste, `Pasted ${plural(r.workouts.length, "workout")}, ${plural(lifts, "lift")}.`);
    setStep("check");
  };
  const confirmImport = () => {
    const out = programFromImport(working, parsed.workouts);
    say(QUESTIONS.check, "Looks right.");
    setWorking(out);
    setOwn(true);
    setOwnNote(`Your program: ${parsed.workouts.map((w) => w.name).join(", ")}`);
    onSave?.({ program: out }); // closing setup from here keeps it
    setStep(importOnly ? "offer" : "goals");
  };
  const fixPaste = () => { say(QUESTIONS.check, "Let me fix it."); setParsed(null); setStep("paste"); };
  const skipPaste = () => {
    if (importOnly) { onClose(); return; }
    say(QUESTIONS.paste, "Never mind, build me one.");
    setParsed(null);
    setStep("goals");
  };

  const startReview = async () => {
    say(QUESTIONS.offer, "Yes, look it over.");
    setStep("reviewing");
    abort.current = new AbortController();
    try {
      const r = await reviewProgram({ coach, program: working, profile: { ...profile, goals, days }, signal: abort.current.signal });
      setReview(r);
      setPicked(new Set(r.suggestions.map((_, i) => i)));
    } catch (e) {
      if (e.name === "AbortError") return;
      setReview({ trouble: REVIEW_TROUBLE[e.kind] || "Couldn't get the review through." });
    }
    setStep("suggest");
  };
  // The program is final: the head coach marks setup done (or, from Settings, the import is saved).
  const finishOwn = (programOut, note) => {
    setWorking(programOut);
    if (importOnly) {
      onImport?.(programOut);
      setSaved([ownNote, ...(note ? [note] : [])].filter(Boolean));
      setStep("done");
      return;
    }
    answerPlan(programOut, null, [ownNote, note].filter(Boolean).join(". "));
  };
  const skipReview = () => { say(QUESTIONS.offer, "No thanks, keep it as is."); finishOwn(working, null); };
  const applyReview = () => {
    const chosen = review.suggestions.filter((_, i) => picked.has(i));
    const r = applyChanges(working, chosen.map((x) => x.change));
    say(review.text || "Here's what I'd change.", chosen.length ? `Apply ${plural(r.lines.length, "change")}.` : "Keep mine as is.");
    finishOwn(r.program, r.lines.length ? `${c.name}'s review: ${plural(r.lines.length, "change")} applied` : `${c.name}'s review: kept as is`);
  };
  const afterTrouble = () => { say(review.trouble, "OK."); finishOwn(working, null); };

  const plan = useMemo(() => (step === "plan" ? planFor(working, { goals, days }) : null), [step, working, goals, days]);

  // Lifts step: this coach's lifts pre-ticked, plus anything added from the library.
  const mine = useMemo(() => coachLifts(working, coach), [working, coach]);
  const [off, setOff] = useState(() => new Set()); // "day|name" unticked
  const [added, setAdded] = useState([]);
  const [picking, setPicking] = useState(false);
  const options = useMemo(() => coachOptions(working, coach).filter((n) => !added.includes(n)), [working, coach, added]);
  const everyDay = EVERY_DAY.has(coach);

  // The head coach's goals, days and plan are saved (and the coach marked met) the moment the plan is answered, so
  // closing the sheet on the lifts step that follows can't lose them. The retired "anything else"
  // note is cleared so an old answer doesn't linger in the coach's context with no way to see it.
  const tankProfile = () => ({ profile: { goals, days, note: undefined, doneAt: Date.now() } });
  const answerPlan = (programOut, a, noteLine) => {
    if (a) say("Here's how I'd set you up.", a);
    setPlanNote(noteLine || null);
    setWorking(programOut);
    onDone({ program: programOut, coach, ...tankProfile() });
    setStep("lifts");
  };

  const changes = mine.filter((x) => off.has(`${x.day}|${x.n}`)).length + added.length;
  const group = c.group.toLowerCase();
  const saveLabel = changes ? `Save ${plural(changes, "change")}`
    : mine.length ? "Keep these lifts"
    : "Skip for now";
  const saveLifts = () => {
    const drop = mine.filter((x) => off.has(`${x.day}|${x.n}`));
    const r = applyPicks(working, coach, { drop, add: added });
    say(liftsQuestion, r.lines.length ? r.lines.join(". ") + "." : saveLabel + ".");
    onDone({ program: r.program, coach, ...(tankIntro ? tankProfile() : {}) });
    const liftLines = r.lines.length ? r.lines
      : mine.length ? [`Kept your ${plural(mine.length, `${group} lift`)}`]
      : [`No ${group} added for now`];
    setSaved(tankIntro ? [
      `Goals: ${goalLabels(goals) || "not set"}`,
      ...(loggedWeight ? [`Bodyweight: ${loggedWeight} lb logged for today`] : []),
      ...(days ? [`About ${days === 6 ? "6+" : days} workouts a week`] : []),
      ...(planNote ? [planNote] : []),
      ...liftLines,
    ] : liftLines);
    setStep("done");
  };

  const intro = tankIntro ? "Last one:" : `I'm ${c.name}.`;
  const liftsQuestion = everyDay
    ? `${intro} Want some ${group} at the end of each day? Pick any, or skip for now.`
    : mine.length
      ? `${tankIntro ? `Last one: your ${group}.` : `I'm ${c.name}, your ${group} coach.`} Here's what I've got you doing. Untick anything you don't want, or add your own.`
      : `${intro} No ${group} lifts in your plan yet. Want to add some?`;

  const doneLine = importOnly ? "Your program's in. Rename workouts or tweak lifts any time in Settings." : next
    ? `${tankIntro ? "You're set up." : "Saved."} Next up: ${COACHES[next].name}, your ${COACHES[next].group.toLowerCase()} coach` +
      (left > 1 ? `. After that, ${left - 1} more coach${left > 2 ? "es" : ""} to meet. About 30 seconds each, now or later.` : ", and the last coach to meet. About 30 seconds, now or later.")
    : "That's the whole crew. Your plan's ready. Go lift.";

  const stepNo = TANK_STEPS.indexOf(STEP_OF[step] || step) + 1;
  const sub = tankIntro && stepNo ? `Step ${stepNo} of ${TANK_STEPS.length}` : step === "done" ? "All saved" : importOnly ? "Paste it, check it, optional review" : `${c.group} coach`;
  const pickedCount = review?.suggestions ? picked.size : 0;

  return (
    <Sheet title={tankIntro ? `Set up with ${c.name}` : importOnly ? "Bring in your program" : `Meet ${c.name}`} sub={sub} onClose={onClose} labelledBy="setup-title" className="sheet-chat setup-chat">
      <div className="chat" style={{ "--c": c.color }}>
        <div className="chat-coach"><Coach id={coach} mood={step === "done" ? "hyped" : step === "reviewing" ? "focused" : "idle"} size={72} /></div>
        <div className="chat-list" ref={listRef} aria-live="polite">
          {log.map((x, i) => (
            <React.Fragment key={i}>
              <p className="coach-bubble">{x.q}</p>
              <p className="chat-me">{x.a}</p>
            </React.Fragment>
          ))}

          {step === "import" && <p className="coach-bubble">{QUESTIONS.import}</p>}
          {step === "paste" && (
            <>
              <p className="coach-bubble">{importOnly && !log.length ? `Got a program you already run? ${QUESTIONS.paste}` : QUESTIONS.paste}</p>
              {parsed?.errors.length > 0 && <p className="setup-hint" role="alert">{parsed.errors.join(" ")}</p>}
            </>
          )}
          {step === "check" && parsed && (
            <>
              <p className="coach-bubble">{QUESTIONS.check}</p>
              {parsed.workouts.map((w) => (
                <div key={w.name} className="proposal setup-import" role="group" aria-label={w.name}>
                  <span className="proposal-head"><ClipboardList size={16} strokeWidth={2.6} aria-hidden="true" />{w.name}</span>
                  <ul>{w.exercises.map((ex) => <li key={ex.n}>{liftLine(ex)}</li>)}</ul>
                </div>
              ))}
              {parsed.notes.length > 0 && (
                <div className="proposal setup-import" role="note">
                  <span className="proposal-head">Heads up</span>
                  <ul>{parsed.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                </div>
              )}
            </>
          )}
          {step === "offer" && <p className="coach-bubble">{QUESTIONS.offer}</p>}
          {step === "reviewing" && (
            <p className="coach-bubble"><span className="chat-wait">
              <ThinkingOrb state="breathing" size={20} theme={theme} aria-hidden="true" />
              {c.name} is reading your program… this can take up to a minute.
            </span></p>
          )}
          {step === "suggest" && review && (
            review.trouble ? <p className="coach-bubble">{review.trouble} Your program's saved as you pasted it. Ask me to look it over any time from Coaches.</p> : (
              <>
                <p className="coach-bubble">{review.text || (review.suggestions.length ? "Here's what I'd change." : "It's solid. I wouldn't change a thing.")}</p>
                {review.suggestions.length > 0 && (
                  <div className="proposal setup-lifts" role="group" aria-label={`${c.name}'s suggestions`}>
                    {review.suggestions.map((x, i) => (
                      <label key={i} className="setup-lift">
                        <input type="checkbox" checked={picked.has(i)} onChange={() => setPicked((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
                        <span>{x.line}{x.why && <small>{x.why}</small>}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )
          )}
          {step === "goals" && (
            <>
              <p className="coach-bubble">{QUESTIONS.goals}</p>
              <div className="setup-choices" role="group" aria-label="Your goals">
                {GOALS.map((g) => (
                  <button key={g.id} type="button" className="chip" aria-pressed={goals.includes(g.id)}
                    onClick={() => setGoals((gs) => (gs.includes(g.id) ? gs.filter((x) => x !== g.id) : [...gs, g.id]))}>
                    {goals.includes(g.id) && <Check size={14} strokeWidth={3} aria-hidden="true" />}{g.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {step === "weight" && (
            <>
              <p className="coach-bubble">{QUESTIONS.weight}</p>
              {weightBad && <p className="setup-hint" role="alert">That doesn't look like a bodyweight in lb. Fix it, or clear it to skip.</p>}
            </>
          )}
          {step === "days" && (
            <>
              <p className="coach-bubble">{QUESTIONS.days}</p>
              <div className="setup-choices" role="group" aria-label="Days per week">
                {DAY_CHOICES.map((d) => (
                  <button key={d} type="button" className="chip setup-day" aria-pressed={days === d} onClick={() => answerDays(d)}>
                    {d === 6 ? "6+" : d}
                  </button>
                ))}
              </div>
            </>
          )}
          {step === "plan" && plan && (
            <>
              <p className="coach-bubble">{plan.lines.length ? "Here's how I'd set you up:" : "Your current program already fits. Nothing to change."}</p>
              {plan.lines.length > 0 && (
                <div className="proposal" role="group" aria-label="Your plan">
                  <span className="proposal-head"><ListChecks size={16} strokeWidth={2.6} aria-hidden="true" />Your plan</span>
                  <ul>{plan.lines.map((l) => <li key={l}>{l}</li>)}<li>Weekly aim: about {days === 6 ? "6" : days} workouts. Flex any week.</li></ul>
                </div>
              )}
            </>
          )}
          {step === "lifts" && (
            <>
              <p className="coach-bubble">{liftsQuestion}</p>
              <div className="proposal setup-lifts" role="group" aria-label={`${c.name}'s lifts`}>
                {mine.map((x) => {
                  const k = `${x.day}|${x.n}`;
                  const on = !off.has(k);
                  return (
                    <label key={k} className="setup-lift">
                      <input type="checkbox" checked={on} onChange={() => setOff((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })} />
                      <span>{x.n}<small>{working[x.day].name}</small></span>
                    </label>
                  );
                })}
                {everyDay && options.slice(0, 6).map((n) => (
                  <label key={n} className="setup-lift">
                    <input type="checkbox" checked={added.includes(n)} onChange={() => setAdded((a) => (a.includes(n) ? a.filter((x) => x !== n) : [...a, n]))} />
                    <span>{n}<small>End of each day</small></span>
                  </label>
                ))}
                {!everyDay && added.map((n) => (
                  <label key={n} className="setup-lift">
                    <input type="checkbox" checked onChange={() => setAdded((a) => a.filter((x) => x !== n))} />
                    <span>{n}<small>Added</small></span>
                  </label>
                ))}
                {!everyDay && <button type="button" className="setup-add" onClick={() => setPicking(true)}><Plus size={16} strokeWidth={2.8} aria-hidden="true" /> Add a lift</button>}
              </div>
            </>
          )}
          {step === "done" && (
            <>
              <div className="proposal setup-saved" role="group" aria-label="Saved">
                <span className="proposal-head"><CircleCheck size={16} strokeWidth={2.6} aria-hidden="true" />Saved</span>
                <ul>{saved.map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
              <p className="coach-bubble">{doneLine}</p>
            </>
          )}
        </div>

        {/* The answer controls sit where the chat input normally is. */}
        <div className={"setup-actions" + (step === "paste" ? " setup-paste" : "")}>
          {step === "import" && (
            <>
              <button type="button" className="btn btn-day" onClick={() => answerImport(true)}>Yes, paste it in</button>
              <button type="button" className="btn btn-ghost" onClick={() => answerImport(false)}>No, build me one</button>
            </>
          )}
          {step === "paste" && (
            <form onSubmit={readPaste}>
              <label htmlFor="setup-paste" className="sr-only">Your program</label>
              <textarea id="setup-paste" className="textarea" rows={7} autoFocus value={paste} maxLength={MAX_PASTE}
                onChange={(e) => { setPaste(e.target.value); if (parsed) setParsed(null); }}
                placeholder={"WORKOUT 1\nMachine Chest Press — 3 × 6–10\nLat Pulldown — 3 × 8–12\n\nWORKOUT 2\nHack Squat — 3 × 6–10"} />
              <div className="setup-row">
                <button type="submit" className="btn btn-day" disabled={!paste.trim()}>Read it</button>
                <button type="button" className="btn btn-ghost" onClick={skipPaste}>{importOnly ? "Cancel" : "Build me one"}</button>
              </div>
            </form>
          )}
          {step === "check" && (
            <>
              <button type="button" className="btn btn-day" onClick={confirmImport}><Check size={17} strokeWidth={3} aria-hidden="true" /> Looks right</button>
              <button type="button" className="btn btn-ghost" onClick={fixPaste}>Fix it</button>
            </>
          )}
          {step === "offer" && (
            <>
              <button type="button" className="btn btn-day" onClick={startReview}>Yes, look it over</button>
              <button type="button" className="btn btn-ghost" onClick={skipReview}>No thanks</button>
            </>
          )}
          {step === "reviewing" && (
            <button type="button" className="btn btn-ghost" onClick={() => { abort.current?.abort(); setReview({ trouble: "Stopped the review." }); setStep("suggest"); }}>Skip the review</button>
          )}
          {step === "suggest" && review && (
            review.trouble ? <button type="button" className="btn btn-day" onClick={afterTrouble}>Next</button>
            : review.suggestions.length ? (
              <>
                <button type="button" className={"btn " + (pickedCount ? "btn-day" : "btn-ghost")} onClick={applyReview}>
                  {pickedCount > 0 && <Check size={17} strokeWidth={3} aria-hidden="true" />}{pickedCount ? `Apply ${plural(pickedCount, "change")}` : "Keep mine as is"}</button>
                {pickedCount > 0 && <button type="button" className="btn btn-ghost" onClick={() => setPicked(new Set())}>Clear</button>}
              </>
            ) : <button type="button" className="btn btn-day" onClick={applyReview}>Next</button>
          )}
          {step === "goals" && (
            goals.length
              ? <button type="button" className="btn btn-day" onClick={() => answerGoals(goals)}>Next</button>
              : <button type="button" className="btn btn-ghost" onClick={() => answerGoals([])}>Skip for now</button>
          )}
          {step === "weight" && (
            <form className="chat-input" onSubmit={answerWeight}>
              <input className="setup-weight" type="number" inputMode="decimal" autoFocus value={weight}
                onChange={(e) => { setWeight(e.target.value); setWeightBad(false); }}
                placeholder="Bodyweight in lb" aria-label="Bodyweight in pounds" aria-invalid={weightBad} />
              <button type="submit" aria-label={weight ? "Send" : "Skip"}>
                {weight ? <ArrowUp size={20} strokeWidth={2.8} /> : <span className="setup-skip">Skip</span>}
              </button>
            </form>
          )}
          {step === "plan" && plan && (
            plan.lines.length ? (
              <>
                <button type="button" className="btn btn-day" onClick={() => answerPlan(plan.program, "Use this plan.", "New plan applied")}>
                  <Check size={17} strokeWidth={3} aria-hidden="true" /> Use this plan</button>
                <button type="button" className="btn btn-ghost" onClick={() => answerPlan(working, "Keep my program.", "Kept your current program")}>Keep mine</button>
              </>
            ) : <button type="button" className="btn btn-day" onClick={() => answerPlan(working, null, null)}>Next</button>
          )}
          {step === "lifts" && (
            <button type="button" className={"btn " + (changes || mine.length ? "btn-day" : "btn-ghost")} onClick={saveLifts}>
              {changes > 0 && <Check size={17} strokeWidth={3} aria-hidden="true" />}{saveLabel}</button>
          )}
          {step === "done" && (
            importOnly ? <button type="button" className="btn btn-day" onClick={onClose}>Done</button>
            : next
              ? <><button type="button" className="btn btn-day" onClick={() => onNext?.({ coach: next })}>Meet {COACHES[next].name}</button><button type="button" className="btn btn-ghost" onClick={onClose}>Later</button></>
              : <button type="button" className="btn btn-day" onClick={onFinish || onClose}>Start training</button>
          )}
        </div>
      </div>
      {picking && (
        <ExercisePicker title={`Add to ${c.name}'s lifts`} sub="Pick from the library or create your own."
          existingNames={[...activeDays(working).flatMap((d) => working[d].exercises.map((e) => e.n)), ...added]}
          onPick={(ex) => { setAdded((a) => [...a, ex.n]); setPicking(false); }} onClose={() => setPicking(false)} />
      )}
    </Sheet>
  );
}
