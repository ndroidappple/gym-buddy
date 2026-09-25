import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ListChecks, Plus, ArrowUp } from "lucide-react";
import { Sheet, ExercisePicker } from "./ui.jsx";
import Coach from "./Coach.jsx";
import { COACHES, COACH_ORDER } from "../data/coaches.js";
import { activeDays } from "../data/program.js";
import { GOALS, DAY_CHOICES, EVERY_DAY, planFor, coachLifts, coachOptions, applyPicks } from "../lib/setup.js";

/* A coach's first chat: scripted, so it's instant, free and can't misread an answer. Tank asks about
   goals, an optional note, weight and training days, then shows the plan to confirm. Every coach
   (Tank included) then lets the lifter keep, drop or add their lifts. Nothing is saved until the
   lifter taps a confirm button; `onDone` gets { profile?, program?, weight? } to save. */
export default function SetupChat({ coach, program, profile, name, onDone, onClose, onNext }) {
  const c = COACHES[coach];
  // Fixed when the chat opens: saving the profile mid-chat must not flip it out of setup mode.
  const [tankIntro] = useState(() => coach === "tank" && !profile?.doneAt);
  const [step, setStep] = useState(tankIntro ? "goals" : "lifts");
  const [log, setLog] = useState([]); // answered exchanges: { q, a }
  const [goals, setGoals] = useState(profile?.goals || []);
  const [note, setNote] = useState("");
  const [weight, setWeight] = useState("");
  const [days, setDays] = useState(profile?.days || null);
  const [working, setWorking] = useState(program); // program as it will be after this chat
  const [answers, setAnswers] = useState({});
  const listRef = useRef(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [log, step]);

  const hi = name ? `, ${name}` : "";
  const QUESTIONS = {
    goals: `Welcome in${hi}. I'm Tank. Quick setup so the plan fits you. What are you training for? Pick any.`,
    note: "Anything else I should know? An event, an injury, what you love or hate. Optional.",
    weight: "What do you weigh right now? It starts your bodyweight chart.",
    days: "About how many days a week do you train? Rough is fine. You can always flex week to week.",
  };
  const answer = (q, a, patch, next) => {
    setLog((l) => [...l, { q, a }]);
    setAnswers((x) => ({ ...x, ...patch }));
    setStep(next);
  };

  const plan = useMemo(() => (step === "plan" ? planFor(working, { goals, days }) : null), [step, working, goals, days]);

  // Lifts step: this coach's lifts pre-ticked, plus anything added from the library.
  const mine = useMemo(() => coachLifts(working, coach), [working, coach]);
  const [off, setOff] = useState(() => new Set()); // "day|name" unticked
  const [added, setAdded] = useState([]);
  const [picking, setPicking] = useState(false);
  const options = useMemo(() => coachOptions(working, coach).filter((n) => !added.includes(n)), [working, coach, added]);
  const everyDay = EVERY_DAY.has(coach);

  const finish = (programOut, extra = {}) => {
    onDone({ program: programOut, coach, ...extra });
    setStep("done");
  };
  const saveLifts = (useDefaults) => {
    const drop = useDefaults ? [] : mine.filter((x) => off.has(`${x.day}|${x.n}`));
    const r = applyPicks(working, coach, { drop, add: useDefaults ? [] : added });
    setLog((l) => [...l, { q: liftsQuestion, a: useDefaults || !r.lines.length ? "Keep the defaults." : r.lines.join(". ") + "." }]);
    finish(r.program, tankIntro ? { profile: { goals, note: note.trim(), days, doneAt: Date.now() }, weight: answers.weight } : {});
  };

  const liftsQuestion = everyDay
    ? `I'm ${c.name}. Want some ${c.group.toLowerCase()} at the end of each day? Pick any, or skip for now.`
    : mine.length
      ? `${tankIntro ? "Now your chest and triceps." : `I'm ${c.name}, your ${c.group.toLowerCase()} coach.`} Here's what I've got you doing. Untick anything you don't want, or add your own.`
      : `I'm ${c.name}. No ${c.group.toLowerCase()} lifts in your plan yet. Want to add some?`;

  const nextCoach = COACH_ORDER[COACH_ORDER.indexOf(coach) + 1];
  const doneLine = tankIntro && note.trim()
    ? "Locked in. Give me a second on that note."
    : nextCoach ? `That's me sorted. ${COACHES[nextCoach].name} handles ${COACHES[nextCoach].group.toLowerCase()} next.` : "That's the whole crew. Go lift.";

  return (
    <Sheet title={tankIntro ? "Set up with Tank" : `Meet ${c.name}`} sub={`${c.group} coach`} onClose={onClose} labelledBy="setup-title" className="sheet-chat setup-chat">
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
          {step === "note" && <p className="coach-bubble">{QUESTIONS.note}</p>}
          {step === "weight" && <p className="coach-bubble">{QUESTIONS.weight}</p>}
          {step === "days" && (
            <>
              <p className="coach-bubble">{QUESTIONS.days}</p>
              <div className="setup-choices" role="group" aria-label="Days per week">
                {DAY_CHOICES.map((d) => (
                  <button key={d} type="button" className="chip setup-day" onClick={() => { setDays(d); answer(QUESTIONS.days, `${d === 6 ? "6+" : d} days`, { days: d }, "plan"); }}>
                    {d === 6 ? "6+" : d}
                  </button>
                ))}
              </div>
            </>
          )}
          {step === "plan" && plan && (
            <>
              <p className="coach-bubble">{plan.lines.length ? "Here's how I'd set you up:" : "Your current plan already fits. Nothing to change."}</p>
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
          {step === "done" && <p className="coach-bubble">{doneLine}</p>}
        </div>

        {/* The answer controls sit where the chat input normally is. */}
        <div className="setup-actions">
          {step === "goals" && (
            <>
              <button type="button" className="btn btn-day" disabled={!goals.length}
                onClick={() => answer(QUESTIONS.goals, goals.map((g) => GOALS.find((x) => x.id === g).label).join(", "), { goals }, "note")}>Next</button>
              <button type="button" className="btn btn-ghost" onClick={() => answer(QUESTIONS.goals, "Skip for now", { goals: [] }, "note")}>Skip</button>
            </>
          )}
          {(step === "note" || step === "weight") && (
            <form className="chat-input" onSubmit={(e) => {
              e.preventDefault();
              if (step === "note") answer(QUESTIONS.note, note.trim() || "Nothing else.", {}, "weight");
              else { const w = parseFloat(weight); const ok = w > 50 && w < 800; answer(QUESTIONS.weight, ok ? `${w} lb` : "Skip", ok ? { weight: Math.round(w * 10) / 10 } : {}, "days"); }
            }}>
              {step === "note"
                ? <textarea key="note" rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. training for a 10k, sore left shoulder" maxLength={300} aria-label="Anything else (optional)" />
                : <input key="weight" className="setup-weight" type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Bodyweight in lb" aria-label="Bodyweight in pounds" />}
              <button type="submit" aria-label={step === "note" ? (note.trim() ? "Send" : "Skip") : (weight ? "Send" : "Skip")}>
                {(step === "note" ? note.trim() : weight) ? <ArrowUp size={20} strokeWidth={2.8} /> : <span className="setup-skip">Skip</span>}
              </button>
            </form>
          )}
          {step === "plan" && plan && (
            plan.lines.length ? (
              <>
                <button type="button" className="btn btn-day" onClick={() => { setWorking(plan.program); setLog((l) => [...l, { q: "Here's how I'd set you up.", a: "Set it up." }]); setStep("lifts"); }}>
                  <Check size={17} strokeWidth={3} aria-hidden="true" /> Set it up</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setLog((l) => [...l, { q: "Here's how I'd set you up.", a: "Keep my program." }]); setStep("lifts"); }}>Keep my program</button>
              </>
            ) : <button type="button" className="btn btn-day" onClick={() => setStep("lifts")}>Next</button>
          )}
          {step === "lifts" && (
            everyDay ? (
              <>
                <button type="button" className="btn btn-day" disabled={!added.length} onClick={() => saveLifts(false)}>Add to each day</button>
                <button type="button" className="btn btn-ghost" onClick={() => saveLifts(true)}>Not now</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-day" onClick={() => saveLifts(false)} disabled={!off.size && !added.length}>Save my picks</button>
                <button type="button" className="btn btn-ghost" onClick={() => saveLifts(true)}>Use the defaults</button>
              </>
            )
          )}
          {step === "done" && (
            tankIntro && note.trim()
              ? <button type="button" className="btn btn-day" onClick={() => onNext?.({ coach: "tank", ask: `My goals: ${goals.map((g) => GOALS.find((x) => x.id === g).label).join(", ") || "not set"}. I train about ${days || "?"} days a week. Something to know: ${note.trim().replace(/[^.!?]$/, "$&.")} Anything you'd change in my program for that?` })}>See what Tank says</button>
              : nextCoach
                ? <><button type="button" className="btn btn-day" onClick={() => onNext?.({ coach: nextCoach })}>Meet {COACHES[nextCoach].name}</button><button type="button" className="btn btn-ghost" onClick={onClose}>Done for now</button></>
                : <button type="button" className="btn btn-day" onClick={onClose}>Let's go</button>
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
