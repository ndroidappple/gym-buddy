import React, { useEffect, useMemo, useState } from "react";
import { isCardio } from "../data/program.js";
import { href } from "../lib/router.js";
import Coach from "../components/Coach.jsx";
import { coachFor } from "../data/coaches.js";
import { useTheme } from "../lib/theme.js";
import { fmtSet, cardioTotals, priorSessions, allTimeBest, bestSet, bestE1rm, e1rm, fmtW, num, compact, shortDate, plural, sessionVolume, sessionSetCount, byDateDesc, nextDayAfter } from "../lib/util.js";

export default function Summary({ session, sessions, program, go, onUpdate }) {
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
      beat: rows.filter((x) => !(x.allTime && x.score > x.allTime + 0.05) && x.lastScore && x.score >= x.lastScore),
      below: rows.filter((x) => x.lastScore && x.score < x.lastScore),
      baseline: rows.filter((x) => !x.lastScore),
      prevRecords: lastSame ? countRecords(sessions, lastSame) : null,
      cardio: Object.entries(session.sets).filter(([n]) => isCardio(n)).map(([n, sets]) => ({ n, sets, t: cardioTotals(sets) })),
    };
  }, [session, sessions]);

  const mins = session.startedAt && session.finishedAt ? Math.max(1, Math.round((session.finishedAt - session.startedAt) / 60000)) : null;
  const volPct = r.lastVol ? ((r.vol - r.lastVol) / r.lastVol) * 100 : null;
  const nextDay = nextDayAfter(sessions);
  const next = program[nextDay];
  const saveNote = () => { if ((session.note || "") !== note.trim()) onUpdate({ ...session, note: note.trim() || null }); };
  const done = () => { saveNote(); go("#/today", { replace: true }); };

  return (
    <main className="screen summary" data-day={session.day}>
      <div className="body" style={{ paddingTop: "calc(24px + var(--safe-t))" }}>
        <header className="summary-head">
          <div className="summary-meta">
            <span className="chip"><span className="dot" aria-hidden="true" />{p.name} · {shortDate(session.date)}</span>
            <span className="spacer" />
            {mins && <span className="mono small muted">{mins} min</span>}
          </div>
          <div className="summary-hero">
            <Headline />
            <Coach id={coachFor(Object.keys(session.sets)[0] || "")} mood={r.records.length ? "pr" : "proud"} size={84} />
          </div>
        </header>

        <div className="stats">
          <div className="stat"><b>{compact(r.vol)}</b><span>lb volume</span>{volPct != null && <Delta pct={volPct} />}</div>
          <div className="stat"><b>{r.sets}</b><span>sets</span><span className="trend flat">{plural(Object.keys(session.sets).length, "lift")}</span></div>
          <div className="stat"><b>{r.records.length}</b><span>PRs</span>{r.prevRecords != null && <span className="trend flat">{r.prevRecords} last time</span>}</div>
        </div>

        {r.records.length > 0 && (
          <Group title="Records">
            {r.records.map((x) => (
              <a key={x.n} className="rec" href={href("lift", x.n)}>
                <PrBadge />
                <span className="rec-text"><span className="n">{x.n}</span><span className="m">e1RM {num(x.score)} · ▲ {x.pct.toFixed(1)}%</span></span>
                <span className="v">{fmtW(x.best.w)} × {x.best.r}</span>
              </a>
            ))}
          </Group>
        )}
        {r.beat.length > 0 && <Group title="Beat last time">{r.beat.map((x) => <Plain key={x.n} x={x} mark={x.vsLast > 0.05 ? `▲ ${x.vsLast.toFixed(1)}%` : "— matched"} />)}</Group>}
        {r.below.length > 0 && <Group title="Below last time">{r.below.map((x) => <Plain key={x.n} x={x} mark={`▼ ${Math.abs(x.vsLast).toFixed(1)}%`} />)}</Group>}
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
        {r.baseline.length > 0 && <Group title="New baselines">{r.baseline.map((x) => <Plain key={x.n} x={x} mark="first log" />)}</Group>}

        <label className="field">
          <span className="lbl">Note</span>
          <textarea id="summary-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote}
            placeholder="How did it feel? Anything to change next time?" />
        </label>

        <button className="btn btn-ink summary-done" onClick={done}>
          Done <span className="next"><span className="dot" data-day={nextDay} aria-hidden="true" />{next.name} is next</span>
        </button>
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

function Headline() {
  const metal = useMetal();
  const ink = useInk();
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

function Group({ title, children }) {
  return <section className="section"><h2 className="lbl">{title}</h2><div className="card-list">{children}</div></section>;
}

function Plain({ x, mark }) {
  return (
    <a className="rec plain" href={href("lift", x.n)}>
      <span className="rec-text"><span className="n">{x.n}</span><span className="m">{fmtW(x.best.w)} × {x.best.r} · e1RM {num(e1rm(x.best.w, x.best.r))}</span></span>
      <span className="trend flat">{mark}</span>
    </a>
  );
}
