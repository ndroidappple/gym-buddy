import React, { useMemo } from "react";
import { Scale } from "lucide-react";
import { BorderBeam } from "border-beam";
import { isCardio, DAYS } from "../data/program.js";
import { href } from "../lib/router.js";
import { liftSeries, trend, num, shortDate, bodyweightSeries, daysBetween, today } from "../lib/util.js";
import { InfoButton, Sparkline, Trend } from "../components/ui.jsx";
import { useReducedMotion } from "../lib/motion.js";
import { useTheme } from "../lib/theme.js";

/* A lift is "on a PR" when its latest session beat every earlier one (not its first) in the last two weeks. */
const PR_DAYS = 14;

export default function Progress({ sessions, program, weighins }) {
  const groups = useMemo(() => {
    const seen = new Set();
    const out = DAYS.map((d) => {
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
  const reduced = useReducedMotion();
  const theme = useTheme();

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
        <Bodyweight series={bw} />

        {groups.map((g) => (g.logged.length || g.unlogged.length) ? (
          <section key={g.name} className="section" data-day={g.day || undefined}>
            <h2 className="lbl" style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="dot" aria-hidden="true" />{g.name}</h2>
            <div className="card-list">
              {g.logged.map((r) => {
                const row = (
                  <a key={r.n} className={"lift-row" + (r.pr ? " is-pr" : "")} href={href("lift", r.n)}>
                    <span className="name">{r.pr && <span className="stamp pr-stamp">PR</span>}{r.n}
                      <span className="sub">e1RM {num(r.best)} · {r.vals.length} session{r.vals.length > 1 ? "s" : ""}</span>
                    </span>
                    <Sparkline values={r.vals} />
                    <Trend pct={r.pct} />
                  </a>
                );
                // A bold travelling rim on fresh PRs; the PR stamp carries the meaning when motion is off.
                return r.pr ? <BorderBeam key={r.n} size="md" colorVariant="sunset" theme={theme} active={!reduced} className="pr-beam">{row}</BorderBeam> : row;
              })}
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
function Bodyweight({ series }) {
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
