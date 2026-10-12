import React, { useState } from "react";
import { ChevronLeft, ChevronUp, ChevronDown, Trash2, Plus, Pencil, Flame } from "lucide-react";
import { InfoButton, ExercisePicker, ConfirmSheet, Sheet } from "../components/ui.jsx";
import { isCardio, isWarmup, specLine, cardioLibrary, WARMUP_MIN, PROGRAM } from "../data/program.js";
import { checkRange } from "../lib/repRange.js";

export default function ProgramEditor({ day, program, back, ops }) {
  const p = program[day];
  const [open, setOpen] = useState(null);
  const [sheet, setSheet] = useState(null);
  const hasWarmup = p.exercises.some((e) => isWarmup(e.n));

  return (
    <main className="screen" data-day={day}>
      <header className="top ruled">
        <button className="icon-btn boxed" onClick={() => back("#/settings")} aria-label="Back"><ChevronLeft size={20} /></button>
        <h1 className="top-title" data-day={day}>{p.name}</h1>
        <button className="icon-btn" onClick={() => setSheet("rename")} aria-label={`Rename ${p.name}`}><Pencil size={17} /></button>
        <span className="spacer" />
        <span className="mono small muted">{p.exercises.length} lifts</span>
        <InfoButton screen="program" />
      </header>
      <div className="body" style={{ paddingTop: 12 }}>
        <p className="small muted detail">Changes apply to future {p.name} sessions. Past sessions keep what you logged.</p>
        <div>
          {p.exercises.map((ex, i) => (
            <div key={ex.n} className="prog">
              <div className="prog-row" data-help={i === 0 ? "prog-lift" : undefined}>
                <button className="main" onClick={() => setOpen(open === ex.n ? null : ex.n)} aria-expanded={open === ex.n}>
                  <span className="name">{ex.n}{ex.custom && !isWarmup(ex.n) && <span className="ex-tag">added</span>}</span>
                  <span className="sub">{specLine(ex)}</span>
                </button>
                <button className="icon-btn" disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }} onClick={() => ops.move(day, ex.n, -1)} aria-label={`Move ${ex.n} up`}><ChevronUp size={19} /></button>
                <button className="icon-btn" disabled={i === p.exercises.length - 1} style={{ opacity: i === p.exercises.length - 1 ? 0.3 : 1 }} onClick={() => ops.move(day, ex.n, 1)} aria-label={`Move ${ex.n} down`}><ChevronDown size={19} /></button>
              </div>
              {open === ex.n && <EditLift ex={ex} onChange={(patch) => ops.update(day, ex.n, patch)} onRemove={() => { setOpen(null); ops.remove(day, ex.n); }} />}
            </div>
          ))}
        </div>
        <button className="btn btn-ghost" data-help="add-lift" onClick={() => setSheet("picker")}><Plus size={18} aria-hidden="true" /> Add a lift</button>
        {!hasWarmup && <button className="btn btn-ghost" onClick={() => setSheet("warmup")}><Flame size={18} aria-hidden="true" /> Add a cardio warm-up</button>}
        {(p.orig || PROGRAM[day]) && <button className="btn-quiet" onClick={() => setSheet("restore")}>Restore {p.name} to its original lifts</button>}
      </div>

      {sheet === "picker" && (
        <ExercisePicker title={`Add to ${p.name}`} sub="Pick from the library or create your own."
          existingNames={p.exercises.map((e) => e.n)} onClose={() => setSheet(null)}
          onPick={(ex) => { ops.add(day, ex); setSheet(null); }} />
      )}
      {sheet === "warmup" && (
        <Sheet title="Cardio warm-up" sub={`${p.name} starts with ${WARMUP_MIN} easy minutes. It's logged on its own, so a cardio finisher on the same machine stays separate.`} onClose={() => setSheet(null)} labelledBy="warmup-title">
          <div className="section">
            {cardioLibrary().map((e) => (
              <button key={e.n} className="lib-row" onClick={() => { ops.addWarmup(day, e.n); setSheet(null); }}>
                <span style={{ flex: 1 }}><span className="name">{e.n}</span><span className="sub">Warm-up · {WARMUP_MIN} min</span></span>
                <Plus size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === "rename" && <RenameDay name={p.name} onSave={(n) => ops.rename(day, n)} onClose={() => setSheet(null)} />}
      {sheet === "restore" && (
        <ConfirmSheet title={`Restore ${p.name}?`} body={`${p.name} goes back to its original lifts, sets and rest times. Other days are not changed.`}
          confirm="Restore" onClose={() => setSheet(null)} onConfirm={() => ops.restore(day)} />
      )}
    </main>
  );
}

function RenameDay({ name, onSave, onClose }) {
  const [value, setValue] = useState(name);
  return (
    <Sheet title={`Rename ${name}`} sub="Past sessions show the new name too." onClose={onClose} labelledBy="rename-day-title">
      <form className="rename-form" onSubmit={(e) => { e.preventDefault(); onSave(value); onClose(); }}>
        <input className="input" value={value} maxLength={20} enterKeyHint="done" aria-label="Workout name" onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className="btn btn-ink" disabled={!value.trim()}>Save name</button>
      </form>
    </Sheet>
  );
}

function EditLift({ ex, onChange, onRemove }) {
  // A range far from what suits this kind of lift gets a note; it's only advice, the range is theirs.
  const flag = checkRange(ex);
  const numField = (key, label, get, put) => (
    <label className="field"><span className="lbl">{label}</span>
      {/* Keyed by its value, so a change made elsewhere (Use 15–20 below) shows in the field. */}
      <input key={get} id={`${ex.n}-${key}`} className="input tn" type="number" inputMode="numeric" defaultValue={get}
        onBlur={(e) => { const v = parseInt(e.target.value); if (v > 0) onChange(put(v)); else e.target.value = get; }} /></label>
  );
  return (
    <div className="prog-edit">
      {isCardio(ex.n) ? (
        <div className="grid-2">
          {numField("min", "Min minutes", ex.reps[0], (v) => ({ reps: [v, Math.max(v, ex.reps[1])] }))}
          {numField("max", "Max minutes", ex.reps[1], (v) => ({ reps: [Math.min(v, ex.reps[0]), v] }))}
        </div>
      ) : (
        <div className="grid-4">
          {numField("sets", "Sets", ex.sets, (v) => ({ sets: v }))}
          {numField("min", "Min reps", ex.reps[0], (v) => ({ reps: [v, Math.max(v, ex.reps[1])] }))}
          {numField("max", "Max reps", ex.reps[1], (v) => ({ reps: [Math.min(v, ex.reps[0]), v] }))}
          {numField("rest", "Rest (sec)", ex.rest, (v) => ({ rest: Math.max(15, v) }))}
        </div>
      )}
      {flag && (
        <p className="range-note" role="status">
          <span>{flag.line}</span>
          <button type="button" className="chip" onClick={() => onChange({ reps: flag.suggest })}>Use {flag.suggest[0]}–{flag.suggest[1]}</button>
        </p>
      )}
      <label className="field"><span className="lbl">Cue</span>
        <textarea id={`${ex.n}-cue`} className="textarea" style={{ minHeight: 64 }} defaultValue={ex.cue || ""} placeholder="Form reminder you want to see mid-set"
          onBlur={(e) => onChange({ cue: e.target.value.trim() })} /></label>
      <button className="btn-quiet danger" onClick={onRemove} style={{ alignSelf: "flex-start" }}><Trash2 size={16} aria-hidden="true" style={{ verticalAlign: -3 }} /> Remove from program</button>
    </div>
  );
}
