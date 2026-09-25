import React, { useMemo, useState } from "react";
import { Scale } from "lucide-react";
import { isCardio, activeDays } from "../data/program.js";
import { href } from "../lib/router.js";
import { liftSeries, trend, num, shortDate, bodyweightSeries, daysBetween, today } from "../lib/util.js";
import { InfoButton, Sparkline, Trend } from "../components/ui.jsx";
import PhaseCard from "../components/PhaseCard.jsx";
import PhaseSheet from "../components/PhaseSheet.jsx";

/* A lift is "on a PR" when its latest session beat every earlier one (not its first) in the last two weeks. */
const PR_DAYS = 14;

export default function Progress({ sessions, program, weighins, prefs, setPref, notify, onWeighin, onProgramChange, openPhase }) {
  const [starting, setStarting] = useState(!!openPhase && !prefs?.phase);
  const phase = prefs?.phase || null;
  const updatePhase = (patch) => setPref("phase", { ...phase, ...patch });
  // Ending files the phase (with its recap) under phaseHistory; Undo puts it back.
  const endPhase = (recap) => {
    const before = { phase, history: prefs.phaseHistory || [] };
    setPref("phaseHistory", [...before.history, { ...phase, endedAt: Date.now(), recap }]);
    setPref("phase", null);
    notify?.(recap ? "Phase complete" : "Phase ended", () => { setPref("phase", before.phase); setPref("phaseHistory", before.history); });
  };
  const groups = useMemo(() => {
    const seen = new Set();
    const out = activeDays(program).map((d) => {
      const lifts = program[d].exercises.map((e) => e.n).filter((n) => !seen.has(n) && seen.add(n));
      return { day: d, name: program[d].name, lifts };
    });
    const other = new Set();
    sessions.forEach((s) => Object.keys(s.sets).forEach((n) => { if (!seen.has(n)) other.add(n); }));
    if (other.size) out.push({ day: null, name: "Off program", lifts: [...other].sort() });
    return out.map((g) => {
      const rows = g.lifts.filter((n) => !isCardio(n)).map((n) => {
        const series = liftSeries(sessions, n);
        const vals = series.map((x) => x.orm);
        const last = series[series.length - 1];
        const pr = series.length > 1 && last.pr && daysBetween(last.date, today()) <= PR_DAYS;
        return { n, vals, best: vals.length ? Math.max(...vals) : 0, pct: trend(vals), pr };
      });
      return { ...g, logged: rows.filter((r) => r.vals.length), unlogged: rows.filter((r) => !r.vals.length).map((r) => r.n) };
    });
  }, [sessions, program]);

  const all = groups.flatMap((g) => g.logged).filter((r) => r.pct != null);
  const up = all.filter((r) => r.pct >= 1).length;
  const bw = useMemo(() => bodyweightSeries(sessions, weighins), [sessions, weighins]);

  return (
    <main className="screen has-tabs">
      <header className="top">
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 className="page-title">Progress</h1>
          {all.length > 0 && <span className="lbl" style={{ fontSize: 15 }}>{up} of {all.length} lifts moving up</span>}
        </div>
        <InfoButton screen="progress" />
      </header>
      <div className="body">
        <PhaseCard phase={phase} sessions={sessions} weighins={weighins} program={program}
          onStart={() => setStarting(true)} onLog={onWeighin} onUpdate={updatePhase} onEnd={endPhase} onProgramChange={onProgramChange} />
        <Bodyweight series={bw} phase={phase} />
        {starting && (
          <PhaseSheet lastWeight={bw[bw.length - 1]?.bw} onClose={() => setStarting(false)}
            onStart={(p) => {
              setPref("phase", p);
              // The phase starts from today's weight; log it so the chart and pace begin there.
              if (!weighins.some((w) => w.date === p.start && w.bw === p.startWeight)) onWeighin(p.start, p.startWeight);
              setStarting(false);
            }} />
        )}

        {groups.map((g) => (g.logged.length || g.unlogged.length) ? (
          <section key={g.name} className="section" data-day={g.day || undefined}>
            <h2 className="lbl" style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="dot" aria-hidden="true" />{g.name}</h2>
            <div className="card-list">
              {g.logged.map((r) => (
                // Fresh PRs get the animated gold rim (.pr-rim); with motion off it holds still.
                <a key={r.n} className={"lift-row" + (r.pr ? " pr-rim" : "")} href={href("lift", r.n)}>
                  <span className="name">{r.pr && <span className="stamp pr-stamp">PR</span>}{r.n}
                    <span className="sub">Est. max {num(r.best)} lb · {r.vals.length} session{r.vals.length > 1 ? "s" : ""}</span>
                  </span>
                  <Sparkline values={r.vals} />
                  <Trend pct={r.pct} />
                </a>
              ))}
              {g.unlogged.length > 0 && (
                <div className="lift-row unlogged">
                  <span className="name" style={{ whiteSpace: "normal" }}>Not logged yet
                    <span className="sub">{g.unlogged.join(", ")}</span>
                  </span>
                </div>
              )}
            </div>
          </section>
        ) : null)}
      </div>
    </main>
  );
}

/* Weigh-ins and session bodyweight together. The card is a way in, not a verdict: the change is shown, never colored. */
function Bodyweight({ series, phase }) {
  if (phase) return <PhaseChart series={series} phase={phase} />;
  if (series.length < 2) {
    return (
      <div className="card bw-empty">
        <span className="weigh-icon" aria-hidden="true"><Scale size={22} /></span>
        <span className="small" style={{ fontWeight: 600 }}>
          {series.length ? `${num(series[0].bw)} lb logged. One more weigh-in and your chart starts.` : "Log a weigh-in on Today to start your bodyweight chart."}
        </span>
      </div>
    );
  }
  const first = series[0], last = series[series.length - 1];
  const delta = last.bw - first.bw;
  const vals = series.map((x) => x.bw);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const W = 326, H = 86;
  const pts = series.map((x, i) => [4 + (i / (series.length - 1)) * (W - 10), 8 + (1 - (x.bw - lo) / span) * (H - 16)]);
  const change = Math.abs(delta) < 0.05 ? "No change" : `${delta > 0 ? "▲" : "▼"} ${num(Math.abs(delta))} lb`;
  return (
    <section className="bw-card" aria-label={`Bodyweight ${num(last.bw)} pounds. ${change} since ${shortDate(first.date)}.`}>
      <div className="top-row">
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <span className="lbl">Bodyweight</span>
          <span className="big">{num(last.bw)} <small>lb</small></span>
        </div>
        <span className="pill">{change}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {pts.slice(0, -1).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" fill="var(--accent)" stroke="#FFFFFF" strokeWidth="2.5" />)}
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="7" fill="#FFFFFF" />
      </svg>
      <div className="ends"><span style={{ flex: 1 }}>{shortDate(first.date)}</span><span>{shortDate(last.date)}</span></div>
    </section>
  );
}

/* During a bulk or cut the chart runs on dates across the whole phase: weigh-ins as dots, and a
   dashed line from the start weight to the target so "on pace" is something you can see. */
function PhaseChart({ series, phase }) {
  const from = !series[0] || phase.start < series[0].date ? phase.start : series[0].date;
  const to = phase.end;
  const pts = series.filter((x) => x.date >= from && x.date <= to);
  const last = pts[pts.length - 1] || { bw: phase.startWeight, date: phase.start };
  const vals = [...pts.map((x) => x.bw), phase.startWeight, phase.target];
  const lo = Math.min(...vals) - 0.5, hi = Math.max(...vals) + 0.5, span = hi - lo || 1;
  const W = 326, H = 96, total = Math.max(1, daysBetween(from, to));
  const X = (d) => 6 + (daysBetween(from, d) / total) * (W - 14);
  const Y = (bw) => 8 + (1 - (bw - lo) / span) * (H - 16);
  return (
    <section className="bw-card" aria-label={`Bodyweight ${num(last.bw)} pounds. Target ${num(phase.target)} by ${shortDate(phase.end)}.`}>
      <div className="top-row">
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <span className="lbl">Bodyweight</span>
          <span className="big">{num(last.bw)} <small>lb</small></span>
        </div>
        <span className="pill">Target {num(phase.target)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <line x1={X(phase.start)} y1={Y(phase.startWeight)} x2={X(phase.end)} y2={Y(phase.target)} stroke="#FFFFFF" strokeOpacity=".55" strokeWidth="2.5" strokeDasharray="5 6" strokeLinecap="round" />
        <circle cx={X(phase.end)} cy={Y(phase.target)} r="5" fill="none" stroke="#FFFFFF" strokeWidth="2.5" />
        {pts.length > 1 && <polyline points={pts.map((x) => `${X(x.date)},${Y(x.bw)}`).join(" ")} fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
        {pts.map((x, i) => <circle key={x.date} cx={X(x.date)} cy={Y(x.bw)} r={i === pts.length - 1 ? 7 : 4} fill={i === pts.length - 1 ? "#FFFFFF" : "var(--accent)"} stroke="#FFFFFF" strokeWidth="2.5" />)}
      </svg>
      <div className="ends"><span style={{ flex: 1 }}>{shortDate(from)}</span><span>Target {shortDate(to)}</span></div>
    </section>
  );
}
