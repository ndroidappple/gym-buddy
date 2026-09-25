import React, { useState } from "react";
import { Scale, Check } from "lucide-react";
import Coach from "./Coach.jsx";
import { PHASE_TYPES, phaseStatus, statusLine, coachNote, wantsFinisher, phaseSummary } from "../lib/phase.js";
import { addFinisher } from "../lib/setup.js";
import { num, shortDate, today } from "../lib/util.js";

/* The bulk/cut phase on Progress. Quiet by design: one status line, one coach line, and the only
   program suggestion (a cardio finisher) appears once, and only when a cut has stalled for weeks. */
export default function PhaseCard({ phase, sessions, weighins, program, onStart, onLog, onUpdate, onEnd, onProgramChange }) {
  const [bw, setBw] = useState("");
  if (!phase) {
    return (
      <button type="button" className="card phase-card phase-empty" onClick={onStart}>
        <span className="weigh-icon" aria-hidden="true"><Scale size={22} /></span>
        <span className="phase-text"><b>Bulk or cut?</b><span>Set a short-term bodyweight goal and your coaches track the pace.</span></span>
        <span className="pill">Start</span>
      </button>
    );
  }
  const s = phaseStatus(phase, sessions, weighins);
  const t = PHASE_TYPES[phase.type];
  const coach = phase.type === "cut" ? "dash" : "tank";

  if (s.status === "done") {
    const r = phaseSummary(phase, sessions, weighins);
    return (
      <section className="card phase-card" aria-label={`${t.label} complete`}>
        <span className="lbl">{t.label} complete</span>
        <p className="phase-big">{num(r.from)} → {num(r.to)} lb <small>{r.perWeek > 0 ? "+" : r.perWeek < 0 ? "−" : ""}{num(Math.abs(r.perWeek))} lb/wk over {r.weeks} weeks</small></p>
        {r.lifts.length > 0 && (
          <ul className="phase-lifts">{r.lifts.map((l) => <li key={l.n}>{l.n}: est. max {num(l.from)} → {num(l.to)} lb</li>)}</ul>
        )}
        <div className="phase-actions">
          <button type="button" className="btn btn-day" data-day="push" onClick={() => { onEnd(r); onStart(); }}>Start another</button>
          <button type="button" className="btn btn-ghost" onClick={() => onEnd(r)}>Done</button>
        </div>
      </section>
    );
  }

  const note = coachNote(phase, s);
  const offer = onProgramChange && wantsFinisher(phase, s, program);
  const logged = weighins.some((w) => w.date === today());
  const save = (e) => {
    e.preventDefault();
    const v = parseFloat(bw);
    if (v > 50 && v < 800) { onLog(today(), Math.round(v * 10) / 10); setBw(""); }
  };
  return (
    <section className={"card phase-card phase-" + s.status} aria-label={`${t.label}, week ${s.week} of ${s.weeks}`}>
      <div className="phase-head">
        <span className="lbl">{t.label} · week {s.week} of {s.weeks}</span>
        <span className="small muted">{num(phase.startWeight)} → {num(phase.target)} lb by {shortDate(phase.end)}</span>
      </div>
      <p className="phase-big">{statusLine(phase, s)}</p>
      {note && (
        <p className="phase-coach"><span className="coach-chip"><Coach id={coach} size={28} still badge decorative /></span>{note}</p>
      )}
      {offer && (
        <div className="proposal" role="group" aria-label="Suggested change">
          <span className="proposal-head">Dash suggests</span>
          <p style={{ margin: 0, fontWeight: 600 }}>Add a 10–15 min incline walk to the end of each day to get the cut moving?</p>
          <div className="proposal-actions">
            <button type="button" className="btn btn-day" data-day="push" onClick={() => { onProgramChange(addFinisher(program).program); onUpdate({ finisherAsked: true }); }}>
              <Check size={17} strokeWidth={3} aria-hidden="true" /> Add it</button>
            <button type="button" className="btn btn-ghost" onClick={() => onUpdate({ finisherAsked: true })}>No thanks</button>
          </div>
        </div>
      )}
      <form className="phase-log" onSubmit={save}>
        <label className="weigh-field">
          <span className="sr-only">Today's weight in pounds</span>
          <input type="number" inputMode="decimal" step="0.1" placeholder={logged ? "logged" : num(s.current)} value={bw} onChange={(e) => setBw(e.target.value)} />
          <span className="u">lb</span>
        </label>
        <button type="submit" className="btn weigh-save" disabled={!(parseFloat(bw) > 50)}>{logged ? "Update" : "Log weight"}</button>
        <button type="button" className="phase-end" onClick={() => onEnd(null)}>End phase</button>
      </form>
    </section>
  );
}
