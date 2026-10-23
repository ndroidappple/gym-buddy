import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { isCardio } from "../data/program.js";
import { href } from "../lib/router.js";
import Coach from "../components/Coach.jsx";
import { InfoButton } from "../components/ui.jsx";
import SetupCard from "../components/SetupCard.jsx";
import { coachFor } from "../data/coaches.js";
import { ZONES, zoneOf, hardestLift, cachedCurve, timedSets } from "../lib/heart.js";
import { heartCurve } from "../lib/googleHealth.js";
import HeartChart from "../components/HeartChart.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import { useTheme } from "../lib/theme.js";
import { fmtSet, cardioTotals, priorSessions, allTimeBest, bestSet, bestE1rm, e1rm, fmtW, num, compact, shortDate, longDate, plural, sessionVolume, sessionSetCount, byDateDesc, nextDayAfter } from "../lib/util.js";

/**
 * A workout's summary. Straight after finishing it ("Session logged", Done goes on to Today), or, with
 * `past`, opened from Progress → Workouts: a back button, the date as the title, and back to the list.
 */
export default function Summary({ session, sessions, program, prefs, go, back, onUpdate, past = false }) {
  const [note, setNote] = useState(session.note || "");
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
  const nextDay = nextDayAfter(sessions, program);
  const next = program[nextDay];
  const saveNote = () => { if ((session.note || "") !== note.trim()) onUpdate({ ...session, note: note.trim() || null }); };
  const done = () => { saveNote(); go("#/today", { replace: true }); };
  const leave = () => { saveNote(); back(href("progress", "workouts")); };
  // Heart rate still to come: never asked yet, or nothing from the watch so far within a day of finishing.
  // A workout with no times (imported) or one the watch never covered says nothing.
  const ghHeart = prefs.googleHealth?.on && prefs.googleHealth.heart !== false;
  const heartDue = ghHeart && session.startedAt && session.finishedAt
    && (!session.hr || (session.hr.none && Date.now() - session.finishedAt < 24 * 3600_000));

  return (
    <main className="screen summary" data-day={session.day}>
      <div className="body" style={{ paddingTop: "calc(24px + var(--safe-t))" }}>
        <header className="summary-head">
          <div className="summary-meta">
            {past && <button className="icon-btn boxed" onClick={leave} aria-label="Back to workouts"><ChevronLeft size={20} /></button>}
            <span className="chip"><span className="dot" aria-hidden="true" />{p.name} · {shortDate(session.date)}</span>
            <span className="spacer" />
            {mins && <span className="mono small muted">{mins} min</span>}
            <InfoButton screen="summary" />
          </div>
          <div className="summary-hero">
            <Headline text={past ? longDate(session.date) : null} />
            <Coach id={coachFor(Object.keys(session.sets)[0] || "")} mood={r.records.length ? "pr" : "proud"} size={84} />
          </div>
        </header>
        {/* First workout logged and the plan still generic: the moment to point at the coaches. */}
        {!past && sessions.length === 1 && <SetupCard prefs={prefs} glow lead="First workout done. Now shape your plan." />}

        <div className="stats">
          <div className="stat"><b>{compact(r.vol)}</b><span>lb volume</span>{volPct != null && <Delta pct={volPct} />}</div>
          <div className="stat"><b>{r.sets}</b><span>sets</span><span className="trend flat">{plural(Object.keys(session.sets).length, "lift")}</span></div>
          <div className="stat"><b>{r.records.length}</b><span>PRs</span>{r.prevRecords != null && <span className="trend flat">{r.prevRecords} last time</span>}</div>
        </div>

        {/* Only while Google Health is connected: a workout keeps its numbers after a disconnect (they
            come back on reconnecting), but the chart's readings can't be fetched then. */}
        {!prefs.googleHealth?.on ? null : session.hr && !session.hr.none
          ? <ErrorBoundary quiet="heart rate"><Heart session={session} /></ErrorBoundary>
          : heartDue && (
            <p className="note-box hr-wait">Heart rate from your watch shows up here once it syncs to Google Health, usually within the hour.</p>
          )}

        {r.records.length > 0 && (
          <Group title="Records" help="records">
            {r.records.map((x) => (
              <a key={x.n} className="rec" href={href("lift", x.n)}>
                <PrBadge />
                <span className="rec-text"><span className="n">{x.n}</span><span className="m">Est. max {num(x.score)} lb · ▲ {x.pct.toFixed(1)}%</span></span>
                <span className="v">{fmtW(x.best.w)} × {x.best.r}</span>
              </a>
            ))}
          </Group>
        )}
        {r.up.length > 0 && <Group title="Up on last time" help="vs-last">{r.up.map((x) => <Plain key={x.n} x={x} mark={`▲ ${x.vsLast.toFixed(1)}%`} />)}</Group>}
        {r.same.length > 0 && <Group title="Same as last time" help="vs-last">{r.same.map((x) => <Plain key={x.n} x={x} mark="same" />)}</Group>}
        {r.down.length > 0 && <Group title="Down on last time" help="vs-last">{r.down.map((x) => <Plain key={x.n} x={x} mark={`▼ ${Math.abs(x.vsLast).toFixed(1)}%`} />)}</Group>}
        {r.cardio.length > 0 && (
          <Group title="Cardio">
            {r.cardio.map((x) => (
              <a key={x.n} className="rec plain" href={href("lift", x.n)}>
                <span className="rec-text"><span className="n">{x.n}</span><span className="m">{x.sets.map(fmtSet).join(" + ")}</span></span>
                <span className="trend flat">{num(x.t.min)} min</span>
              </a>
            ))}
          </Group>
        )}
        {r.baseline.length > 0 && <Group title="First time logged">{r.baseline.map((x) => <Plain key={x.n} x={x} mark="baseline set" />)}</Group>}

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
        ? <metal.MetalText font={'800 44px/1 Lexend, "Helvetica Neue", sans-serif'} color={ink} theme="dark" strength={0.9}>Session logged</metal.MetalText>
        : "Session logged"}
    </h1>
  );
}

function PrBadge() {
  const metal = useMetal();
  return metal ? <metal.MetalBadge theme="dark">PR</metal.MetalBadge> : <span className="stamp">PR</span>;
}

function countRecords(sessions, s) {
  const prior = priorSessions(sessions, s);
  return Object.entries(s.sets).filter(([n, sets]) => {
    const at = allTimeBest(prior, n);
    return at && bestE1rm(sets) > at + 0.05;
  }).length;
}

function Delta({ pct }) {
  if (Math.abs(pct) < 0.5) return <span className="trend flat">— even</span>;
  return <span className={"trend" + (pct < 0 ? " flat" : "")}>{pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%</span>;
}

/**
 * The workout's heart rate from the lifter's watch: the headline numbers, the chart (readings from this
 * phone, or fetched for it), time in each zone, which lift pushed hardest, and each lift's set peaks
 * and how far heart rate came down before the next set.
 */
function Heart({ session }) {
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
      <div className="stats">
        <div className="stat"><b>{h.avg}</b><span>avg bpm</span></div>
        <div className="stat"><b>{h.max}</b><span>peak bpm</span>{h.bounds && <span className="trend flat">{ZONES[zoneOf(h.max, h.bounds)]?.label || "Below light"}</span>}</div>
        {h.hard != null
          ? <div className="stat"><b>{num(h.hard)}</b><span>min vigorous or peak</span></div>
          : <div className="stat"><b>{h.low}</b><span>lowest bpm</span></div>}
      </div>
      {readings?.length ? <HeartChart session={session} readings={readings} />
        : <p className="small muted hr-chart-note">{failed ? "Couldn't load the heart rate chart. It'll be here next time you're online." : "Loading the heart rate chart…"}</p>}

      {total > 0 && (
        <div className="card-list hr-time">
          {[...ZONES].reverse().map((z) => {
            const i = ZONES.indexOf(z), m = h.zones[z.id];
            return (
              <div key={z.id} className="hr-time-row">
                <span className="hr-time-name"><i className={`z${i + 1}`} aria-hidden="true" />{z.label}<span className="muted"> {h.bounds[i]}{i < 3 ? `–${h.bounds[i + 1] - 1}` : "+"} bpm</span></span>
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
              <div key={n} className="rec plain">
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
      <p className="small muted">
        {h.source === "google" ? "Zones are Google Health's, personal to your fitness and age."
          : h.source === "age" ? "Zones are estimated from your age until Google Health has yours."
          : "Add your age in Nutrition setup to see time in each zone."}
        {!h.complete && " Your watch is still syncing; this fills in as it does."}
      </p>
    </section>
  );
}

function Group({ title, help, children }) {
  return <section className="section" data-help={help}><h2 className="lbl">{title}</h2><div className="card-list">{children}</div></section>;
}

function Plain({ x, mark }) {
  return (
    <a className="rec plain" href={href("lift", x.n)}>
      <span className="rec-text"><span className="n">{x.n}</span><span className="m">{fmtW(x.best.w)} × {x.best.r} · Est. max {num(e1rm(x.best.w, x.best.r))} lb</span></span>
      <span className="trend flat">{mark}</span>
    </a>
  );
}
