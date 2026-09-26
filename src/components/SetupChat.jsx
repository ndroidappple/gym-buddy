import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleCheck, ListChecks, Plus, ArrowUp } from "lucide-react";
import { Sheet, ExercisePicker } from "./ui.jsx";
import Coach from "./Coach.jsx";
import { COACHES } from "../data/coaches.js";
import { activeDays } from "../data/program.js";
import { plural } from "../lib/util.js";
import { GOALS, DAY_CHOICES, EVERY_DAY, planFor, coachLifts, coachOptions, applyPicks } from "../lib/setup.js";

/* A coach's first chat: scripted, so it's instant, free and can't misread an answer. Tank asks about
   goals, weight and training days, then shows the plan to confirm. Every coach (Tank included) then
   lets the lifter keep, drop or add their lifts, and ends on a card saying exactly what was saved.
   Tank's answers are saved as they're given (`onSave`), so closing the sheet part way loses nothing;
   `onDone` gets { coach, program?, profile?, weight? } and marks the coach met.
   `next` is the next coach still to meet (null when this is the last), `left` how many remain. */
const TANK_STEPS = ["goals", "weight", "days", "plan", "lifts"];

export default function SetupChat({ coach, program, profile, name, next, left = 0, onSave, onDone, onClose, onNext, onFinish }) {
  const c = COACHES[coach];
  // Fixed when the chat opens: saving the profile mid-chat must not flip it out of setup mode.
  const [tankIntro] = useState(() => coach === "tank" && !profile?.doneAt);
  const [step, setStep] = useState(tankIntro ? "goals" : "lifts");
  const [log, setLog] = useState([]); // answered exchanges: { q, a }
  const [goals, setGoals] = useState(profile?.goals || []);
  const [weight, setWeight] = useState("");
  const [weightBad, setWeightBad] = useState(false);
  const [loggedWeight, setLoggedWeight] = useState(null);
  const [days, setDays] = useState(profile?.days || null);
  const [working, setWorking] = useState(program); // program as it will be after this chat
  const [planNote, setPlanNote] = useState(null); // what the plan step did, for the summary
  const [saved, setSaved] = useState([]); // lines for the closing summary card
  const listRef = useRef(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [log, step]);

  const hi = name ? `, ${name}` : "";
  const QUESTIONS = {
    goals: `Welcome in${hi}. I'm Tank. Four quick questions and your plan's set. What are you training for? Pick any.`,
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
    setStep("plan");
  };

  const plan = useMemo(() => (step === "plan" ? planFor(working, { goals, days }) : null), [step, working, goals, days]);

  // Lifts step: this coach's lifts pre-ticked, plus anything added from the library.
  const mine = useMemo(() => coachLifts(working, coach), [working, coach]);
  const [off, setOff] = useState(() => new Set()); // "day|name" unticked
  const [added, setAdded] = useState([]);
  const [picking, setPicking] = useState(false);
  const options = useMemo(() => coachOptions(working, coach).filter((n) => !added.includes(n)), [working, coach, added]);
  const everyDay = EVERY_DAY.has(coach);

  // Tank's goals, days and plan are saved (and Tank marked met) the moment the plan is answered, so
  // closing the sheet on the lifts step that follows can't lose them. The retired "anything else"
  // note is cleared so an old answer doesn't linger in the coach's context with no way to see it.
  const tankProfile = () => ({ profile: { goals, days, note: undefined, doneAt: Date.now() } });
  const answerPlan = (programOut, a, noteLine) => {
    if (a) say("Here's how I'd set you up.", a);
    setPlanNote(noteLine);
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

  const liftsQuestion = everyDay
    ? `I'm ${c.name}. Want some ${group} at the end of each day? Pick any, or skip for now.`
    : mine.length
      ? `${tankIntro ? "Last one: your chest and triceps." : `I'm ${c.name}, your ${group} coach.`} Here's what I've got you doing. Untick anything you don't want, or add your own.`
      : `I'm ${c.name}. No ${group} lifts in your plan yet. Want to add some?`;

  const doneLine = next
    ? `${tankIntro ? "You're set up." : "Saved."} ${COACHES[next].name} handles ${COACHES[next].group.toLowerCase()} next${left > 1 ? `, then ${left - 1} more` : ""}. About 30 seconds each, now or whenever.`
    : "That's the whole crew. Your plan's ready. Go lift.";

  const stepNo = TANK_STEPS.indexOf(step) + 1;
  const sub = tankIntro && stepNo ? `Step ${stepNo} of ${TANK_STEPS.length}` : step === "done" ? "All saved" : `${c.group} coach`;

  return (
    <Sheet title={tankIntro ? "Set up with Tank" : `Meet ${c.name}`} sub={sub} onClose={onClose} labelledBy="setup-title" className="sheet-chat setup-chat">
      <div className="chat" style={{ "--c": c.color }}>
        <div className="chat-coach"><Coach id={coach} mood={step === "done" ? "hyped" : "idle"} size={72} /></div>
        <div className="chat-list" ref={listRef} aria-live="polite">
          {log.map((x, i) => (
            <React.Fragment key={i}>
              <p className="coach-bubble">{x.q}</p>
              <p className="chat-me">{x.a}</p>
            </React.Fragment>
          ))}

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
        <div className="setup-actions">
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
            next
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
