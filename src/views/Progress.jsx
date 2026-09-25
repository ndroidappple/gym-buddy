import React, { useMemo } from "react";
import { DAYS } from "../data/program.js";
import { href } from "../lib/router.js";
import { liftSeries, trend, num, shortDate, bodyweightSeries } from "../lib/util.js";
import { Sparkline, Trend, LineChart } from "../components/ui.jsx";

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
    return out.map((g) => ({
      ...g,
      rows: g.lifts.map((n) => {
        const series = liftSeries(sessions, n);
        const vals = series.map((x) => x.orm);
        return { n, series, vals, best: vals.length ? Math.max(...vals) : 0, pct: trend(vals) };
      }),
    }));
  }, [sessions, program]);

  const all = groups.flatMap((g) => g.rows).filter((r) => r.pct != null);
  const up = all.filter((r) => r.pct >= 1).length;
  const flat = all.filter((r) => r.pct < 1).length;

  const bw = useMemo(() => bodyweightSeries(sessions, weighins)
    .map((x) => ({ label: shortDate(x.date), value: x.bw })), [sessions, weighins]);

  return (
    <main className="screen has-tabs">
      <header className="top"><h1 className="page-title">Progress</h1></header>
      <div className="body">
        {all.length > 0 && (
          <p className="small muted">
            Trends compare each lift's best e1RM over its latest sessions (up to 3) with the same number before them. <b style={{ color: "var(--ink)" }}>{up} moving up</b>, {flat} flat or down.
          </p>
        )}

        {bw.length >= 2 && (
          <section className="section">
            <div className="section-head"><h2 className="lbl">Bodyweight</h2><span className="mono small">{num(bw[bw.length - 1].value)} lb</span></div>
            <LineChart points={bw} format={num} height={120} ariaLabel={`Bodyweight from ${bw[0].value} to ${bw[bw.length - 1].value} pounds`} />
          </section>
        )}

        {groups.map((g) => (
          <section key={g.name} className="section" data-day={g.day || undefined}>
            <div className="section-head"><h2 className="lbl"><span className="dot" aria-hidden="true" style={{ marginRight: 8 }} />{g.name}</h2></div>
            <div>
              {g.rows.map((r) => (
                <a key={r.n} className="lift-row" href={href("lift", r.n)} style={{ color: "inherit", textDecoration: "none" }}>
                  <span className="name">{r.n}
                    <span className="sub">{r.vals.length ? `e1RM ${num(r.best)} · ${r.vals.length} session${r.vals.length > 1 ? "s" : ""}` : "Not logged yet"}</span>
                  </span>
                  <Sparkline values={r.vals} />
                  {r.vals.length ? <Trend pct={r.pct} /> : <span />}
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
