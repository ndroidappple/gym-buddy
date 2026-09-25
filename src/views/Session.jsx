import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { ChevronLeft, Check, Plus, Minus, Trash2 } from "lucide-react";
import { BorderBeam } from "border-beam";
import { fmtSet, uid, e1rm, fmtW, today, shortDate, mmss, byDateDesc, priorSessions, allTimeBest, bestSet, vibrate } from "../lib/util.js";
import { primeAudio, chime } from "../lib/sound.js";
import { Sheet, ConfirmSheet, ExercisePicker } from "../components/ui.jsx";
import Coach, { MOODS } from "../components/Coach.jsx";
import CoachChat from "../components/CoachChat.jsx";
import { useReducedMotion } from "../lib/motion.js";
import { useTheme } from "../lib/theme.js";
import { MessageCircle } from "lucide-react";
import { COACHES, coachFor } from "../data/coaches.js";
import { isCardio, specLine } from "../data/program.js";

const hasVal = (v) => v !== "" && v != null;

export default function Session({ day, existing, draft, sessions, program, weighins, prefs, back, notify, onSaveDraft, onDiscardDraft, onFinish, onUpdate, onDelete }) {
  const dayProgram = program[day];
  const [extras, setExtras] = useState(() => draft?.extras || []);
  const [skipped, setSkipped] = useState(() => draft?.skipped || []);
  const [date, setDate] = useState(existing?.date || draft?.date || today());
  const [bw, setBw] = useState(existing?.bw != null ? String(existing.bw) : draft?.bw ?? "");
  const [note, setNote] = useState(existing?.note || draft?.note || "");
  const [startedAt, setStartedAt] = useState(existing?.startedAt || draft?.startedAt || null);
  const [timer, setTimer] = useState(() => (draft?.timer?.endsAt > Date.now() ? draft.timer : null));
  const [sheet, setSheet] = useState(null); // "picker" | "details" | "delete"
  const [chat, setChat] = useState(null); // {coach, exercise} being asked
  const [flash, setFlash] = useState(null); // {ex, i} — the set that was just logged
  const [reaction, setReaction] = useState(null); // {ex, mood} — the coach's brief reaction to a logged set
  const [editing, setEditing] = useState(false); // numbers being adjusted on the active set
  const reactionTimer = useRef(null);
  useEffect(() => () => clearTimeout(reactionTimer.current), []);

  /* Re-render when rest ends so the coach wakes from "recovering". */
  const [, setTick] = useState(0);
  useEffect(() => {
    const ms = timer ? timer.endsAt - Date.now() : 0;
    if (ms <= 0) return;
    const h = setTimeout(() => setTick((x) => x + 1), ms + 50);
    return () => clearTimeout(h);
  }, [timer]);
  const resting = !!timer && timer.endsAt > Date.now();

  /* The moment this session sits at, for "what came before". */
  const here = useMemo(() => ({ id: existing?.id || "new", date, finishedAt: existing?.finishedAt || Date.now() }), [existing, date]);
  const before = useMemo(() => priorSessions(sessions, here).sort(byDateDesc), [sessions, here]);
  const lastFor = useCallback((lift) => before.find((s) => s.sets[lift]?.length) || null, [before]);

  const exercises = useMemo(() => {
    const list = [...dayProgram.exercises, ...extras.map((e) => ({ ...e, today: true }))];
    const known = new Set(list.map((e) => e.n));
    Object.keys(existing?.sets || {}).forEach((n) => {
      if (!known.has(n)) list.push({ n, sets: existing.sets[n].length, reps: [8, 12], rest: 90, cue: "", orphan: true });
    });
    return list;
  }, [dayProgram, extras, existing]);

  const buildRows = useCallback((ex) => {
    const prev = existing?.sets?.[ex.n];
    if (isCardio(ex.n)) {
      if (prev) return prev.map((s) => ({ min: String(s.min ?? ""), mi: s.mi != null ? String(s.mi) : "", done: true, saved: true }));
      const ref = lastFor(ex.n)?.sets[ex.n] || [];
      return Array.from({ length: Math.max(1, ex.sets) }, (_, i) => ({
        min: String(ref[i]?.min ?? ex.reps[0]), mi: ref[i]?.mi != null ? String(ref[i].mi) : "", done: false,
      }));
    }
    if (prev) return prev.map((s) => ({ w: String(s.w), r: String(s.r), rir: s.rir != null ? String(s.rir) : "", done: true, saved: true }));
    const ref = lastFor(ex.n)?.sets[ex.n] || [];
    const count = Math.max(ex.sets, ref.length);
    const lastW = ref.length ? String(ref[ref.length - 1].w) : "";
    return Array.from({ length: count }, (_, i) => ({
      w: ref[i] ? String(ref[i].w) : lastW,
      r: ref[i] ? String(ref[i].r) : "",
      rir: "", done: false,
    }));
  }, [existing, lastFor]);

  const [grid, setGrid] = useState(() => {
    const g = {};
    exercises.forEach((ex) => { g[ex.n] = draft?.grid?.[ex.n] || buildRows(ex); });
    return g;
  });

  useEffect(() => {
    setGrid((g) => {
      if (exercises.every((ex) => g[ex.n])) return g;
      const next = { ...g };
      exercises.forEach((ex) => { next[ex.n] ||= buildRows(ex); });
      return next;
    });
  }, [exercises, buildRows]);

  const isPending = (n) => !skipped.includes(n) && (grid[n] || []).some((r) => !r.done);
  const [focus, setFocus] = useState(() => (existing ? null : exercises.find((e) => isPending(e.n))?.n ?? null));
  const [activeIdx, setActiveIdx] = useState(null);
  // Remember which card just closed so it can animate shut, then glide the newly opened card into view.
  const prevFocus = useRef(focus);
  const closed = useRef(null);
  if (prevFocus.current !== focus) { closed.current = prevFocus.current; prevFocus.current = focus; }
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (!focus) return;
    const id = requestAnimationFrame(() => {
      const el = document.querySelector("section.ex");
      if (!el) return;
      const { top, bottom } = el.getBoundingClientRect();
      // Only move the page when the card starts under the header or runs well past the fold.
      if (top < 90 || bottom > innerHeight * 0.95) el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = exercises.filter((e) => !skipped.includes(e.n));
  const totalSlots = active.reduce((a, e) => a + (grid[e.n]?.length || 0), 0);
  const doneSlots = active.reduce((a, e) => a + (grid[e.n]?.filter((r) => r.done).length || 0), 0);

  const dirty = useMemo(() =>
    bw !== "" || note.trim() !== "" || extras.length > 0 || skipped.length > 0 ||
    Object.values(grid).some((rows) => rows.some((r) => r.done)),
  [grid, bw, note, extras, skipped]);

  const collectSets = useCallback(() => {
    const sets = {};
    Object.entries(grid).forEach(([n, rows]) => {
      if (skipped.includes(n)) return;
      if (isCardio(n)) {
        const entries = rows.filter((r) => (r.done || r.saved) && hasVal(r.min)).map((r) => ({
          min: parseFloat(r.min) || 0, ...(hasVal(r.mi) ? { mi: parseFloat(r.mi) || 0 } : {}),
        }));
        if (entries.length) sets[n] = entries;
        return;
      }
      const valid = rows.filter((r) => (r.done || r.saved) && hasVal(r.w) && hasVal(r.r)).map((r) => ({
        w: parseFloat(r.w) || 0, r: parseInt(r.r) || 0,
        ...(hasVal(r.rir) ? { rir: parseFloat(r.rir) } : {}),
      }));
      if (valid.length) sets[n] = valid;
    });
    return sets;
  }, [grid, skipped]);

  /* ── autosave: drafts for new sessions, straight write-back for edits ── */
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (!existing && !dirty) return;
    const t = setTimeout(() => {
      if (existing) {
        const sets = collectSets();
        if (Object.keys(sets).length) onUpdate({ ...existing, date, bw: bw !== "" ? parseFloat(bw) : null, note: note.trim() || null, sets });
      } else {
        onSaveDraft(day, { grid, date, bw, note, extras, skipped, timer, startedAt });
      }
    }, 500);
    return () => clearTimeout(t);
  }, [grid, date, bw, note, extras, skipped, timer, startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── keep the screen awake while training ── */
  useEffect(() => {
    let lock = null;
    const req = async () => { try { lock = await navigator.wakeLock?.request("screen"); } catch {} };
    const onVis = () => { if (document.visibilityState === "visible") req(); };
    req();
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); lock?.release?.().catch(() => {}); };
  }, []);

  /* ── editing ── */
  const setRow = (n, i, patch) => setGrid((g) => {
    const rows = [...g[n]];
    rows[i] = { ...rows[i], ...patch };
    return { ...g, [n]: rows };
  });

  const bestSoFar = (n, exceptIdx) => {
    let b = allTimeBest(before, n);
    (grid[n] || []).forEach((r, j) => { if (j !== exceptIdx && r.done && hasVal(r.w) && hasVal(r.r)) b = Math.max(b, e1rm(+r.w, +r.r)); });
    return b;
  };

  /* Cardio: no rest timer and no PRs; the coach cheers if you went longer or further than last time. */
  const logCardio = (ex, i) => {
    const row = grid[ex.n][i];
    if (!hasVal(row.min)) return;
    primeAudio();
    const same = lastFor(ex.n)?.sets[ex.n]?.[i];
    const beat = !!same && (parseFloat(row.min) > same.min || (hasVal(row.mi) && parseFloat(row.mi) > (same.mi || 0)));
    setGrid((g) => { const rows = [...g[ex.n]]; rows[i] = { ...rows[i], done: true, beat }; return { ...g, [ex.n]: rows }; });
    if (!startedAt) setStartedAt(Date.now());
    setFlash({ ex: ex.n, i });
    vibrate(20);
    setActiveIdx(null);
    setEditing(false);
    setReaction({ ex: ex.n, mood: beat ? "proud" : "hyped" });
    clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => setReaction(null), 2400);
    if (!grid[ex.n].some((r, j) => j !== i && !r.done)) {
      const idx = exercises.findIndex((e) => e.n === ex.n);
      const next = [...exercises.slice(idx + 1), ...exercises.slice(0, idx)].find((e) => isPending(e.n));
      setFocus(next ? next.n : null);
    }
  };

  const logSet = (ex, i) => {
    if (isCardio(ex.n)) { logCardio(ex, i); return; }
    const row = grid[ex.n][i];
    if (!hasVal(row.w) || !hasVal(row.r)) return;
    primeAudio();
    const score = e1rm(parseFloat(row.w) || 0, parseInt(row.r) || 0);
    const prevBest = bestSoFar(ex.n, i);
    const pr = prevBest > 0 && score > prevBest + 0.05;
    const lastSets = lastFor(ex.n)?.sets[ex.n];
    const target = bestSet(lastSets);
    const beat = !!target && score >= e1rm(target.w, target.r);
    const same = lastSets?.[i]; // the same set last time
    const below = !pr && !!same && score < e1rm(same.w, same.r) - 0.05;

    setGrid((g) => {
      const rows = [...g[ex.n]];
      rows[i] = { ...rows[i], done: true, pr, beat };
      const nx = rows.findIndex((r, j) => j > i && !r.done);
      if (nx >= 0 && !hasVal(rows[nx].w)) rows[nx] = { ...rows[nx], w: row.w };
      return { ...g, [ex.n]: rows };
    });
    if (!startedAt) setStartedAt(Date.now());
    setFlash({ ex: ex.n, i });
    vibrate(pr ? [40, 60, 40, 60, 80] : 20);
    setTimer({ endsAt: Date.now() + ex.rest * 1000, total: ex.rest, coach: coachFor(ex.n) });
    setActiveIdx(null);
    setEditing(false);
    // The coach reacts first, then settles into recovering while the rest timer runs.
    const mood = pr ? "pr" : below ? "encourage" : "hyped";
    setReaction({ ex: ex.n, mood });
    clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => setReaction(null), pr ? 3200 : below ? 3000 : 2200);

    const stillPending = grid[ex.n].some((r, j) => j !== i && !r.done);
    if (!stillPending) {
      const idx = exercises.findIndex((e) => e.n === ex.n);
      const next = [...exercises.slice(idx + 1), ...exercises.slice(0, idx)].find((e) => isPending(e.n));
      setFocus(next ? next.n : null);
    }
  };

  const reopen = (n, i) => {
    setRow(n, i, { done: false, pr: false, beat: false });
    setFocus(n);
    setActiveIdx(i);
  };

  const addSet = (n) => {
    setGrid((g) => {
      const rows = g[n];
      const last = rows[rows.length - 1];
      const row = isCardio(n) ? { min: last?.min ?? "", mi: "", done: false } : { w: last?.w ?? "", r: last?.r ?? "", rir: "", done: false };
      return { ...g, [n]: [...rows, row] };
    });
    setFocus(n);
    setActiveIdx(grid[n].length);
  };

  const removeSet = (n, i) => {
    const snapshot = grid[n];
    setGrid((g) => ({ ...g, [n]: g[n].filter((_, j) => j !== i) }));
    setActiveIdx(null);
    notify(`Set ${i + 1} removed`, () => setGrid((g) => ({ ...g, [n]: snapshot })));
  };

  const skip = (n) => {
    setSkipped((s) => [...s, n]);
    const idx = exercises.findIndex((e) => e.n === n);
    const next = exercises.slice(idx + 1).find((e) => e.n !== n && isPending(e.n));
    setFocus(next ? next.n : null);
    notify(`Skipped ${n} for today`, () => { setSkipped((s) => s.filter((x) => x !== n)); setFocus(n); });
  };

  const removeExtra = (n) => {
    const ex = extras.find((e) => e.n === n);
    const rows = grid[n];
    setExtras((xs) => xs.filter((e) => e.n !== n));
    setGrid((g) => { const c = { ...g }; delete c[n]; return c; });
    setFocus(null);
    notify(`${n} removed`, () => { setExtras((xs) => [...xs, ex]); setGrid((g) => ({ ...g, [n]: rows })); });
  };

  const finish = () => {
    const sets = collectSets();
    if (!Object.keys(sets).length) return;
    onFinish({ id: uid(), day, date, bw: bw !== "" ? parseFloat(bw) : null, note: note.trim() || null, sets, startedAt: startedAt || Date.now(), finishedAt: Date.now() });
  };

  const metaBits = [shortDate(date), bw !== "" ? `${bw} lb bodyweight` : null, note.trim() ? "note" : null].filter(Boolean);

  return (
    <main className="screen" data-day={day}>
      <div className="sticky">
        <header className="top">
          <button className="icon-btn boxed" onClick={() => back()} aria-label="Back"><ChevronLeft size={20} /></button>
          <h1 className="top-title" data-day={day}>{dayProgram.name}</h1>
          <span className="spacer" />
          <span className="pill sets-pill" aria-live="polite">{doneSlots} of {totalSlots} sets</span>
          {existing && <button className="icon-btn" onClick={() => setSheet("delete")} aria-label="Delete session"><Trash2 size={18} /></button>}
        </header>
        <div className="progress" role="progressbar" aria-label="Sets completed" aria-valuemin={0} aria-valuemax={totalSlots} aria-valuenow={doneSlots}>
          <i style={{ width: `${totalSlots ? (doneSlots / totalSlots) * 100 : 0}%` }} />
        </div>
      </div>

      <div className="body" style={{ gap: 10 }}>
        {exercises.map((ex) => {
          const rows = grid[ex.n] || [];
          const last = lastFor(ex.n);
          const target = bestSet(last?.sets[ex.n]);
          if (focus === ex.n) {
            const pendingIdx = activeIdx != null && rows[activeIdx] && !rows[activeIdx].done ? activeIdx : rows.findIndex((r) => !r.done);
            return (
              <ExerciseCard key={ex.n} ex={ex} rows={rows} target={target} targetDate={last?.date}
                refSets={last?.sets[ex.n] || []} activeIdx={pendingIdx} flash={flash?.ex === ex.n ? flash.i : null}
                mood={reaction?.ex === ex.n ? reaction.mood : resting ? "resting" : editing ? "focused" : "idle"}
                onEdit={(i, patch) => { setRow(ex.n, i, patch); setEditing(true); }} onLog={(i) => logSet(ex, i)}
                onPick={(i) => { setActiveIdx(i); setEditing(false); }} onReopen={(i) => reopen(ex.n, i)}
                onAddSet={() => addSet(ex.n)} onRemoveSet={(i) => removeSet(ex.n, i)}
                onSkip={ex.today ? () => removeExtra(ex.n) : ex.orphan ? null : () => skip(ex.n)} skipLabel={ex.today ? "Remove" : "Skip today"}
                showRir={prefs.rir} onAsk={() => setChat({ coach: coachFor(ex.n), exercise: ex.n })} onCollapse={() => setFocus(null)} />
            );
          }
          return <Collapsed key={ex.n} ex={ex} rows={rows} target={target} skipped={skipped.includes(ex.n)} justClosed={closed.current === ex.n}
            onOpen={() => { if (skipped.includes(ex.n)) setSkipped((s) => s.filter((x) => x !== ex.n)); setFocus(ex.n); setActiveIdx(null); }} />;
        })}

        <button className="btn btn-ghost" onClick={() => setSheet("picker")}><Plus size={18} aria-hidden="true" /> Add a lift or cardio</button>

        <div className="finish">
          <button className="meta-chip" onClick={() => setSheet("details")}>
            <span className="spacer"><b>{metaBits[0]}</b>{metaBits.slice(1).map((b) => ` · ${b}`)}</span>
            <span>{bw === "" ? "Add bodyweight" : "Edit"}</span>
          </button>

          {existing ? (
            <>
              <button className="btn btn-day" onClick={() => back()}><Check size={20} strokeWidth={3} aria-hidden="true" /> Done editing</button>
            </>
          ) : (
            <>
              <button className="btn btn-day" onClick={finish} disabled={!doneSlots}>Finish · {doneSlots}/{totalSlots} sets</button>
              {!doneSlots && <p className="small muted" style={{ textAlign: "center" }}>Log at least one set to finish.</p>}
              {dirty && <button className="btn-quiet danger" onClick={() => { onDiscardDraft(day); back(); }}>Discard this session</button>}
            </>
          )}
        </div>
        <div style={{ height: timer ? 120 : 16 }} />
      </div>

      {timer && <RestDock timer={timer} setTimer={setTimer} />}

      {sheet === "picker" && (
        <ExercisePicker title="Add for today" sub={`Adds to this ${dayProgram.name} session only. Change the program in Settings.`}
          existingNames={exercises.map((e) => e.n)} onClose={() => setSheet(null)}
          onPick={(ex) => { setExtras((xs) => [...xs, ex]); setFocus(ex.n); setActiveIdx(null); setSheet(null); }} />
      )}
      {sheet === "details" && (
        <Sheet title="Session details" onClose={() => setSheet(null)}>
          <div className="grid-2">
            <label className="field"><span className="lbl">Date</span>
              <input id="sess-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || today())} /></label>
            <label className="field"><span className="lbl">Bodyweight (lb)</span>
              <input id="sess-bw" className="input tn" type="number" inputMode="decimal" placeholder="—" value={bw} onChange={(e) => setBw(e.target.value)} /></label>
          </div>
          <label className="field"><span className="lbl">Note</span>
            <textarea id="sess-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Energy, niggles, gym conditions, anything worth remembering." /></label>
          <button className="btn btn-ink" onClick={() => setSheet(null)}>Done</button>
        </Sheet>
      )}
      {chat && <CoachChat coach={chat.coach} exercise={chat.exercise} sessions={sessions} program={program} weighins={weighins} onClose={() => setChat(null)} />}
      {sheet === "delete" && (
        <ConfirmSheet title="Delete session?" body={`${dayProgram.name} on ${shortDate(existing.date)} and all its sets will be removed.`}
          confirm="Delete" onClose={() => setSheet(null)} onConfirm={() => { onDelete(existing); back("#/history"); }} />
      )}
    </main>
  );
}

function Collapsed({ ex, rows, target, skipped, justClosed, onOpen }) {
  const done = rows.filter((r) => r.done);
  const complete = rows.length > 0 && done.length === rows.length;
  const prs = done.filter((r) => r.pr).length;
  const best = bestSet(done.filter((r) => hasVal(r.w) && hasVal(r.r)).map((r) => ({ w: +r.w, r: +r.r })));
  const cardio = isCardio(ex.n);
  let sub;
  if (skipped) sub = "Skipped today · tap to add back";
  else if (cardio) sub = done.length ? done.map((r) => fmtSet({ min: +r.min, mi: hasVal(r.mi) ? +r.mi : null })).join(" + ") : `Cardio · ${ex.reps[0]}–${ex.reps[1]} min`;
  else if (complete) sub = `${done.length} sets · top set ${fmtW(best.w)} × ${best.r}`;
  else sub = `${done.length}/${rows.length} sets${target ? ` · to beat ${fmtW(target.w)} × ${target.r}` : ""}`;
  return (
    <button className={"ex-collapsed" + (skipped ? " skipped" : complete ? "" : " pending") + (justClosed ? " just-closed" : "")} onClick={onOpen}>
      <SetRing done={done.length} total={rows.length} skipped={skipped} />
      <span className="name">{ex.n}{ex.today && <span className="ex-tag">today</span>}<span className="sub">{sub}</span></span>
      {prs > 0 && !skipped && <span className="stamp">PR{prs > 1 ? ` ×${prs}` : ""}</span>}
    </button>
  );
}

/* Sets done as a ring in the day's colour; a check once every set is in, a dash when skipped. */
function SetRing({ done, total, skipped }) {
  const C = 2 * Math.PI * 15;
  const complete = total > 0 && done === total;
  return (
    <span className={"set-ring" + (complete && !skipped ? " complete" : "")} aria-hidden="true">
      {complete && !skipped ? <Check size={16} strokeWidth={3.4} /> : skipped ? <Minus size={16} strokeWidth={3} /> : (
        <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" className="set-ring-trk" />
          <circle cx="18" cy="18" r="15" className="set-ring-val" strokeDasharray={C} strokeDashoffset={C * (1 - (total ? done / total : 0))} transform="rotate(-90 18 18)" /></svg>
      )}
    </span>
  );
}

function ExerciseCard({ ex, showRir, rows, target, targetDate, refSets, activeIdx, flash, mood, onAsk, onEdit, onLog, onPick, onReopen, onAddSet, onRemoveSet, onSkip, skipLabel, onCollapse }) {
  const id = coachFor(ex.n);
  const coach = COACHES[id];
  // Calm moods read the form cue; reactions say their own line.
  const line = (mood === "idle" || mood === "focused") && ex.cue ? ex.cue : MOODS[mood].line;
  const cardio = isCardio(ex.n);
  const lastEntry = cardio ? refSets[0] : null;
  const reduced = useReducedMotion();
  const theme = useTheme();
  return (
    <section className="ex" aria-label={ex.n}>
      {/* Comic layout: the bubble's tail points down at the coach who says it. */}
      <div className="ex-coach" style={{ "--c": coach.color }}>
        <p className="coach-bubble says-down" aria-live="polite">{line}</p>
        <div className="ex-coach-row">
          <Coach id={id} mood={mood} size={60} />
          <span className="who"><b>{coach.name}</b>{coach.group} coach</span>
          <button className="ask-btn" onClick={onAsk}><MessageCircle size={15} strokeWidth={2.6} aria-hidden="true" /> Ask {coach.name}</button>
        </div>
      </div>
      <div className="ex-head">
        <button style={{ flex: 1, textAlign: "left", minWidth: 0 }} onClick={onCollapse} aria-label={`${ex.n}, collapse`}>
          <div className="ex-name">{ex.n}{ex.today && <span className="ex-tag">today</span>}{ex.orphan && <span className="ex-tag">off program</span>}</div>
          <div className="ex-spec">{specLine(ex)}</div>
        </button>
        {cardio
          ? lastEntry && <span className="target" title={`Last time, ${shortDate(targetDate)}`}>Beat {fmtSet(lastEntry)}</span>
          : target && <span className="target" title={`Best set on ${shortDate(targetDate)}`}>Beat {fmtW(target.w)} × {target.r}</span>}
      </div>
      {!(cardio ? lastEntry : target) && <p className="target-none">First time logging this one. Today sets the baseline.</p>}

      <div>
        {rows.map((r, i) => {
          if (r.done && cardio) {
            const label = fmtSet({ min: +r.min, mi: hasVal(r.mi) ? +r.mi : null });
            return (
              <button key={i} className="done-row" onClick={() => onReopen(i)} aria-label={`Entry ${i + 1}: ${label}. Tap to edit.`}>
                <span className="n">{i + 1}</span>
                <span className="w">{label}{r.beat ? <span className="beat-mark">▲ beat</span> : null}</span>
                <span />
                <span className={"ck" + (flash === i ? " fill" : "")} aria-hidden="true"><Check size={18} strokeWidth={3} /></span>
              </button>
            );
          }
          if (r.done) {
            const row = (
              <button key={i} className={"done-row" + (r.pr ? " is-pr" : "")} onClick={() => onReopen(i)} aria-label={`Set ${i + 1}: ${fmtW(+r.w)} by ${r.r}${r.pr ? ", personal record" : ""}. Tap to edit.`}>
                <span className="n">{i + 1}</span>
                <span className="w">{fmtW(+r.w)} × {r.r}{r.pr ? <span className={"stamp" + (flash === i ? " hit" : "")}>PR</span> : r.beat ? <span className="beat-mark">▲ beat</span> : null}</span>
                <span className="small muted">{showRir && hasVal(r.rir) ? `RIR ${r.rir}` : ""}</span>
                <span className={"ck" + (flash === i ? " fill" : "")} aria-hidden="true"><Check size={18} strokeWidth={3} /></span>
              </button>
            );
            // PR sets get the bold travelling rim (the rest timer uses the quieter line beam).
            return r.pr ? <BorderBeam key={i} size="md" colorVariant="sunset" theme={theme} active={!reduced} className="pr-beam">{row}</BorderBeam> : row;
          }
          if (i === activeIdx && cardio) {
            return <CardioSet key={i} i={i} ex={ex} row={r} last={refSets[i]} canRemove={rows.length > 1}
              onEdit={(patch) => onEdit(i, patch)} onLog={() => onLog(i)} onRemove={() => onRemoveSet(i)} />;
          }
          if (i === activeIdx) {
            return <ActiveSet key={i} i={i} ex={ex} showRir={showRir} row={r} last={refSets[i]} canRemove={rows.length > 1}
              onEdit={(patch) => onEdit(i, patch)} onLog={() => onLog(i)} onRemove={() => onRemoveSet(i)} />;
          }
          return (
            <button key={i} className="pending-row" onClick={() => onPick(i)} aria-label={`${cardio ? "Entry" : "Set"} ${i + 1}, not logged. Tap to enter.`}>
              <span>{i + 1}</span>
              <span>{cardio ? `${hasVal(r.min) ? r.min : "—"} min` : `${hasVal(r.w) ? fmtW(+r.w) : "—"} × ${hasVal(r.r) ? r.r : "—"}`}</span>
              <span>{refSets[i] ? `last time ${cardio ? fmtSet(refSets[i]) : `${fmtW(refSets[i].w)} × ${refSets[i].r}`}` : ""}</span>
            </button>
          );
        })}
      </div>

      <div className="ex-foot">
        <button className="btn-quiet" onClick={onAddSet}><Plus size={16} aria-hidden="true" style={{ verticalAlign: -3 }} /> {cardio ? "Add interval" : "Add set"}</button>
        <span className="spacer" />
        {onSkip && <button className="btn-quiet" onClick={onSkip}>{skipLabel}</button>}
      </div>
    </section>
  );
}

function CardioSet({ i, ex, row, last, canRemove, onEdit, onLog, onRemove }) {
  const bump = (field, step, digits) => {
    const next = Math.max(0, (parseFloat(row[field]) || 0) + step);
    onEdit({ [field]: String(Math.round(next * 10 ** digits) / 10 ** digits) });
  };
  return (
    <div className="active-set">
      <div className="set-head">
        <span>{i ? `Interval ${i + 1}` : "Today"}</span><span className="spacer" />
        {last && <span className="lbl">last time {fmtSet(last)}</span>}
      </div>
      <div className="steppers">
        <Stepper id={`min-${i}`} label="Minutes" unit="min" value={row.min} mode="decimal" placeholder={`${ex.reps[0]}–${ex.reps[1]}`}
          onChange={(v) => onEdit({ min: v })} onDec={() => bump("min", -5, 0)} onInc={() => bump("min", 5, 0)} step="5 minutes" />
        <Stepper id={`mi-${i}`} label="Distance" unit="miles" value={row.mi} mode="decimal" placeholder="optional"
          onChange={(v) => onEdit({ mi: v })} onDec={() => bump("mi", -0.1, 1)} onInc={() => bump("mi", 0.1, 1)} step="a tenth of a mile" />
      </div>
      <button className="btn btn-day" onClick={onLog} disabled={!hasVal(row.min)}>{hasVal(row.min) ? "Log cardio" : "Enter minutes"}</button>
      {canRemove && <button className="btn-quiet" onClick={onRemove}>Remove this interval</button>}
    </div>
  );
}

function ActiveSet({ i, ex, showRir, row, last, canRemove, onEdit, onLog, onRemove }) {
  const bump = (field, step) => {
    const cur = parseFloat(row[field]) || 0;
    const next = Math.max(0, Math.round((cur + step) * 10) / 10);
    onEdit({ [field]: String(next) });
  };
  const ready = hasVal(row.w) && hasVal(row.r);
  return (
    <div className="active-set">
      <div className="set-head">
        <span>Set {i + 1}</span><span className="spacer" />
        {last && <span className="lbl">last time {fmtW(last.w)} × {last.r}</span>}
      </div>
      <div className="steppers">
        <Stepper id={`w-${i}`} label="Weight" unit={row.w === "0" ? "bodyweight" : "lb"} value={row.w} mode="decimal"
          onChange={(v) => onEdit({ w: v })} onDec={() => bump("w", -5)} onInc={() => bump("w", 5)} step="5 pounds" />
        <Stepper id={`r-${i}`} label="Reps" unit="reps" value={row.r} mode="numeric" placeholder={`${ex.reps[0]}–${ex.reps[1]}`}
          onChange={(v) => onEdit({ r: v })} onDec={() => bump("r", -1)} onInc={() => bump("r", 1)} step="1 rep" />
      </div>
      {showRir && (
        <div className="rir" role="group" aria-label="Reps in reserve (optional)">
          <span className="lbl">RIR</span>
          {["0", "1", "2", "3", "4"].map((v) => (
            <button key={v} aria-pressed={row.rir === v} onClick={() => onEdit({ rir: row.rir === v ? "" : v })}>{v === "4" ? "4+" : v}</button>
          ))}
        </div>
      )}
      <button className="btn btn-day" onClick={onLog} disabled={!ready}>{ready ? "Log set" : "Enter weight and reps"}</button>
      {canRemove && <button className="btn-quiet" onClick={onRemove}>Remove this set</button>}
    </div>
  );
}

function Stepper({ id, label, unit, value, mode, placeholder, onChange, onDec, onInc, step }) {
  return (
    <div className="stepper">
      <label htmlFor={id}>
        <span className="sr-only">{label}</span>
        <input id={id} type="number" inputMode={mode} value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} onFocus={(e) => e.target.select()} />
        <span className="u">{unit}</span>
      </label>
      <div className="stepper-btns">
        <button onClick={onDec} aria-label={`${label} down ${step}`}><Minus size={20} /></button>
        <button onClick={onInc} aria-label={`${label} up ${step}`}><Plus size={20} /></button>
      </div>
    </div>
  );
}

function RestDock({ timer, setTimer }) {
  const [now, setNow] = useState(Date.now());
  const alerted = useRef(false);
  useEffect(() => { alerted.current = timer.endsAt <= Date.now(); }, [timer.endsAt]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
  const over = left === 0;
  useEffect(() => {
    if (over && !alerted.current) { alerted.current = true; chime(); vibrate([200, 100, 200]); }
  }, [over]);
  const adjust = (d) => setTimer((t) => ({ ...t, endsAt: Math.max(Date.now(), t.endsAt + d * 1000), total: Math.max(15, t.total + d) }));
  const reduced = useReducedMotion();
  const theme = useTheme();
  return (
    // Line beam runs only while resting (a 60–120 s wait); the line type ignores reduced motion, so gate it here.
    <BorderBeam size="line" theme={theme} active={!over && !reduced} className="rest-wrap">
      <div className={"rest" + (over ? " over" : "")} role="timer" aria-label="Rest timer">
        <Coach id={timer.coach || "tank"} mood={over ? "focused" : "resting"} size={46} decorative />
        <div className="rest-text">
          <span className="rest-line">{over ? "Rest over. Next set!" : MOODS.resting.line}</span>
          <span className="clock" aria-live={over ? "assertive" : "off"} aria-label={over ? "Rest over" : `${mmss(left)} of ${mmss(timer.total)} rest left`}>{over ? "Go" : mmss(left)}</span>
        </div>
        {!over && <button className="rb" onClick={() => adjust(-15)} aria-label="Remove 15 seconds">−15</button>}
        {!over && <button className="rb" onClick={() => adjust(15)} aria-label="Add 15 seconds">+15</button>}
        <button className="rb primary" onClick={() => setTimer(null)}>{over ? "Dismiss" : "Skip"}</button>
      </div>
    </BorderBeam>
  );
}
