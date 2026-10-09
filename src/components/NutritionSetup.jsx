import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ArrowUp, ListChecks } from "lucide-react";
import { Sheet } from "./ui.jsx";
import Coach from "./Coach.jsx";
import { COACHES } from "../data/coaches.js";
import { activeDays } from "../data/program.js";
import { PHASE_TYPES } from "../lib/phase.js";
import { num } from "../lib/util.js";
import { ACTIVITY, GOALS, computeTargets, adjustTargets, latestWeight } from "../lib/nutrition.js";

/* Tank sets nutrition targets: scripted like the other setup chats, so it's instant, free and
   can't misread an answer. Buttons wherever an answer is a choice; typing only for numbers
   (age, height, weight). Ends on the targets with how they were worked out; the lifter can use
   them or adjust calories, protein and fat before saving. Redoing it starts from the saved answers. */

const STEPS = ["sex", "age", "height", "weight", "activity", "goal", "targets"];

export default function NutritionSetup({ prefs, program, sessions, weighins, name, onSave, onWeighin, onClose }) {
  const saved = prefs.nutrition || {};
  const phase = prefs.phase && !prefs.phase.endedAt ? prefs.phase : null;
  const recent = latestWeight(sessions, weighins);
  const trainingDays = prefs.profile?.days || activeDays(program).length;
  const [a, setA] = useState({ sex: saved.sex, age: saved.age, heightIn: saved.heightIn, activity: saved.activity, goal: saved.goal, weight: recent && recent.age <= 14 ? recent.bw : null });
  const [log, setLog] = useState([]);
  const [step, setStep] = useState("sex");
  const [text, setText] = useState({ age: saved.age ? String(saved.age) : "", ft: saved.heightIn ? String(Math.floor(saved.heightIn / 12)) : "", inch: saved.heightIn ? String(saved.heightIn % 12) : "", weight: "" });
  const [bad, setBad] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [edit, setEdit] = useState(null); // { kcal, protein, fat } as strings while adjusting
  const listRef = useRef(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [log, step, adjusting]);

  const hi = name ? `, ${name}` : "";
  const Q = {
    sex: `${saved.targets ? "Let's redo your numbers" : `Food time${hi}`}. I'll set your daily calories and macros. For the math: male or female?`,
    age: "How old are you?",
    height: "How tall are you?",
    weight: "What do you weigh right now?",
    activity: "Outside the gym, how active is your day?",
    goal: "What's the goal?",
  };
  const say = (q, ans) => setLog((l) => [...l, { q, a: ans }]);
  // The next step, skipping weight when there's a recent weigh-in and the goal during a bulk or cut.
  const after = (s, next = a) => {
    let i = STEPS.indexOf(s) + 1;
    while ((STEPS[i] === "weight" && next.weight) || (STEPS[i] === "goal" && phase)) i++;
    return STEPS[i];
  };
  const answer = (s, patch, label) => { const next = { ...a, ...patch }; setA(next); say(Q[s], label); setBad(false); setStep(after(s, next)); };

  const submitAge = (e) => { e.preventDefault(); const v = parseInt(text.age); if (!(v >= 13 && v <= 100)) return setBad(true); answer("age", { age: v }, `${v}`); };
  const submitHeight = (e) => {
    e.preventDefault();
    const h = (parseInt(text.ft) || 0) * 12 + (parseFloat(text.inch) || 0);
    if (!(h >= 48 && h <= 96)) return setBad(true);
    answer("height", { heightIn: Math.round(h) }, `${Math.floor(h / 12)} ft ${Math.round(h % 12)} in`);
  };
  const submitWeight = (e) => {
    e.preventDefault();
    const w = parseFloat(text.weight);
    if (!(w > 50 && w < 800)) return setBad(true);
    const bw = Math.round(w * 10) / 10;
    onWeighin?.(bw); // also starts or extends the bodyweight chart
    answer("weight", { weight: bw }, `${bw} lb`);
  };

  const targets = useMemo(() => (step === "targets" ? computeTargets({ ...a, trainingDays, phase }) : null), [step, a, trainingDays, phase]);
  const final = adjusting && edit && targets ? adjustTargets(targets, { kcal: +edit.kcal || targets.kcal, protein: +edit.protein || targets.protein, fat: +edit.fat || targets.fat }) : targets;
  const save = () => {
    const { weight, ...details } = a; // eslint-disable-line no-unused-vars
    onSave({ ...saved, ...details, on: true, targets: final, setAt: Date.now() });
  };

  const goalLine = phase
    ? `You're on a ${PHASE_TYPES[phase.type].label.toLowerCase()} (${phase.rate > 0 ? "+" : ""}${phase.rate} lb/week), so I planned around that.`
    : a.goal === "maintain" ? "Eating at maintenance." : `Aiming for about ${Math.abs(targets?.rate || 0)} lb a week ${targets?.rate < 0 ? "down" : "up"}.`;
  const stepNo = STEPS.indexOf(step) + 1;

  return (
    <Sheet title="Nutrition with Tank" sub={step === "targets" ? "Your daily targets" : `Step ${stepNo} of ${STEPS.length}`} onClose={onClose} labelledBy="nutrition-setup-title" className="sheet-chat setup-chat keep-sub">
      <div className="chat" style={{ "--c": COACHES.tank.color }}>
        <div className="chat-coach"><Coach id="tank" mood={step === "targets" ? "hyped" : "idle"} size={72} /></div>
        <div className="chat-list" ref={listRef} aria-live="polite">
          {log.map((x, i) => (<React.Fragment key={i}><p className="coach-bubble">{x.q}</p><p className="chat-me">{x.a}</p></React.Fragment>))}
          {Q[step] && <p className="coach-bubble">{Q[step]}</p>}
          {step === "activity" && <p className="setup-hint">Your {trainingDays} training days a week are counted separately.</p>}
          {bad && <p className="setup-hint" role="alert">{step === "age" ? "Enter an age between 13 and 100." : step === "height" ? "That height doesn't look right." : "That doesn't look like a bodyweight in lb."}</p>}
          {step === "targets" && final && (
            <>
              <p className="coach-bubble">Here's your day. {goalLine} Protein comes first: it's what keeps and builds muscle.</p>
              <div className="proposal" role="group" aria-label="Your targets">
                <span className="proposal-head"><ListChecks size={16} strokeWidth={2.6} aria-hidden="true" />Daily targets</span>
                <ul>
                  <li>{final.kcal.toLocaleString()} kcal (you burn about {targets.burn.toLocaleString()})</li>
                  <li>{final.protein} g protein · {final.carbs} g carbs · {final.fat} g fat</li>
                </ul>
                {adjusting && (
                  <div className="grid-3 nut-adjust">
                    {[["kcal", "Calories"], ["protein", "Protein g"], ["fat", "Fat g"]].map(([k, label]) => (
                      <label key={k} className="field"><span className="lbl">{label}</span>
                        <input className="input tn" type="number" inputMode="numeric" value={edit[k]} onChange={(e) => setEdit((x) => ({ ...x, [k]: e.target.value }))} /></label>
                    ))}
                  </div>
                )}
                {adjusting && <p className="proposal-skip">Carbs fill the rest of the calories.</p>}
              </div>
            </>
          )}
        </div>

        <div className={"setup-actions" + (step === "sex" || step === "goal" ? " even" : "")}>
          {step === "sex" && [["male", "Male"], ["female", "Female"]].map(([id, label]) => (
            <button key={id} type="button" className={"btn " + (a.sex === id ? "btn-day" : "btn-ghost")} onClick={() => answer("sex", { sex: id }, label)}>{label}</button>
          ))}
          {step === "age" && (
            <form className="chat-input" onSubmit={submitAge}>
              <input className="setup-weight" type="number" inputMode="numeric" autoFocus value={text.age} onChange={(e) => { setText((t) => ({ ...t, age: e.target.value })); setBad(false); }} placeholder="Age" aria-label="Age in years" />
              <button type="submit" aria-label="Send" disabled={!text.age}><ArrowUp size={20} strokeWidth={2.8} /></button>
            </form>
          )}
          {step === "height" && (
            // Two small labelled fields and a send button that always fits: the number keypad has no
            // return key on iPhone, so the button is the only way to submit.
            <form className="chat-input setup-height" onSubmit={submitHeight}>
              <label className="setup-unit">
                <input type="number" inputMode="numeric" autoFocus value={text.ft} onChange={(e) => { setText((t) => ({ ...t, ft: e.target.value })); setBad(false); }} aria-label="Feet" />
                <span aria-hidden="true">ft</span>
              </label>
              <label className="setup-unit">
                <input type="number" inputMode="decimal" value={text.inch} onChange={(e) => { setText((t) => ({ ...t, inch: e.target.value })); setBad(false); }} aria-label="Inches" />
                <span aria-hidden="true">in</span>
              </label>
              <button type="submit" aria-label="Send" disabled={!text.ft}><ArrowUp size={20} strokeWidth={2.8} /></button>
            </form>
          )}
          {step === "weight" && (
            <form className="chat-input" onSubmit={submitWeight}>
              <input className="setup-weight" type="number" inputMode="decimal" autoFocus value={text.weight} onChange={(e) => { setText((t) => ({ ...t, weight: e.target.value })); setBad(false); }}
                placeholder={recent ? `Last: ${num(recent.bw)} lb` : "Bodyweight in lb"} aria-label="Bodyweight in pounds" />
              <button type="submit" aria-label="Send" disabled={!text.weight}><ArrowUp size={20} strokeWidth={2.8} /></button>
            </form>
          )}
          {step === "activity" && (
            <div className="setup-stack">
              {ACTIVITY.map((x) => (
                <button key={x.id} type="button" className={"btn setup-option " + (a.activity === x.id ? "btn-day" : "btn-ghost")} onClick={() => answer("activity", { activity: x.id }, x.label)}>
                  <span>{x.label}<small>{x.sub}</small></span>
                </button>
              ))}
            </div>
          )}
          {step === "goal" && GOALS.map((x) => (
            <button key={x.id} type="button" className={"btn " + (a.goal === x.id ? "btn-day" : "btn-ghost")} onClick={() => answer("goal", { goal: x.id }, x.label)}>{x.label}</button>
          ))}
          {step === "targets" && (
            <>
              <button type="button" className="btn btn-day" onClick={save}><Check size={17} strokeWidth={3} aria-hidden="true" /> {adjusting ? "Save these" : "Use these"}</button>
              {!adjusting && <button type="button" className="btn btn-ghost" onClick={() => { setEdit({ kcal: String(targets.kcal), protein: String(targets.protein), fat: String(targets.fat) }); setAdjusting(true); }}>Adjust</button>}
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
