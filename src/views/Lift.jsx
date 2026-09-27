import React, { useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { allDays, isCardio } from "../data/program.js";
import { href } from "../lib/router.js";
import { liftSeries, trend, repPRs, num, fmtW, fmtSet, cardioTotals, compact, shortDate, bestSet, byDateDesc, isIsolation } from "../lib/util.js";
import { InfoButton, LineChart, Trend } from "../components/ui.jsx";

const METRICS = [
  { key: "orm", label: "Est. max", fmt: num },
  { key: "top", label: "Top set", fmt: num },
  { key: "vol", label: "Volume", fmt: compact },
];

export default function Lift(props) {
  return isCardio(props.name) ? <CardioLog {...props} /> : <LiftDetail {...props} />;
}

/* Cardio has no e1RM: show totals and every logged entry, newest first. */
function CardioLog({ name, sessions, program, back }) {
  const logs = useMemo(() => [...sessions].sort(byDateDesc).filter((s) => s.sets[name]?.length), [sessions, name]);
  const t = cardioTotals(logs.flatMap((s) => s.sets[name]));
  return (
    <main className="screen has-tabs">
      <header className="top">
        <button className="icon-btn boxed" onClick={() => back("#/progress")} aria-label="Back"><ChevronLeft size={20} /></button>
        <span className="spacer" />
        <InfoButton screen="lift" />
      </header>
      <div className="body">
        <h1 className="detail-title">{name}</h1>
        <div className="stats">
          <div className="stat"><b>{logs.length}</b><span>sessions</span></div>
          <div className="stat"><b>{num(t.min)}</b><span>minutes</span></div>
          <div className="stat"><b>{num(t.mi)}</b><span>miles</span></div>
        </div>
        <section className="section" data-help="sessions">
          <h2 className="lbl">Recent sessions</h2>
          <div>
            {logs.slice(0, 12).map((s) => (
              <a key={s.id} className="hist-line" href={href("session", s.day, s.id)} style={{ color: "inherit", textDecoration: "none" }} data-day={s.day}>
                <span className="name"><span className="dot" aria-hidden="true" style={{ marginRight: 8 }} />{shortDate(s.date)} · {program[s.day]?.name}</span>
                <span className="sets">{s.sets[name].map(fmtSet).join(" + ")}</span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function LiftDetail({ name, sessions, program, back }) {
  const iso = isIsolation(name);
  const [metric, setMetric] = useState(iso ? "top" : "orm");
  const series = useMemo(() => liftSeries(sessions, name), [sessions, name]);
  const reps = useMemo(() => repPRs(sessions, name), [sessions, name]);
  const day = allDays(program).find((d) => program[d].exercises.some((e) => e.n === name)) || series[series.length - 1]?.day;
  const m = METRICS.find((x) => x.key === metric);

  const best = series.length ? Math.max(...series.map((x) => x.orm)) : 0;
  const bestTop = bestSet(series.flatMap((x) => x.sets));
  const pct = trend(series.map((x) => x.orm));
  const running = { top: 0, vol: 0 };
  const points = series.map((x) => {
    const v = x[metric];
    const pr = metric === "orm" ? x.pr : v > running[metric];
    if (metric !== "orm") running[metric] = Math.max(running[metric], v);
    return { label: shortDate(x.date), value: v, pr };
  });

  return (
    <main className="screen has-tabs" data-day={day}>
      <header className="top">
        <button className="icon-btn boxed" onClick={() => back("#/progress")} aria-label="Back"><ChevronLeft size={20} /></button>
        <span className="spacer" />
        {day && <span className="chip"><span className="dot" aria-hidden="true" />{program[day].name}</span>}
        <InfoButton screen="lift" />
      </header>
      <div className="body">
        <h1 className="detail-title">{name}</h1>

        {series.length === 0 ? (
          <p className="muted">No sets logged for this lift yet. Its chart and records appear after the first session.</p>
        ) : (
          <>
            {iso ? (
              // Isolation lifts lead with the best set itself; est. max stays one tap away in the chart.
              <section className="section" aria-label={`Best set ${fmtW(bestTop.w)} by ${bestTop.r}`}>
                <span className="lbl">Best set</span>
                <div className="hero-num">
                  <b>{fmtW(bestTop.w)} × {bestTop.r}</b>
                  <span className="mono small" style={{ paddingBottom: 6 }}>{pct != null && <Trend pct={pct} />}</span>
                </div>
              </section>
            ) : (
              <section className="section" aria-label="Best estimated one-rep max">
                <span className="lbl">Best est. max</span>
                <div className="hero-num">
                  <b>{num(best)}</b>
                  <span className="mono small" style={{ paddingBottom: 6 }}>lb &nbsp;{pct != null && <Trend pct={pct} />}</span>
                </div>
              </section>
            )}

            <div className="section">
              <div className="segctl" data-help="metric" role="group" aria-label="Chart metric">
                {METRICS.map((x) => <button key={x.key} aria-pressed={metric === x.key} onClick={() => setMetric(x.key)}>{x.label}</button>)}
              </div>
              {points.length >= 2
                ? <LineChart key={metric} points={points} format={m.fmt} ariaLabel={`${m.label} over ${points.length} sessions, from ${m.fmt(points[0].value)} to ${m.fmt(points[points.length - 1].value)}`} />
                : <p className="small muted">One session so far. The chart appears after the second.</p>}
              <p className="mono small muted">Filled dots set a new best. Tap a dot to read it.</p>
            </div>

            <section className="section" data-help="rep-records">
              <h2 className="lbl">Best by reps</h2>
              <div>
                {reps.map((x) => (
                  <div key={x.r} className="table-row"><span>{x.r} rep{x.r > 1 ? "s" : ""}</span><b>{fmtW(x.w)}</b><span className="muted">{shortDate(x.date)}</span></div>
                ))}
              </div>
            </section>

            <section className="section" data-help="sessions">
              <h2 className="lbl">Recent sessions</h2>
              <div>
                {[...series].reverse().slice(0, 8).map((x) => {
                  const b = bestSet(x.sets);
                  return (
                    <a key={x.id} className="hist-line" href={href("session", x.day, x.id)} style={{ color: "inherit", textDecoration: "none" }} data-day={x.day}>
                      <span className="name"><span className="dot" aria-hidden="true" style={{ marginRight: 8 }} />{shortDate(x.date)}{x.pr && <> <span className="stamp" style={{ marginLeft: 6 }}>PR</span></>}</span>
                      <span className="sets">{x.sets.map((s) => `${fmtW(s.w)}×${s.r}`).join("  ")}<br />best {fmtW(b.w)} × {b.r}</span>
                    </a>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
