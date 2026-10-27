import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { isCardio } from "../data/program.js";
import { href } from "../lib/router.js";
import Coach from "../components/Coach.jsx";
import { InfoButton, Read } from "../components/ui.jsx";
import SetupCard from "../components/SetupCard.jsx";
import { COACHES } from "../data/coaches.js";
import CoachChat from "../components/CoachChat.jsx";
import { ZONES, zoneOf, hardestLift, cachedCurve, timedSets } from "../lib/heart.js";
import { heartCurve } from "../lib/googleHealth.js";
import HeartChart, { zoneRange } from "../components/HeartChart.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import Walkthrough, { WalkNotes } from "../components/Walkthrough.jsx";
import { freshWalk, showsHeart, changeDiff, undoDiff, recapLine } from "../lib/walkthrough.js";
import { applyChanges } from "../lib/programChange.js";
import { readiness, nightReads, hm } from "../lib/recovery.js";
import { useTheme } from "../lib/theme.js";
import { fmtSet, cardioTotals, priorSessions, allTimeBest, bestSet, bestE1rm, e1rm, fmtW, num, compact, longDate, plural, sessionVolume, sessionSetCount, byDateDesc, nextDayAfter, countRecords } from "../lib/util.js";

/**
 * A workout's summary. Straight after finishing it ("Session logged", Done goes on to Today), or, with
 * `past`, opened from Progress → Workouts: a back button, the date as the title, and back to the list.
 */
export default function Summary({ session, sessions, program, prefs, go, back, onUpdate, past = false, coachChat, head = "tank", name, weighins, nutrition, onProgramChange, recovery }) {
  const [note, setNote] = useState(session.note || "");
  const [asking, setAsking] = useState(false);
  // The coach's walkthrough: running, the step on screen (the heart rate chart follows it), and the
  // walkthrough as last written, whose points stay under each part of the recap once it's over.
  const [walking, setWalking] = useState(false);
  const [walkStep, setWalkStep] = useState(null);
  const walk = freshWalk(session);
  const heart = showsHeart(session, prefs);
  // The night before, from Google Health: how it compares with the lifter's usual (lib/recovery.js).
  const night = prefs.googleHealth?.on ? readiness(recovery, session.date) : null;
  const latest = useRef(session);
  latest.current = session;
  const p = program[session.day];

  const r = useMemo(() => {
    const prior = priorSessions(sessions, session).sort(byDateDesc);
    const lastSame = prior.find((s) => s.day === session.day);
    const rows = Object.entries(session.sets).filter(([n]) => !isCardio(n)).map(([n, sets]) => {
      const best = bestSet(sets);
      const score = bestE1rm(sets);
      const allTime = allTimeBest(prior, n);
      const lastS = prior.find((s) => s.sets[n]?.length);
      const lastScore = lastS ? bestE1rm(lastS.sets[n]) : 0;
      return { n, best, score, allTime, lastScore, pct: allTime ? ((score - allTime) / allTime) * 100 : null, vsLast: lastScore ? ((score - lastScore) / lastScore) * 100 : null };
    });
    return {
      vol: sessionVolume(session),
      lastVol: lastSame ? sessionVolume(lastSame) : null,
      sets: sessionSetCount(session),
      records: rows.filter((x) => x.allTime && x.score > x.allTime + 0.05),
      up: rows.filter((x) => !(x.allTime && x.score > x.allTime + 0.05) && x.lastScore && x.score > x.lastScore + 0.05),
      same: rows.filter((x) => !(x.allTime && x.score > x.allTime + 0.05) && x.lastScore && Math.abs(x.score - x.lastScore) <= 0.05),
      down: rows.filter((x) => x.lastScore && x.score < x.lastScore - 0.05),
      baseline: rows.filter((x) => !x.lastScore),
      prevRecords: lastSame ? countRecords(sessions, lastSame) : null,
      cardio: Object.entries(session.sets).filter(([n]) => isCardio(n)).map(([n, sets]) => ({ n, sets, t: cardioTotals(sets) })),
    };
  }, [session, sessions]);

  const mins = session.startedAt && session.finishedAt ? Math.max(1, Math.round((session.finishedAt - session.startedAt) / 60000)) : null;
  const volPct = r.lastVol ? ((r.vol - r.lastVol) / r.lastVol) * 100 : null;
  // The head coach's take in the bubble, there as soon as the recap opens; the walkthrough goes deeper.
  const recap = recapLine({ name: p.name, records: r.records, up: r.up, same: r.same, down: r.down, baseline: r.baseline, volPct, low: !!night?.low });
  const nextDay = nextDayAfter(sessions, program);
  const next = program[nextDay];
  const saveNote = () => { if ((session.note || "") !== note.trim()) onUpdate({ ...session, note: note.trim() || null }); };
  const done = () => { saveNote(); go("#/today", { replace: true }); };
  const leave = () => { saveNote(); back(href("progress", "workouts")); };
  const saveWalk = (w) => onUpdate({ ...latest.current, walk: w });
  const notesOn = walk && !walking;
  // A step's suggested change to the plan, applied only when the lifter taps Apply. Undo works for what
  // was applied on this visit and takes back just that change (changeDiff), whatever else changed since.
  const [appliedNow, setAppliedNow] = useState(() => new Map()); // step index -> changeDiff
  useEffect(() => { setAppliedNow(new Map()); }, [walk?.at]);
  const markApplied = (i, on) => {
    const w = latest.current.walk;
    if (w?.steps?.[i]) onUpdate({ ...latest.current, walk: { ...w, steps: w.steps.map((x, j) => (j === i ? { ...x, applied: on ? Date.now() : undefined } : x)) } });
  };
  const plan = walk && onProgramChange ? {
    program,
    applied: new Set(appliedNow.keys()),
    apply: (i) => {
      const c = walk.steps[i]?.change;
      const r = c && applyChanges(program, [c]);
      if (!r?.lines.length) return;
      onProgramChange(r.program);
      setAppliedNow((m) => new Map(m).set(i, changeDiff(program[c.day], r.program[c.day])));
      markApplied(i, true);
    },
    undo: (i) => {
      const d = appliedNow.get(i), c = walk.steps[i]?.change;
      if (!d || !c) return;
      onProgramChange(undoDiff(program, c.day, d));
      setAppliedNow((m) => { const n = new Map(m); n.delete(i); return n; });
      markApplied(i, false);
    },
    // A weight for next time is spent once a later workout logs that lift.
    stale: (st) => st.change?.action === "weight" && sessions.some((x) => x.id !== session.id && x.sets[st.change.exercise]?.length
      && (x.date > session.date || (x.date === session.date && (x.finishedAt || 0) > (session.finishedAt || 0)))),
  } : null;
  const focusAt = walkStep?.target === "chart" && walkStep.set ? session.sets[walkStep.lift]?.[walkStep.set - 1]?.t ?? null : null;
  // Heart rate still to come: never asked yet, or nothing from the watch so far within a day of finishing.
  // A workout with no times (imported) or one the watch never covered says nothing.
  const ghHeart = prefs.googleHealth?.on && prefs.googleHealth.heart !== false;
  // This workout's usual average heart rate: the median of its last five with heart rate (two at least).
  const usualAvg = useMemo(() => {
    const avgs = priorSessions(sessions, session).filter((x) => x.day === session.day && x.hr?.avg && !x.hr.none)
      .sort(byDateDesc).slice(0, 5).map((x) => x.hr.avg).sort((a, b) => a - b);
    return avgs.length >= 2 ? Math.round(avgs.length % 2 ? avgs[avgs.length >> 1] : (avgs[avgs.length / 2 - 1] + avgs[avgs.length / 2]) / 2) : null;
  }, [sessions, session]);
  const heartDue = ghHeart && session.startedAt && session.finishedAt
    && (!session.hr || (session.hr.none && Date.now() - session.finishedAt < 24 * 3600_000));

  return (
    <main className="screen summary" data-day={session.day}>
      <div className="body" style={{ paddingTop: "calc(24px + var(--safe-t))" }}>
        {/* The date (or "Session logged") is the title, the workout and its length under it, then the head
            coach beside their bubble. Nothing above the title but the back button. */}
        <header className="summary-head">
          <div className="summary-meta">
            {past && <button className="icon-btn boxed" onClick={leave} aria-label="Back to workouts"><ChevronLeft size={20} /></button>}
            <Headline text={past ? longDate(session.date) : null} />
            <InfoButton screen="summary" />
          </div>
          <p className="summary-sub"><span className="dot" aria-hidden="true" />{p.name}{mins ? ` · ${mins} min` : ""}</p>
          {/* The head coach speaks for the recap: a walkthrough of this workout (the bubble), or questions
              about it (Ask), in the same conversation as everywhere else, with this workout in full on top
              of what they read. */}
          {coachChat?.thread && (
            <div className="summary-ask" style={{ "--c": COACHES[head].color }}>
              <Coach id={head} mood={r.records.length ? "pr" : "proud"} size={64} />
              <button type="button" className="coach-bubble bubble-btn" onClick={() => setWalking(true)} aria-expanded={walking}>
                {recap || (walk ? "My notes are under each part of the recap." : `Want my take? I'll go over what went well${heart ? ", your heart rate," : ""} and what to fix.`)}
                <span className="bubble-cta">{walk ? "Walk through it again" : "Walk me through it"}<ChevronRight size={15} strokeWidth={2.8} aria-hidden="true" /></span>
              </button>
              <button className="ask-btn compact" onClick={() => setAsking(true)} aria-label={`Ask ${COACHES[head].name}, your head coach, about this workout`}><MessageCircle size={18} strokeWidth={2.6} aria-hidden="true" /><span>Ask</span></button>
            </div>
          )}
        </header>
        {/* First workout logged and the plan still generic: the moment to point at the coaches. */}
        {!past && sessions.length === 1 && <SetupCard prefs={prefs} glow lead="First workout done. Now shape your plan." />}

        <div className="stats" data-walk="overview">
          <div className="stat"><b>{compact(r.vol)}</b><span>lb volume</span>{volPct != null && <VolRead pct={volPct} />}</div>
          <div className="stat"><b>{r.sets}</b><span>sets</span><span className="stat-note">{plural(Object.keys(session.sets).length, "lift")}</span></div>
          <div className="stat"><b>{r.records.length}</b><span>PRs</span>
            {r.records.length > 0 ? <Read tone="good">New best</Read> : r.prevRecords != null && <span className="stat-note">{r.prevRecords} last time</span>}</div>
        </div>
        {notesOn && <WalkNotes walk={walk} head={head} plan={plan} match={(t) => t === "overview"} />}

        {night && <NightBefore r={night} />}
        {notesOn && night && <WalkNotes walk={walk} head={head} plan={plan} match={(t) => t === "sleep"} />}

        {/* Only while Google Health is connected: a workout keeps its numbers after a disconnect (they
            come back on reconnecting), but the chart's readings can't be fetched then. */}
        {!prefs.googleHealth?.on ? null : session.hr && !session.hr.none
          ? <ErrorBoundary quiet="heart rate"><Heart session={session} usualAvg={usualAvg} focus={focusAt} walk={notesOn ? walk : null} head={head} plan={plan} /></ErrorBoundary>
          : heartDue && (
            <p className="note-box hr-wait">Heart rate from your watch shows up here once it syncs to Google Health, usually within the hour.</p>
          )}

        {r.records.length > 0 && (
          <Group title="Records" help="records" walk={notesOn ? walk : null} head={head} plan={plan} lifts={r.records}>
            {r.records.map((x) => (
              <a key={x.n} className="rec" href={href("lift", x.n)} data-walk={`lift:${x.n}`}>
                <PrBadge />
                <span className="rec-text"><span className="n">{x.n}</span><span className="m">Est. max {num(x.score)} lb · ▲ {x.pct.toFixed(1)}%</span></span>
                <span className="v">{fmtW(x.best.w)} × {x.best.r}</span>
              </a>
            ))}
          </Group>
        )}
        {r.up.length > 0 && <Group title="Up on last time" help="vs-last" walk={notesOn ? walk : null} head={head} plan={plan} lifts={r.up}>{r.up.map((x) => <Plain key={x.n} x={x} mark={`+${x.vsLast.toFixed(1)}%`} />)}</Group>}
        {r.same.length > 0 && <Group title="Same as last time" help="vs-last" walk={notesOn ? walk : null} head={head} plan={plan} lifts={r.same}>{r.same.map((x) => <Plain key={x.n} x={x} />)}</Group>}
        {r.down.length > 0 && <Group title="Down on last time" help="vs-last" walk={notesOn ? walk : null} head={head} plan={plan} lifts={r.down}>{r.down.map((x) => <Plain key={x.n} x={x} mark={`−${Math.abs(x.vsLast).toFixed(1)}%`} />)}</Group>}
        {r.cardio.length > 0 && (
          <Group title="Cardio" walk={notesOn ? walk : null} head={head} plan={plan} lifts={r.cardio} prefix="cardio:">
            {r.cardio.map((x) => (
              <a key={x.n} className="rec plain" href={href("lift", x.n)} data-walk={`cardio:${x.n}`}>
                <span className="rec-text"><span className="n">{x.n}</span><span className="m">{x.sets.map(fmtSet).join(" + ")}</span></span>
                <span className="trend flat">{num(x.t.min)} min</span>
              </a>
            ))}
          </Group>
        )}
        {r.baseline.length > 0 && <Group title="First time logged" walk={notesOn ? walk : null} head={head} plan={plan} lifts={r.baseline}>{r.baseline.map((x) => <Plain key={x.n} x={x} />)}</Group>}

        <label className="field">
          <span className="lbl">Note</span>
          <textarea id="summary-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote}
            placeholder="How did it feel? Anything to change next time?" />
        </label>

        {past
          ? <button className="btn btn-ink summary-done" onClick={leave}>Back to workouts</button>
          : (
            <button className="btn btn-ink summary-done" onClick={done}>
              Done <span className="next"><span className="dot" data-day={nextDay} aria-hidden="true" />{next.name} is next</span>
            </button>
          )}
      </div>
      {walking && (
        <Walkthrough session={session} sessions={sessions} program={program} prefs={prefs} head={head} notes={coachChat?.thread?.notes} heart={heart} day={session.day}
          recovery={recovery} sleep={!!night}
          plan={plan} onSave={saveWalk} onStep={setWalkStep} onClose={() => setWalking(false)} onAsk={() => { setWalking(false); setAsking(true); }} />
      )}
      {asking && (
        <CoachChat coach={head} head={head} name={name} topic="workout" workout={walk ? session : { ...session, walk: undefined }} day={session.date} {...coachChat}
          sessions={sessions} program={program} weighins={weighins} profile={prefs.profile} phase={prefs.phase}
          nutrition={nutrition} onProgramChange={onProgramChange} onClose={() => setAsking(false)} />
      )}
    </main>
  );
}

/* ── metal (one chromatic material for the page: headline + PR badges, in separate areas) ── */

/* metal-fx is loaded only when Summary opens, so it stays out of the startup bundle.
   Metal shows in dark mode only: on the light ground it washes out and the PR badge loses contrast.
   Light mode, reduced motion, or a failed load (offline) keep the plain headline and stamp. */
let metalLoad = null;
function useMetal() {
  const [metal, setMetal] = useState(null);
  const dark = useTheme() === "dark";
  useEffect(() => {
    if (!dark || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let live = true;
    metalLoad ||= import("metal-fx").catch(() => { metalLoad = null; return null; });
    // MetalText paints from the DOM's glyphs, so wait for the display face too.
    Promise.all([metalLoad, document.fonts.ready]).then(([m]) => { if (live && m) setMetal(m); });
    return () => { live = false; };
  }, [dark]);
  return dark ? metal : null;
}

function useInk() {
  const read = () => getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#15171A";
  const theme = useTheme();
  const [ink, setInk] = useState(read);
  useEffect(() => { setInk(read()); }, [theme]);
  return ink;
}

/** "Session logged" in metal straight after a workout; a past workout's date (`text`) stays plain. */
function Headline({ text }) {
  const metal = useMetal();
  const ink = useInk();
  if (text) return <h1 className="summary-title past">{text}</h1>;
  return (
    <h1 className="summary-title">
      {metal
        ? <metal.MetalText font={'800 28px/1.1 Lexend, "Helvetica Neue", sans-serif'} color={ink} theme="dark" strength={0.9}>Session logged</metal.MetalText>
        : "Session logged"}
    </h1>
  );
}

function PrBadge() {
  const metal = useMetal();
  return metal ? <metal.MetalBadge theme="dark">PR</metal.MetalBadge> : <span className="stamp">PR</span>;
}

/* Tiles flag only what's unusual for the lifter (Read, in ui.jsx): a pill when a number is better or
   worse than their usual. Anything normal, and any plain context, is one quiet line (.stat-note). */

/** Volume against the last time this workout was done: 5%+ up is better, 10%+ down worse, the rest normal. */
function VolRead({ pct }) {
  const p = `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%`;
  if (pct >= 5) return <Read tone="good">{p}</Read>;
  if (pct <= -10) return <Read tone="watch">{p}</Read>;
  return <span className="stat-note">{Math.abs(pct) < 0.5 ? "same as last" : `${p} vs last`}</span>;
}

/**
 * The workout's heart rate from the lifter's watch: the headline numbers, the chart (readings from this
 * phone, or fetched for it), time in each zone, which lift pushed hardest, and each lift's set peaks
 * and how far heart rate came down before the next set.
 */
function Heart({ session, usualAvg = null, focus = null, walk = null, head, plan }) {
  const h = session.hr;
  const [readings, setReadings] = useState(() => cachedCurve(session.id));
  const [failed, setFailed] = useState(false);
  // Fetch again when the summary changes (more of the watch's readings arrived).
  useEffect(() => {
    let live = true;
    setFailed(false);
    // This phone's copy, unless the summary is complete and the copy stops short (made from an earlier read).
    const have = cachedCurve(session.id);
    if (have?.length && (!h.complete || have[have.length - 1][0] >= session.finishedAt - 3 * 60_000)) { setReadings(have); return; }
    heartCurve(session).then((r) => { if (live) { setReadings(r); setFailed(!r); } }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [session.id, h.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = h.zones ? ZONES.reduce((a, z) => a + h.zones[z.id], 0) : 0;
  // In the order they were done, numbered like the chart's bands.
  const order = [...new Set(timedSets(session).map((x) => x.lift))];
  const lifts = Object.entries(session.sets).filter(([, v]) => v.some((x) => x.hr))
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const top = hardestLift(session);
  return (
    <section className="section">
      <h2 className="lbl">Heart rate</h2>
      <div className="stats" data-walk="heart">
        {/* Effort, not a verdict: a harder or easier workout than usual is neither good nor bad, so no pill. */}
        <div className="stat"><b>{h.avg}</b><span>avg bpm</span>{usualAvg && <span className="stat-note">usually {usualAvg}</span>}</div>
        <div className="stat"><b>{h.max}</b><span>peak bpm</span>{h.bounds && <span className="stat-note">{ZONES[zoneOf(h.max, h.bounds)]?.label || "Below light"}</span>}</div>
        {h.hard != null
          ? <div className="stat"><b>{num(h.hard)}</b><span>min vigorous or peak</span></div>
          : <div className="stat"><b>{h.low}</b><span>lowest bpm</span></div>}
      </div>
      <div data-walk="chart" className="walk-place">
        {readings?.length ? <HeartChart session={session} readings={readings} focus={focus} />
          : <p className="small muted hr-chart-note">{failed ? "Couldn't load the heart rate chart. It'll be here next time you're online." : "Loading the heart rate chart…"}</p>}
      </div>

      {total > 0 && (
        <div className="card-list hr-time" data-walk="zones">
          {[...ZONES].reverse().map((z) => {
            const i = ZONES.indexOf(z), m = h.zones[z.id];
            return (
              <div key={z.id} className="hr-time-row">
                <span className="hr-time-name"><i className={`z${i + 1}`} aria-hidden="true" />{z.label}<span className="muted"> {zoneRange(h.bounds, i)} bpm</span></span>
                <span className="hr-time-v">{num(m)} min</span>
                <span className="hr-meter" aria-hidden="true"><span className={`z${i + 1}`} style={{ width: `${(m / total) * 100}%` }} /></span>
              </div>
            );
          })}
        </div>
      )}
      {top && <p className="note-box">{top.lift} pushed you hardest: its sets peaked at {top.avg} bpm on average.</p>}
      {lifts.length > 0 && (
        <div className="card-list">
          {lifts.map(([n, v]) => {
            const rests = v.map((x) => x.hrRest).filter(Boolean);
            return (
              <div key={n} className="rec plain" data-walk={`hr:${n}`}>
                <span className="rec-text">
                  <span className="n">{order.includes(n) && <span className="hr-lift-n" aria-hidden="true">{order.indexOf(n) + 1}</span>}{n}</span>
                  <span className="m">Set peaks {v.map((x) => x.hr ?? "–").join(" · ")} bpm</span>
                  {rests.length > 0 && <span className="m">Came down to {rests.join(" · ")} between sets</span>}
                </span>
                <span className="trend flat">top {Math.max(...v.map((x) => x.hr || 0))}</span>
              </div>
            );
          })}
        </div>
      )}
      <WalkNotes walk={walk} head={head} plan={plan} match={(t) => t === "heart" || t === "chart" || t === "zones" || t.startsWith("hr:")} />
      <p className="small muted">
        {h.source === "google" ? "Zones are Google Health's, personal to your fitness and age."
          : h.source === "age" ? "Zones are estimated from your age until Google Health has yours."
          : "Add your age in Nutrition setup to see time in each zone."}
        {!h.complete && " Your watch is still syncing; this fills in as it does."}
      </p>
    </section>
  );
}

/**
 * The night before the workout, from the lifter's watch: time asleep, resting heart rate and HRV,
 * each against their usual (the 4 weeks before), and the stages when the watch tracked them. A short
 * or under-recovered night says so; an ordinary one just shows the numbers.
 */
/* The night before, each number read against the lifter's own usual (lib/recovery.js). A normal night
   says so once, beside the heading; anything better or worse gets its pill and the night a sentence. */
function NightBefore({ r }) {
  const { entry: e, usual: u } = r;
  const s = e.sleep;
  const reads = nightReads(r);
  const calm = [reads.asleep, reads.rhr, reads.hrv].every((x) => !x || x.tone === "even") && [reads.asleep, reads.rhr, reads.hrv].some(Boolean);
  const tile = (value, label, read, was) => (
    <div className="stat">
      <b>{value}</b><span>{label}</span>
      {read && read.tone !== "even" && <Read tone={read.tone}>{read.word}</Read>}
      {was != null && <span className="stat-note">usually {was}</span>}
    </div>
  );
  const stages = s && [s.deep != null && `${hm(s.deep)} deep`, s.rem != null && `${hm(s.rem)} REM`, s.awake != null && `awake ${hm(s.awake)}`].filter(Boolean);
  return (
    <section className="section" data-walk="sleep">
      <div className="section-head">
        <h2 className="lbl">Night before</h2>
        {calm && <span className="lbl section-aside">Normal for you</span>}
      </div>
      {reads.line && !r.low && !calm && <p className="night-line">{reads.line}</p>}
      <div className="stats">
        {s && tile(hm(s.asleep), "asleep", reads.asleep, u.asleep && hm(u.asleep))}
        {e.rhr != null && tile(Math.round(e.rhr), "resting bpm", reads.rhr, u.rhr)}
        {e.hrv != null && tile(Math.round(e.hrv), "HRV ms", reads.hrv, u.hrv)}
      </div>
      {stages?.length > 0 && <p className="small muted">{stages.join(" · ")}</p>}
      {r.low && <p className="note-box">{reads.line} Expect a dip, and don't read it as a stall.</p>}
    </section>
  );
}

function Group({ title, help, children, walk = null, head, plan, lifts = [], prefix = "lift:" }) {
  const ids = new Set(lifts.map((x) => prefix + x.n));
  return (
    <section className="section" data-help={help}>
      <h2 className="lbl">{title}</h2>
      <div className="card-list">{children}</div>
      <WalkNotes walk={walk} head={head} plan={plan} match={(t) => ids.has(t)} />
    </section>
  );
}

/** A lift in one of the "on last time" groups. The heading already says up, same or down, so the
    change is plain text, and a same or first-time lift needs none. */
function Plain({ x, mark }) {
  return (
    <a className="rec plain" href={href("lift", x.n)} data-walk={`lift:${x.n}`}>
      <span className="rec-text"><span className="n">{x.n}</span><span className="m">{fmtW(x.best.w)} × {x.best.r} · Est. max {num(e1rm(x.best.w, x.best.r))} lb</span></span>
      {mark && <span className="rec-mark">{mark}</span>}
    </a>
  );
}
