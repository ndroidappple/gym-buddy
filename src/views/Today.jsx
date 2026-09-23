import React, { useMemo } from "react";
import { DAYS, PLATES } from "../data/program.js";
import { href } from "../lib/router.js";
import { byDateDesc, bestSet, fmtW, shortDate, weekDates, today, nextDayAfter } from "../lib/util.js";

export default function Today({ sessions, program, drafts }) {
  const sorted = useMemo(() => [...sessions].sort(byDateDesc), [sessions]);
  const draftDay = DAYS.find((d) => drafts[d]);
  const day = draftDay || nextDayAfter(sessions);
  const p = program[day];
  const draft = drafts[day];
  const lastOfDay = sorted.find((s) => s.day === day);

  const setsLogged = draft ? Object.values(draft.grid || {}).reduce((a, rows) => a + rows.filter((r) => r.done).length, 0) : 0;

  const targets = useMemo(() => p.exercises.map((ex) => {
    const prior = sorted.find((s) => s.sets[ex.n]?.length);
    return prior ? { n: ex.n, best: bestSet(prior.sets[ex.n]) } : null;
  }).filter(Boolean).slice(0, 3), [p, sorted]);

  const week = weekDates();
  const t = today();
  const byDate = useMemo(() => {
    const m = {};
    sessions.forEach((s) => { m[s.date] ||= s.day; });
    return m;
  }, [sessions]);
  const doneThisWeek = week.filter((d) => byDate[d]).length;

  return (
    <main className="screen has-tabs">
      <header className="top">
        <h1 className="wordmark">IRONLOG</h1>
        <span className="spacer" />
        <span className="chip">Day {DAYS.indexOf(day) + 1} of 4</span>
      </header>

      <div className="body" data-day={day}>
        <section className="hero" aria-label={draft ? `${p.name} in progress` : `Up next: ${p.name}`}>
          <div className="disk" aria-hidden="true"><span className="kg">{PLATES[day].kg}</span><span className="kgb">{p.name.toUpperCase()}</span></div>
          <div className="hero-text">
            <span className="lbl">{draft ? "In progress" : "Up next"}</span>
            <span className="hero-day">{p.name}</span>
            <span className="muted small">
              {p.detail} · {p.exercises.length} lifts<br />
              {draft ? `${setsLogged} sets logged so far` : lastOfDay ? `Last done ${shortDate(lastOfDay.date)}` : "Not logged yet"}
            </span>
          </div>
        </section>

        <a className="btn btn-day" href={href("session", day)}>{draft ? `Resume ${p.name}` : `Start ${p.name}`}</a>

        {targets.length > 0 && (
          <section className="section">
            <h2 className="lbl">Beat these</h2>
            <div className="rows">
              {targets.map((x) => (
                <a key={x.n} href={href("lift", x.n)} style={{ color: "inherit", textDecoration: "none" }}>
                  <span className="name">{x.n}</span>
                  <span className="v">{fmtW(x.best.w)} × {x.best.r}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        <section className="section">
          <div className="section-head"><h2 className="lbl">This week</h2><span className="mono small muted">{doneThisWeek} of 4</span></div>
          <div className="week">
            {week.map((d) => {
              const dd = byDate[d];
              const label = new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "narrow" });
              return (
                <div key={d} className={"wd" + (d === t ? " now" : "")} data-day={dd || undefined}
                  aria-label={`${new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" })}: ${dd ? program[dd].name : "rest"}`}>
                  <i className={dd ? "on" : ""} />{label}
                </div>
              );
            })}
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Or train</h2>
          <div className="others">
            {DAYS.filter((d) => d !== day).map((d) => {
              const last = sorted.find((s) => s.day === d);
              return (
                <a key={d} className="other" data-day={d} href={href("session", d)} style={{ color: "inherit", textDecoration: "none" }}>
                  <b><span className="dot" aria-hidden="true" />{PLATES[d].short}</b>
                  <span>{drafts[d] ? "In progress" : last ? shortDate(last.date) : "Not yet"}</span>
                </a>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
