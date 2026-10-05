import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { ChevronLeft, Check, Plus, Minus, Trash2, Bell, BellOff } from "lucide-react";
import { BorderBeam } from "border-beam";
import { fmtSet, uid, e1rm, fmtW, today, shortDate, mmss, byDateDesc, priorSessions, allTimeBest, bestSet, vibrate, readyToIncrease, nextGoal, fmtGoal, weightStep, bodyweightSeries, daysBetween } from "../lib/util.js";
import { primeAudio, chime } from "../lib/sound.js";
import { restAlertState, scheduleRestAlert, cancelRestAlert, enableRestAlerts, declineRestAlerts, warmRestAlerts } from "../lib/restAlerts.js";
import { Sheet, ConfirmSheet, ExercisePicker } from "../components/ui.jsx";
import Coach, { MOODS } from "../components/Coach.jsx";
import CoachChat from "../components/CoachChat.jsx";
import { useReducedMotion } from "../lib/motion.js";
import { useTheme } from "../lib/theme.js";
import { MessageCircle } from "lucide-react";
import { nextSetAdvice, openingAdvice } from "../lib/setCoach.js";
import { anchorOf, doInstead, swapsFor } from "../lib/busy.js";
import { loadFrom, loadIn, learnK, adjustedSeries } from "../lib/fatigue.js";
import BusySheet from "../components/BusySheet.jsx";
import { COACHES, coachFor } from "../data/coaches.js";
import { isCardio, specLine } from "../data/program.js";

const hasVal = (v) => v !== "" && v != null;

export default function Session({ day, existing, draft, sessions, program, weighins, prefs, back, notify, onSaveDraft, onDiscardDraft, onFinish, onUpdate, onDelete, onProgramChange, nutrition }) {
  const dayProgram = program[day];
  const [extras, setExtras] = useState(() => draft?.extras || []);
  const [skipped, setSkipped] = useState(() => draft?.skipped || []);
  // Machine busy: lifts put off until later (shown last), and lifts swapped for another today ({ orig: swap }).
  const [later, setLater] = useState(() => draft?.later || []);
  const [swaps, setSwaps] = useState(() => draft?.swaps || {});
  // The order lifts were actually done in: [{ n, at }] as each lift's first set is logged.
  const [order, setOrder] = useState(() => draft?.order || existing?.order || []);
  const [busy, setBusy] = useState(null); // the lift whose machine is taken, while its sheet is open
  const [date, setDate] = useState(existing?.date || draft?.date || today());
  const [bw, setBw] = useState(existing?.bw != null ? String(existing.bw) : draft?.bw ?? "");
  const [note, setNote] = useState(existing?.note || draft?.note || "");
  const [startedAt, setStartedAt] = useState(existing?.startedAt || draft?.startedAt || null);
  const [timer, setTimer] = useState(() => (draft?.timer?.endsAt > Date.now() ? draft.timer : null));
  const [sheet, setSheet] = useState(null); // "picker" | "details" | "delete"
  const [chat, setChat] = useState(null); // {coach, exercise} being asked
  const [flash, setFlash] = useState(null); // {ex, i} — the set that was just logged
  const [reaction, setReaction] = useState(null); // {ex, mood} — the coach's brief reaction to a logged set
  // The coach's call after each logged set, per lift: { w, r, line, kind } (see lib/setCoach.js).
  const [advice, setAdvice] = useState(() => draft?.advice || {});
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
  /** This lift's sets from earlier sessions, newest first (for the coach's read on fatigue and form). */
  const historyFor = useCallback((lift) => before.filter((s) => s.sets[lift]?.length).map((s) => s.sets[lift]), [before]);
  /** Fatigue for a lift: what's been done before it today, how it's been done before, this lifter's rate. */
  const fatigueFor = (lift) => {
    // Lifts started before this one (all logged lifts, if this one hasn't started yet).
    const mine = order.findIndex((o) => o.n === lift);
    const earlier = (mine >= 0 ? order.slice(0, mine) : order).map((o) => o.n)
      .map((n) => ({ n, sets: (grid[n] || []).filter((r) => r.done && hasVal(r.w) && hasVal(r.r)).map((r) => ({ w: +r.w, r: +r.r })) }));
    const past = before.filter((s) => s.sets[lift]?.length);
    const k = learnK(past, lift);
    const fresh = adjustedSeries(past, lift, k);
    return { now: loadFrom(earlier, lift), past: past.map((s) => loadIn(s, lift)), k, best: fresh.length ? Math.max(...fresh.map((x) => x.fresh)) : 0 };
  };
  // Bodyweight counts in the load for pull-ups and dips: today's entry, else the latest on record.
  const bodyweight = useMemo(() => (bw !== "" && +bw > 0 ? +bw : bodyweightSeries(sessions, weighins).at(-1)?.bw || 180), [bw, sessions, weighins]);

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
    // Earned a weight increase last time: every set starts at the new weight, reps start fresh.
    const bump = readyToIncrease(ex, ref);
    if (bump) return Array.from({ length: ex.sets }, () => ({ w: String(bump.to), r: "", rir: "", done: false, asked: { w: bump.to, r: ex.reps[0] } }));
    const count = Math.max(ex.sets, ref.length);
    const lastW = ref.length ? String(ref[ref.length - 1].w) : "";
    // Last time's numbers, with the goal (see nextGoal) filled into its set: logging as-is makes progress.
    const goal = nextGoal(ex, ref);
    return Array.from({ length: count }, (_, i) => {
      const w = goal && i === goal.idx ? String(goal.w) : ref[i] ? String(ref[i].w) : lastW;
      const r = goal && i === goal.idx ? String(goal.r) : ref[i] ? String(ref[i].r) : "";
      return { w, r, rir: "", done: false, asked: w !== "" && r !== "" ? { w: +w, r: +r } : null };
    });
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

  // Lifts put off for a busy machine come after the rest, in the order they were put off.
  // A swap stands where the lift it replaced was.
  const ordered = useMemo(() => {
    const base = [];
    for (const e of exercises.filter((x) => !x.swappedFor)) {
      base.push(e);
      const sw = exercises.find((x) => x.swappedFor === e.n);
      if (sw) base.push(sw);
    }
    for (const e of exercises) if (e.swappedFor && !base.includes(e)) base.push(e);
    return [...base.filter((e) => !later.includes(e.n)), ...later.map((n) => base.find((e) => e.n === n)).filter(Boolean)];
  }, [exercises, later]);
  const anchor = useMemo(() => anchorOf(dayProgram.exercises), [dayProgram]);
  /** The next lift to open after `n`: the next one still to do in the working order. */
  const nextAfter = (n) => { const i = ordered.findIndex((e) => e.n === n); return [...ordered.slice(i + 1), ...ordered.slice(0, i)].find((e) => e.n !== n && isPending(e.n)) || null; };
  const isPending = (n) => !skipped.includes(n) && (grid[n] || []).some((r) => !r.done);
  const [focus, setFocus] = useState(() => (existing ? null : exercises.find((e) => isPending(e.n))?.n ?? null));
  /** The coach's plan before a lift's first set (last time, today's goal, warm-ups, fatigue), or null. */
  const openingFor = (ex, rows) => {
    if (existing || isCardio(ex.n) || rows.some((r) => r.done)) return null;
    const last = lastFor(ex.n);
    const firstLift = !Object.entries(grid).some(([n, rs]) => n !== ex.n && rs.some((r) => r.done));
    return openingAdvice({ ex, history: historyFor(ex.n), firstLift, daysSince: last ? daysBetween(last.date, date) : null, fatigue: fatigueFor(ex.n) });
  };
  // When a lift opens, its first set takes the coach's opening numbers (which count today's fatigue),
  // unless the lifter already typed their own.
  useEffect(() => {
    const ex = focus && exercises.find((e) => e.n === focus);
    if (!ex) return;
    const o = openingFor(ex, grid[ex.n] || []);
    const first = (grid[ex.n] || [])[0];
    if (!o || !first || first.touched || (first.asked && +first.asked.w === o.w && +first.asked.r === o.r)) return;
    setGrid((g) => ({ ...g, [ex.n]: g[ex.n].map((r, j) => (j === 0 ? { ...r, w: String(o.w), r: String(o.r), asked: { w: o.w, r: o.r } } : r)) }));
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const allDone = !existing && totalSlots > 0 && doneSlots === totalSlots;

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
        onSaveDraft(day, { grid, date, bw, note, extras, skipped, timer, startedAt, advice, later, swaps, order });
      }
    }, 500);
    return () => clearTimeout(t);
  }, [grid, date, bw, note, extras, skipped, timer, startedAt, advice, later, swaps, order]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── rest alerts: a push when rest is over, sent by the server so it arrives with the phone locked ──
     Scheduled when rest starts, moved by +15/−15, cancelled by Skip, Finish or Discard, and not sent
     after the last set. `alertSet` drives the dock's bell: true set, false couldn't (offline). */
  const [alerts, setAlerts] = useState(restAlertState);
  const [alertSet, setAlertSet] = useState(null);
  const alertPending = useRef(false);
  useEffect(() => {
    if (existing) return;
    const ms = timer ? timer.endsAt - Date.now() : 0;
    if (ms <= 0 || allDone || alerts !== "on") {
      if (alertPending.current) cancelRestAlert();
      alertPending.current = false;
      setAlertSet(null);
      return;
    }
    let alive = true;
    alertPending.current = true;
    scheduleRestAlert({ seconds: ms / 1000, title: "Rest over", body: timer.alert || "Time for your next set.", url: "/" + location.hash })
      .then((ok) => { if (alive) setAlertSet(ok); });
    return () => { alive = false; };
  }, [timer?.endsAt, allDone, alerts]); // eslint-disable-line react-hooks/exhaustive-deps
  const [askAlerts, setAskAlerts] = useState(false); // the one-time "turn on rest alerts?" card
  useEffect(() => { if (timer && alerts === "ask" && !existing) { setAskAlerts(true); warmRestAlerts().catch(() => {}); } }, [timer, alerts, existing]);
  const turnOnAlerts = async () => {
    try {
      const s = await enableRestAlerts();
      setAlerts(s);
      if (s === "on") notify("Rest alerts on. Using a Focus? Allow GymBuddy in it.");
    } catch {
      notify("Couldn't turn on rest alerts. Check your connection, then try in Settings.");
    }
    setAskAlerts(false);
  };
  const skipAlerts = () => { declineRestAlerts(); setAlerts("off"); setAskAlerts(false); };

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
    if (!grid[ex.n].some((r, j) => j !== i && !r.done)) setFocus(nextAfter(ex.n)?.n ?? null);
  };

  const noteOrder = (n) => setOrder((o) => (o.some((x) => x.n === n) ? o : [...o, { n, at: Date.now() }]));
  const logSet = (ex, i) => {
    if (!existing) noteOrder(ex.n);
    if (isCardio(ex.n)) { logCardio(ex, i); return; }
    const row = grid[ex.n][i];
    if (!hasVal(row.w) || !hasVal(row.r)) return;
    primeAudio();
    const score = e1rm(parseFloat(row.w) || 0, parseInt(row.r) || 0);
    const prevBest = bestSoFar(ex.n, i);
    const pr = prevBest > 0 && score > prevBest + 0.05;
    const lastSets = lastFor(ex.n)?.sets[ex.n];
    const target = bestSet(lastSets);
    const beat = !!target && score > e1rm(target.w, target.r) + 0.05;
    const matched = !beat && !!target && score >= e1rm(target.w, target.r) - 0.05;
    const same = lastSets?.[i]; // the same set last time
    const below = !pr && !!same && score < e1rm(same.w, same.r) - 0.05;

    // The coach reads the set (vs what was asked, earlier sets today, and history) and calls the next one.
    const doneToday = grid[ex.n].map((r, j) => (j === i ? r : r.done ? r : null)).filter((r) => r && hasVal(r.w) && hasVal(r.r))
      .map((r) => ({ w: +r.w, r: +r.r, rir: hasVal(r.rir) ? +r.rir : null }));
    const left = grid[ex.n].filter((r, j) => j !== i && !r.done).length;
    const fat = existing ? null : fatigueFor(ex.n);
    const call = existing ? null : nextSetAdvice({ ex, done: doneToday, asked: row.asked, left, history: historyFor(ex.n), best: fat.best || allTimeBest(before, ex.n), pr, bodyweight, load: fat.now, k: fat.k });
    if (call) setAdvice((a) => ({ ...a, [ex.n]: call }));

    setGrid((g) => {
      const rows = [...g[ex.n]];
      rows[i] = { ...rows[i], done: true, pr, beat, matched };
      const nx = rows.findIndex((r, j) => j > i && !r.done);
      // The next set takes the coach's numbers, unless the lifter already typed their own.
      if (nx >= 0 && call?.w != null && !rows[nx].touched) rows[nx] = { ...rows[nx], w: String(call.w), r: String(call.r), asked: { w: call.w, r: call.r } };
      else if (nx >= 0 && !hasVal(rows[nx].w)) rows[nx] = { ...rows[nx], w: row.w };
      return { ...g, [ex.n]: rows };
    });
    // Finishing the planned sets at the top of the rep range earns more weight next time.
    const doneNow = grid[ex.n].map((r, j) => (j === i ? { ...r, done: true } : r)).filter((r) => r.done && hasVal(r.w) && hasVal(r.r));
    const earned = doneNow.length >= ex.sets && readyToIncrease(ex, doneNow.map((r) => ({ w: +r.w, r: +r.r })));
    if (earned && !call) notify(`${ex.n}: ${earned.sets} × ${earned.reps} done. Go up to ${fmtW(earned.to)} lb next time.`); // the coach's wrap-up says it otherwise
    if (!startedAt) setStartedAt(Date.now());
    setFlash({ ex: ex.n, i });
    vibrate(pr ? [40, 60, 40, 60, 80] : 20);
    const next = call?.w != null ? `${fmtW(call.w)} × ${call.r}` : null;
    // What the lock-screen alert says when this rest is over: the next set, or the next lift.
    const more = grid[ex.n].some((r, j) => j !== i && !r.done);
    const upNext = more ? null : nextAfter(ex.n)?.n;
    const alert = more ? `Next: ${ex.n}${next ? ` ${next}` : ""}` : upNext ? `Next up: ${upNext}` : "Time for your next set.";
    setTimer({ endsAt: Date.now() + ex.rest * 1000, total: ex.rest, coach: coachFor(ex.n), next, alert });
    setActiveIdx(null);
    setEditing(false);
    // The coach reacts first, then settles into recovering while the rest timer runs.
    const mood = pr ? "pr" : below ? "encourage" : "hyped";
    setReaction({ ex: ex.n, mood });
    clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => setReaction(null), pr ? 3200 : below ? 3000 : 2200);

    const stillPending = grid[ex.n].some((r, j) => j !== i && !r.done);
    if (!stillPending) setFocus(nextAfter(ex.n)?.n ?? null);
  };

  const reopen = (n, i) => {
    setRow(n, i, { done: false, pr: false, beat: false, matched: false });
    setAdvice((a) => { const c = { ...a }; delete c[n]; return c; }); // re-read once it's logged again
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
    setFocus(nextAfter(n)?.n ?? null);
    notify(`Skipped ${n} for today`, () => { setSkipped((s) => s.filter((x) => x !== n)); setFocus(n); });
  };

  /* ── machine busy ── */
  const putOff = (n) => setLater((l) => [...l.filter((x) => x !== n), n]);
  const busyDoNow = (n, other) => { putOff(n); setBusy(null); setFocus(other); setActiveIdx(null); notify(`${n} moved to later. Back to it when the machine frees up.`); };
  const busyLater = (n) => {
    putOff(n); setBusy(null);
    const pending = ordered.filter((e) => e.n !== n && isPending(e.n)).map((e) => e.n);
    setFocus(doInstead(n, pending, anchor)[0]?.n ?? null);
    setActiveIdx(null);
  };
  // Swap for today: the stand-in takes the lift's sets, reps and rest; the original sits out today.
  const busySwap = (n, sw) => {
    const orig = exercises.find((e) => e.n === n);
    setExtras((xs) => [...xs, { ...sw, sets: orig.sets, reps: orig.reps, rest: orig.rest, swappedFor: n }]);
    setSkipped((s) => [...s.filter((x) => x !== n), n]);
    setSwaps((s) => ({ ...s, [n]: sw.n }));
    setBusy(null); setFocus(sw.n); setActiveIdx(null);
    notify(`${sw.n} instead of ${n} today`, () => {
      setExtras((xs) => xs.filter((e) => e.n !== sw.n)); setSkipped((s) => s.filter((x) => x !== n));
      setSwaps((s) => { const c = { ...s }; delete c[n]; return c; }); setFocus(n);
    });
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
    cancelRestAlert();
    // The order lifts were done in, and any swaps, travel with the session (for fair comparisons later).
    const done = order.filter((o) => sets[o.n]);
    onFinish({ id: uid(), day, date, bw: bw !== "" ? parseFloat(bw) : null, note: note.trim() || null, sets, startedAt: startedAt || Date.now(), finishedAt: Date.now(),
      ...(done.length ? { order: done } : {}), ...(Object.keys(swaps).length ? { swaps } : {}) });
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
        {ordered.map((ex) => {
          const rows = grid[ex.n] || [];
          const last = lastFor(ex.n);
          const target = bestSet(last?.sets[ex.n]);
          const bump = readyToIncrease(ex, last?.sets[ex.n]);
          const goal = bump || isCardio(ex.n) ? null : nextGoal(ex, last?.sets[ex.n]);
          const call = advice[ex.n];
          if (focus === ex.n) {
            // Before the first set: last time, today's goal, and warm-ups if it's the first lift of the day.
            const opening = openingFor(ex, rows);
            const pendingIdx = activeIdx != null && rows[activeIdx] && !rows[activeIdx].done ? activeIdx : rows.findIndex((r) => !r.done);
            return (
              <ExerciseCard key={ex.n} ex={ex} rows={rows} target={target} goal={goal} targetDate={last?.date} bump={bump} call={call} opening={opening}
                refSets={last?.sets[ex.n] || []} activeIdx={pendingIdx} flash={flash?.ex === ex.n ? flash.i : null}
                mood={reaction?.ex === ex.n ? reaction.mood : resting ? "resting" : editing ? "focused" : "idle"}
                onEdit={(i, patch) => { setRow(ex.n, i, { ...patch, touched: true }); setEditing(true); }} onLog={(i) => logSet(ex, i)}
                onPick={(i) => { setActiveIdx(i); setEditing(false); }} onReopen={(i) => reopen(ex.n, i)}
                onAddSet={() => addSet(ex.n)} onRemoveSet={(i) => removeSet(ex.n, i)}
                onHint={() => notify("Hold a set to edit it, or swipe left to delete it.")}
                onSkip={ex.today ? () => removeExtra(ex.n) : ex.orphan ? null : () => skip(ex.n)} skipLabel={ex.today ? "Remove" : "Skip today"}
                onBusy={existing || !isPending(ex.n) ? null : () => setBusy(ex.n)}
                showRir={prefs.rir} onAsk={() => setChat({ coach: coachFor(ex.n), exercise: ex.n })} onCollapse={() => setFocus(null)} />
            );
          }
          return <Collapsed key={ex.n} ex={ex} rows={rows} goal={goal} bump={bump} call={call} later={later.includes(ex.n) && isPending(ex.n)} swappedTo={swaps[ex.n]} skipped={skipped.includes(ex.n)} justClosed={closed.current === ex.n}
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
              {!allDone && <button className="btn btn-day" onClick={finish} disabled={!doneSlots}>Finish · {doneSlots}/{totalSlots} sets</button>}
              {!doneSlots && <p className="small muted" style={{ textAlign: "center" }}>Log at least one set to finish.</p>}
              {dirty && <button className="btn-quiet danger" onClick={() => { cancelRestAlert(); onDiscardDraft(day); back(); }}>Discard this session</button>}
            </>
          )}
        </div>
        <div style={{ height: timer || allDone ? (askAlerts && timer && !allDone ? 250 : 120) : 16 }} />
      </div>

      {/* Every set in: Finish takes the dock's place, so it's one tap away instead of a scroll. */}
      {allDone ? <FinishDock sets={doneSlots} onFinish={finish} /> : timer && (
        <>
          {askAlerts && (
            <div className="alert-ask" role="dialog" aria-labelledby="alert-ask-title">
              <p id="alert-ask-title"><b>Rest alerts</b> Get a heads-up when rest is over, even with your phone locked.</p>
              <div className="alert-ask-actions">
                <button className="btn-quiet" onClick={skipAlerts}>Not now</button>
                <button className="btn btn-ink" onClick={turnOnAlerts}>Turn on</button>
              </div>
            </div>
          )}
          <RestDock timer={timer} setTimer={setTimer} alertSet={alertSet} />
        </>
      )}

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
      {busy && (
        <BusySheet lift={busy} isAnchor={busy === anchor} started={grid[busy]?.some((r) => r.done)}
          doNow={doInstead(busy, ordered.filter((e) => e.n !== busy && isPending(e.n)).map((e) => e.n), anchor).slice(0, 3)}
          swaps={swapsFor(busy, { program, sessions, exclude: exercises.map((e) => e.n), limit: 4 })}
          onDoNow={(n) => busyDoNow(busy, n)} onSwap={(sw) => busySwap(busy, sw)} onLater={() => busyLater(busy)} onClose={() => setBusy(null)} />
      )}
      {chat && <CoachChat key={`${chat.coach}|${chat.exercise}`} coach={chat.coach} exercise={chat.exercise} sessions={sessions} program={program} weighins={weighins} profile={prefs.profile} phase={prefs.phase} nutrition={nutrition}
        live={liveContext(exercises, grid, advice, chat.exercise)} onProgramChange={onProgramChange} onClose={() => setChat(null)} />}
      {sheet === "delete" && (
        <ConfirmSheet title="Delete session?" body={`${dayProgram.name} on ${shortDate(existing.date)} and all its sets will be removed.`}
          confirm="Delete" onClose={() => setSheet(null)} onConfirm={() => { onDelete(existing); back("#/progress/workouts"); }} />
      )}
    </main>
  );
}

/** This workout so far, for the coach chat: each lift's logged sets and the coach's current call. */
function liveContext(exercises, grid, advice, current) {
  // The lift they asked from comes first and is named as the one they're on, so "should my arms be
  // parallel?" is answered for that lift, not whichever one was logged last.
  const cur = exercises.find((e) => e.n === current);
  const head = cur ? [
    `RIGHT NOW the lifter is on: ${cur.n} (plan ${cur.sets}x${cur.reps[0]}-${cur.reps[1]}${isCardio(cur.n) ? " min" : ""}, ${(grid[cur.n] || []).filter((r) => r.done).length} of ${(grid[cur.n] || []).length} sets done${cur.cue ? `; form cue: ${cur.cue}` : ""}).`,
    `Their question is about ${cur.n} unless they name another lift. Name ${cur.n} in form answers.`,
  ] : [];
  const lines = exercises.map((ex) => {
    const done = (grid[ex.n] || []).filter((r) => r.done && !isCardio(ex.n) && hasVal(r.w) && hasVal(r.r));
    if (!done.length) return null;
    const sets = done.map((r) => `${fmtW(+r.w)}x${r.r}${hasVal(r.rir) ? ` RIR ${r.rir}` : ""}${r.asked && (+r.asked.w !== +r.w || +r.asked.r !== +r.r) ? ` (asked ${fmtW(r.asked.w)}x${r.asked.r})` : ""}`).join(", ");
    return `- ${ex.n} (plan ${ex.sets}x${ex.reps[0]}-${ex.reps[1]}): ${sets}${advice[ex.n] ? `. Your call for the next set: ${advice[ex.n].line}` : ""}`;
  }).filter(Boolean);
  return [...head, ...(lines.length ? [`In today's workout so far:`, ...lines] : [])].join("\n");
}

/** The small tag after a lift's name: a swap, a lift put off for a busy machine, or an add-on for today. */
const Tag = ({ ex, later }) => (ex.swappedFor ? <span className="ex-tag" title={`Instead of ${ex.swappedFor} today`}>swap</span>
  : later ? <span className="ex-tag later">come back</span>
  : ex.today ? <span className="ex-tag">today</span> : null);

function Collapsed({ ex, rows, goal, bump, call, later, swappedTo, skipped, justClosed, onOpen }) {
  const done = rows.filter((r) => r.done);
  const complete = rows.length > 0 && done.length === rows.length;
  const prs = done.filter((r) => r.pr).length;
  const best = bestSet(done.filter((r) => hasVal(r.w) && hasVal(r.r)).map((r) => ({ w: +r.w, r: +r.r })));
  const cardio = isCardio(ex.n);
  let sub;
  if (skipped && swappedTo) sub = `Swapped for ${swappedTo} today`;
  else if (skipped) sub = "Skipped today · tap to add back";
  else if (cardio) sub = done.length ? done.map((r) => fmtSet({ min: +r.min, mi: hasVal(r.mi) ? +r.mi : null })).join(" + ") : `Cardio · ${ex.reps[0]}–${ex.reps[1]} min`;
  else if (complete) sub = `${done.length} sets · top set ${fmtW(best.w)} × ${best.r}`;
  else if (call?.w != null && done.length) sub = `${done.length}/${rows.length} sets · next ${fmtW(call.w)} × ${call.r}`;
  else if (bump) sub = `${done.length}/${rows.length} sets · go up to ${fmtW(bump.to)} lb`;
  else if (goal) sub = `${done.length}/${rows.length} sets · try ${fmtGoal(goal)}`;
  else sub = `${done.length}/${rows.length} sets`;
  return (
    <button className={"ex-collapsed" + (skipped ? " skipped" : complete ? "" : " pending") + (justClosed ? " just-closed" : "")} onClick={onOpen}>
      <SetRing done={done.length} total={rows.length} skipped={skipped} />
      <span className="name">{ex.n}<Tag ex={ex} later={later} /><span className="sub">{sub}</span></span>
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

function ExerciseCard({ ex, showRir, rows, target, goal, targetDate, onHint, bump, call, opening, refSets, activeIdx, flash, mood, onAsk, onEdit, onLog, onPick, onReopen, onAddSet, onRemoveSet, onSkip, skipLabel, onBusy, onCollapse }) {
  const id = coachFor(ex.n);
  const coach = COACHES[id];
  // Calm moods read the form cue; reactions say their own line. Until the first set is logged,
  // a lift that earned more weight gets the coach telling you to go up instead.
  // The coach's call after a set stays up until the next one; before the first set, the opening plan.
  // The face still reacts (PR, hyped, encourage); the words are always the coaching.
  const calm = mood === "idle" || mood === "focused";
  const started = rows.some((r) => r.done);
  const line = started && call ? call.line
    : opening ? opening.line
    : bump && !started ? `You hit ${bump.sets} × ${bump.reps} at ${fmtW(bump.from)} lb. Go up to ${fmtW(bump.to)} today.`
    : calm && ex.cue ? ex.cue : MOODS[mood].line;
  const showCue = ex.cue && line !== ex.cue;
  const cardio = isCardio(ex.n);
  const lastEntry = cardio ? refSets[0] : null;
  return (
    <section className="ex" aria-label={ex.n}>
      {/* Comic layout: the bubble's tail points down at the coach who says it. */}
      {/* One row: the coach, their line (the bubble's tail points at them), and Ask. Kept tight so
          the whole card fits on a phone screen mid-set. */}
      <div className="ex-coach" style={{ "--c": coach.color }}>
        <Coach id={id} mood={mood} size={52} />
        {/* The whole bubble is a big target for asking; the Ask button stays the keyboard path. */}
        <button type="button" className="coach-bubble bubble-btn" tabIndex={-1} onClick={onAsk}><span aria-live="polite">{line}</span></button>
        <button className="ask-btn compact" onClick={onAsk} aria-label={`Ask ${coach.name}, your ${coach.group.toLowerCase()} coach`}>
          <MessageCircle size={18} strokeWidth={2.6} aria-hidden="true" /><span>Ask</span>
        </button>
      </div>
      <div className="ex-head">
        <button style={{ flex: 1, textAlign: "left", minWidth: 0 }} onClick={onCollapse} aria-label={`${ex.n}, collapse`}>
          <div className="ex-name">{ex.n}<Tag ex={ex} />{ex.orphan && <span className="ex-tag">off program</span>}</div>
          <div className="ex-spec">{specLine(ex)}</div>
        </button>
        {cardio
          ? lastEntry && <span className="target" title={`Last time, ${shortDate(targetDate)}`}>Beat {fmtSet(lastEntry)}</span>
          : started && call?.w != null ? <span className={"target" + (call.kind === "up" ? " up" : "")}>Next · {fmtW(call.w)} × {call.r}</span>
          : started && call?.kind === "done" ? null
          : bump ? <span className="target up" title={`All ${bump.sets} sets hit ${bump.reps} on ${shortDate(targetDate)}`}>Go up · {fmtW(bump.to)} lb</span>
          : goal && <span className="target" title={`Best set on ${shortDate(targetDate)}: ${fmtW(target.w)} × ${target.r}`}>Try {fmtGoal(goal)}</span>}
      </div>
      {!(cardio ? lastEntry : target) && <p className="target-none">First time logging this one. Today sets the baseline.</p>}
      {showCue && <p className="ex-cue"><b>Cue</b> {ex.cue}</p>}

      <div>
        {rows.map((r, i) => {
          if (r.done && cardio) {
            const label = fmtSet({ min: +r.min, mi: hasVal(r.mi) ? +r.mi : null });
            return (
              <DoneRow key={i} className="done-row" label={`Entry ${i + 1}: ${label}. Hold to edit, swipe left to delete.`}
                canDelete={rows.length > 1} onEdit={() => onReopen(i)} onDelete={() => onRemoveSet(i)} onHint={onHint}>
                <span className="n">{i + 1}</span>
                <span className="w">{label}{r.beat ? <span className="beat-mark">▲ beat</span> : null}</span>
                <span />
                <span className={"ck" + (flash === i ? " fill" : "")} aria-hidden="true"><Check size={18} strokeWidth={3} /></span>
              </DoneRow>
            );
          }
          if (r.done) {
            // PR sets get the animated gold rim (.pr-rim), bolder than the rest timer's line beam.
            return (
              <DoneRow key={i} className={"done-row" + (r.pr ? " pr-rim" : "")} label={`Set ${i + 1}: ${fmtW(+r.w)} by ${r.r}${r.pr ? ", personal record" : ""}. Hold to edit, swipe left to delete.`}
                canDelete={rows.length > 1} onEdit={() => onReopen(i)} onDelete={() => onRemoveSet(i)} onHint={onHint}>
                <span className="n">{i + 1}</span>
                <span className="w">{fmtW(+r.w)} × {r.r}{r.pr ? <span className={"stamp" + (flash === i ? " hit" : "")}>PR</span> : r.beat ? <span className="beat-mark">▲ beat</span> : r.matched ? <span className="beat-mark">= matched</span> : null}</span>
                <span className="small muted">{showRir && hasVal(r.rir) ? `RIR ${r.rir}` : ""}</span>
                <span className={"ck" + (flash === i ? " fill" : "")} aria-hidden="true"><Check size={18} strokeWidth={3} /></span>
              </DoneRow>
            );
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
        {onBusy && <button className="btn-quiet" onClick={onBusy}>Machine busy?</button>}
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
        {canRemove && <button className="set-remove" onClick={onRemove} aria-label="Remove this interval"><Trash2 size={16} strokeWidth={2.4} /></button>}
      </div>
      <div className="steppers">
        <Stepper id={`min-${i}`} label="Minutes" unit="min" value={row.min} mode="decimal" placeholder={`${ex.reps[0]}–${ex.reps[1]}`}
          onChange={(v) => onEdit({ min: v })} onDec={() => bump("min", -5, 0)} onInc={() => bump("min", 5, 0)} step="5 minutes" />
        <Stepper id={`mi-${i}`} label="Distance" unit="miles" value={row.mi} mode="decimal" placeholder="optional"
          onChange={(v) => onEdit({ mi: v })} onDec={() => bump("mi", -0.1, 1)} onInc={() => bump("mi", 0.1, 1)} step="a tenth of a mile" />
      </div>
      <button className="btn btn-day" onClick={onLog} disabled={!hasVal(row.min)}>{hasVal(row.min) ? "Log cardio" : "Enter minutes"}</button>
    </div>
  );
}

function ActiveSet({ i, ex, showRir, row, last, canRemove, onEdit, onLog, onRemove }) {
  const step = weightStep(ex.n);
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
        {canRemove && <button className="set-remove" onClick={onRemove} aria-label="Remove this set"><Trash2 size={16} strokeWidth={2.4} /></button>}
      </div>
      <div className="steppers">
        <Stepper id={`w-${i}`} label="Weight" unit={row.w === "0" ? "bodyweight" : "lb"} value={row.w} mode="decimal"
          onChange={(v) => onEdit({ w: v })} onDec={() => bump("w", -step)} onInc={() => bump("w", step)} step={`${step} pounds`} stepText={step} />
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
    </div>
  );
}

function Stepper({ id, label, unit, value, mode, placeholder, onChange, onDec, onInc, step, stepText }) {
  return (
    <div className="stepper">
      <label htmlFor={id}>
        <span className="sr-only">{label}</span>
        <input id={id} type="number" inputMode={mode} value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} onFocus={(e) => e.target.select()} />
        <span className="u">{unit}</span>
      </label>
      <div className="stepper-btns">
        {/* A weight step is spelled out (−10 / +10) since it differs from lift to lift. */}
        <button onClick={onDec} aria-label={`${label} down ${step}`}>{stepText ? `−${stepText}` : <Minus size={20} />}</button>
        <button onClick={onInc} aria-label={`${label} up ${step}`}>{stepText ? `+${stepText}` : <Plus size={20} />}</button>
      </div>
    </div>
  );
}

/* A logged set. Hold to edit, swipe left to delete: a plain tap only says how, so brushing the
   screen mid-workout never reopens a set. Enter or Space still edits from a keyboard. */
const HOLD_MS = 450, SWIPE_DELETE = 96;
function DoneRow({ className, label, canDelete, onEdit, onDelete, onHint, children }) {
  const [dx, setDx] = useState(0);
  const g = useRef(null); // the gesture in progress
  const hold = useRef(null);
  useEffect(() => () => clearTimeout(hold.current), []);
  const down = (e) => {
    g.current = { x: e.clientX, y: e.clientY, dx: 0, moved: false, swiping: false, held: false };
    clearTimeout(hold.current);
    hold.current = setTimeout(() => {
      if (g.current && !g.current.moved) { g.current.held = true; vibrate(15); onEdit(); }
    }, HOLD_MS);
  };
  const move = (e) => {
    const t = g.current;
    if (!t) return;
    const mx = e.clientX - t.x, my = e.clientY - t.y;
    if (!t.moved && Math.hypot(mx, my) > 8) {
      t.moved = true;
      clearTimeout(hold.current);
      t.swiping = canDelete && mx < 0 && Math.abs(mx) > Math.abs(my);
      if (t.swiping) e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (t.swiping) { t.dx = Math.min(0, mx); setDx(t.dx); }
  };
  const up = () => {
    const t = g.current;
    g.current = null;
    clearTimeout(hold.current);
    setDx(0);
    if (!t) return;
    if (t.swiping) { if (t.dx < -SWIPE_DELETE) onDelete(); return; }
    if (!t.moved && !t.held) onHint();
  };
  const cancel = () => { g.current = null; clearTimeout(hold.current); setDx(0); };
  return (
    <div className={"swipe" + (dx ? " swiping" : "")}>
      {dx < 0 && <span className="swipe-del" aria-hidden="true"><Trash2 size={18} strokeWidth={2.4} />{dx < -SWIPE_DELETE ? "Release" : "Delete"}</span>}
      <button className={className} style={dx ? { transform: `translateX(${dx}px)`, transition: "none" } : undefined}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
        onClick={(e) => { if (e.detail === 0) onEdit(); }} onContextMenu={(e) => e.preventDefault()}
        aria-label={label}>
        {children}
      </button>
    </div>
  );
}

function FinishDock({ sets, onFinish }) {
  return (
    <div className="rest-wrap finish-dock">
      <button className="btn btn-day" onClick={onFinish}><Check size={20} strokeWidth={3} aria-hidden="true" /> Finish workout · {sets} sets</button>
    </div>
  );
}

function RestDock({ timer, setTimer, alertSet }) {
  const [now, setNow] = useState(Date.now());
  const alerted = useRef(false);
  const handedOff = useRef(false);
  useEffect(() => { alerted.current = timer.endsAt <= Date.now(); handedOff.current = false; }, [timer.endsAt]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
  const over = left === 0;
  useEffect(() => {
    if (over && !alerted.current) { alerted.current = true; chime(); vibrate([200, 100, 200]); }
  }, [over]);
  // On screen near the end: the chime will do, so call off the lock-screen alert. 4 s covers the
  // server sending up to 3 s early; locking the phone inside those 4 s means no alert this time.
  useEffect(() => {
    if (!over && left <= 4 && alertSet && !handedOff.current && document.visibilityState === "visible") { handedOff.current = true; cancelRestAlert(); }
  }, [left, over, alertSet]);
  const adjust = (d) => setTimer((t) => ({ ...t, endsAt: Math.max(Date.now(), t.endsAt + d * 1000), total: Math.max(15, t.total + d) }));
  const reduced = useReducedMotion();
  const theme = useTheme();
  return (
    // Line beam runs only while resting (a 60–120 s wait); the line type ignores reduced motion, so gate it here.
    <BorderBeam size="line" theme={theme} active={!over && !reduced} className="rest-wrap">
      <div className={"rest" + (over ? " over" : "")} role="timer" aria-label="Rest timer">
        <Coach id={timer.coach || "tank"} mood={over ? "focused" : "resting"} size={46} decorative />
        <div className="rest-text">
          <span className="rest-line">
            {!over && alertSet === true && <Bell size={12} strokeWidth={2.5} className="rest-bell" aria-label="Lock-screen alert set" />}
            {!over && alertSet === false && <BellOff size={12} strokeWidth={2.5} className="rest-bell" aria-label="No lock-screen alert: no connection. Keep GymBuddy open." />}
            {timer.next ? `${over ? "Go" : "Next"}: ${timer.next}` : over ? "Rest over. Next set!" : MOODS.resting.line}
          </span>
          <span className="clock" aria-live={over ? "assertive" : "off"} aria-label={over ? "Rest over" : `${mmss(left)} of ${mmss(timer.total)} rest left`}>{over ? "Go" : mmss(left)}</span>
        </div>
        {!over && <button className="rb" onClick={() => adjust(-15)} aria-label="Remove 15 seconds">−15</button>}
        {!over && <button className="rb" onClick={() => adjust(15)} aria-label="Add 15 seconds">+15</button>}
        <button className="rb primary" onClick={() => setTimer(null)}>{over ? "Dismiss" : "Skip"}</button>
      </div>
    </BorderBeam>
  );
}
