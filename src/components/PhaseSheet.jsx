import React, { useMemo, useState } from "react";
import { Sheet } from "./ui.jsx";
import { PHASE_TYPES, DEFAULT_WEEKS, planPhase, rateWarning } from "../lib/phase.js";
import { num, shortDate, today } from "../lib/util.js";

/** Start a bulk or cut: pick the type, confirm today's weight, then a target weight or a weekly rate. */
export default function PhaseSheet({ lastWeight, onStart, onClose }) {
  const [type, setType] = useState("cut");
  const [weight, setWeight] = useState(lastWeight ? String(lastWeight) : "");
  const [by, setBy] = useState("target"); // "target" | "rate"
  const [target, setTarget] = useState("");
  const [rate, setRate] = useState("");
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS.cut);
  const pickType = (t) => { setType(t); setWeeks(DEFAULT_WEEKS[t]); };

  const w = parseFloat(weight);
  const plan = useMemo(() => (w > 50 && w < 800
    ? planPhase({ type, start: today(), startWeight: w, weeks, target: by === "target" ? target : null, rate: by === "rate" ? rate : null })
    : null), [type, w, weeks, by, target, rate]);
  const warning = plan && rateWarning(type, plan.rate, w);

  return (
    <Sheet title="Start a bulk or cut" sub="A short-term bodyweight goal. Your coaches track the pace from your weigh-ins." onClose={onClose} labelledBy="phase-title">
      <div className="sheet-body phase-form">
        <div className="seg" role="group" aria-label="Phase type">
          {Object.entries(PHASE_TYPES).map(([k, t]) => <button key={k} type="button" aria-pressed={type === k} onClick={() => pickType(k)}>{t.label}</button>)}
        </div>
        <label className="field"><span className="lbl">Weight today</span>
          <input className="input" type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="lb" /></label>
        <div className="seg" role="group" aria-label="Set a target by">
          <button type="button" aria-pressed={by === "target"} onClick={() => setBy("target")}>Target weight</button>
          <button type="button" aria-pressed={by === "rate"} onClick={() => setBy("rate")}>Weekly rate</button>
        </div>
        {by === "target"
          ? <label className="field"><span className="lbl">Target weight</span>
              <input className="input" type="number" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="lb" /></label>
          : <label className="field"><span className="lbl">{type === "cut" ? "Lose per week" : "Gain per week"}</span>
              <input className="input" type="number" inputMode="decimal" step="0.1" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="lb, e.g. 0.5" /></label>}
        <label className="field"><span className="lbl">Length: {weeks} weeks</span>
          <input type="range" min="4" max="16" step="1" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Weeks" /></label>

        {plan && (
          <p className="phase-preview">
            {num(plan.startWeight)} → <b>{num(plan.target)} lb</b> · {plan.rate > 0 ? "+" : "−"}{num(Math.abs(plan.rate))} lb/week · ends {shortDate(plan.end)}
          </p>
        )}
        {warning && <p className="phase-warn" role="note">{warning}</p>}
        <button type="button" className="btn btn-day" data-day="push" disabled={!plan || (type === "cut" ? plan.rate >= 0 : plan.rate <= 0)}
          onClick={() => onStart({ ...plan, createdAt: Date.now() })}>Start {PHASE_TYPES[type].label.toLowerCase()}</button>
      </div>
    </Sheet>
  );
}
