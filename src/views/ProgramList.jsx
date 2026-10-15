import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, ClipboardPaste } from "lucide-react";
import { Sheet, InfoButton } from "../components/ui.jsx";
import { DAYS, allDays, activeDays } from "../data/program.js";
import { href } from "../lib/router.js";
import { COACHES } from "../data/coaches.js";

/** Settings › Program: every workout day, renaming them all at once, and bringing in a program. */
export default function ProgramList({ program, back, onRename, head = "tank" }) {
  const who = COACHES[head].name;
  const [renaming, setRenaming] = useState(false);
  return (
    <main className="screen">
      <header className="top ruled">
        <button className="icon-btn boxed" onClick={() => back("#/settings")} aria-label="Back"><ChevronLeft size={20} /></button>
        <h1 className="top-title">Program</h1>
        <span className="spacer" />
        <InfoButton screen="programs" />
      </header>
      <div className="body" style={{ paddingTop: 12 }}>
        <section className="section">
          <h2 className="lbl">Workouts</h2>
          <div className="list" data-help="program">
            {/* Built-in days show even when switched off; extra days only while in the rotation. */}
            {allDays(program).filter((d) => DAYS.includes(d) || !program[d].off).map((d) => (
              <a key={d} className="list-row" href={href("settings", "program", d)} data-day={d}>
                <span className="dot" aria-hidden="true" />
                <span className="name">{program[d].name}<span className="sub detail">{program[d].off ? "Not in your rotation" : `${program[d].detail} · ${program[d].exercises.length} lifts`}</span></span>
                <ChevronRight size={18} aria-hidden="true" className="muted" />
              </a>
            ))}
          </div>
        </section>
        <section className="section">
          <div className="list">
            <button className="list-row" data-help="rename" onClick={() => setRenaming(true)}>
              <Pencil size={18} aria-hidden="true" />
              <span className="name">Rename workouts<span className="sub detail">Call your days whatever you call them.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
            {/* The head coach's paste-and-review steps on their own, for a lifter who's already set up. */}
            <a className="list-row" data-help="import" href={href("coaches", head, "import")}>
              <ClipboardPaste size={18} aria-hidden="true" />
              <span className="name">Bring in your own program<span className="sub detail">Paste a program you already run. {who} can review it.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </a>
          </div>
        </section>
      </div>
      {renaming && <RenameSheet program={program} onRename={onRename} onClose={() => setRenaming(false)} />}
    </main>
  );
}

/* Every workout's name in one place. Names are saved together on Save; a blank field keeps the old name. */
function RenameSheet({ program, onRename, onClose }) {
  const days = activeDays(program);
  const [names, setNames] = useState(() => Object.fromEntries(days.map((d) => [d, program[d].name])));
  const save = (e) => {
    e.preventDefault();
    for (const d of days) onRename(d, names[d] || "");
    onClose();
  };
  return (
    <Sheet title="Rename workouts" sub="Past sessions show the new name too." onClose={onClose} labelledBy="rename-title">
      <form className="rename-form" onSubmit={save}>
        {days.map((d, i) => (
          <label key={d} className="field rename-field" data-day={d}>
            <span className="lbl"><span className="dot" aria-hidden="true" />Day {i + 1} · {program[d].detail}</span>
            <input className="input" value={names[d]} maxLength={20} enterKeyHint="done" placeholder={program[d].name}
              onChange={(e) => setNames((n) => ({ ...n, [d]: e.target.value }))} />
          </label>
        ))}
        <button type="submit" className="btn btn-ink">Save names</button>
      </form>
    </Sheet>
  );
}
