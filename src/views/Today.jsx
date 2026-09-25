import React, { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { BorderBeam } from "border-beam";
import { DAYS, PLATES } from "../data/program.js";
import { href } from "../lib/router.js";
import { byDateDesc, bestSet, fmtW, num, shortDate, weekDates, today, nextDayAfter, bodyweightSeries, daysBetween, plural } from "../lib/util.js";

export default function Today({ sessions, program, drafts, weighins, onWeighin }) {
  const sorted = useMemo(() => [...sessions].sort(byDateDesc), [sessions]);
  const draftDay = DAYS.find((d) => drafts[d]);
  const day = draftDay || nextDayAfter(sessions);
  const p = program[day];
  const draft = drafts[day];
  const lastOfDay = sorted.find((s) => s.day === day);

  const setsLogged = draft ? Object.values(draft.grid || {}).reduce((a, rows) => a + rows.filter((r) => r.done).length, 0) : 0;
  const plannedSets = p.exercises.reduce((a, e) => a + e.sets, 0);

  /* Typical length of this day, from sessions with both start and finish times. */
  const usualMins = useMemo(() => {
    const mins = sessions.filter((s) => s.day === day && s.startedAt && s.finishedAt)
      .map((s) => (s.finishedAt - s.startedAt) / 60000).filter((m) => m >= 5 && m <= 240);
    return mins.length ? Math.round(mins.reduce((a, m) => a + m, 0) / mins.length) : null;
  }, [sessions, day]);

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

  const status = draft
    ? `${plural(setsLogged, "set")} logged so far`
    : [lastOfDay ? `Last ${p.name.toLowerCase()} ${shortDate(lastOfDay.date)}` : "Not logged yet", usualMins && `usually ${usualMins} min`].filter(Boolean).join(" · ");

  return (
    <main className="screen has-tabs">
      <header className="top today-top">
        <div className="today-head">
          <span className="lbl">{new Date(t + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
          <h1 className="wordmark">IRONLOG</h1>
        </div>
      </header>

      <div className="body" data-day={day}>
        <section className="hero-card" aria-label={draft ? `${p.name} in progress` : `Up next: ${p.name}`}>
          <Plate kg={PLATES[day].kg} />
          <div className="hero-text">
            <span className="lbl day-lbl">{draft ? "In progress" : "Up next"}</span>
            <span className={"hero-day" + (p.name.length > 6 ? " long" : "")}>{p.name}</span>
            <span className="hero-meta">{p.detail} · {plural(p.exercises.length, "lift")} · {plannedSets} sets<br />{status}</span>
          </div>
          {/* The one primary action breathes softly; pulse types stop themselves under reduced motion. */}
          <BorderBeam size="pulse-inner" colorVariant="mono" theme="auto" strength={0.8}>
            <a className="btn btn-day hero-cta" href={href("session", day)}>
              {draft ? `Resume ${p.name}` : `Start ${p.name}`}
              <ArrowRight size={20} strokeWidth={2.6} aria-hidden="true" />
            </a>
          </BorderBeam>
        </section>

        <WeighIn sessions={sessions} weighins={weighins} onSave={onWeighin} />

        {targets.length > 0 && (
          <section className="section">
            <div className="section-head"><h2 className="lbl">Beat these</h2><span className="small muted">best set last time</span></div>
            <div className="card-list">
              {targets.map((x) => (
                <a key={x.n} className="card-row" href={href("lift", x.n)}>
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
                <a key={d} className="other" data-day={d} href={href("session", d)}>
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

/** Competition plate in the day's colour, bleeding off the hero card's corner. */
function Plate({ kg }) {
  return (
    <svg className="hero-plate" viewBox="0 0 210 210" aria-hidden="true">
      <circle cx="105" cy="105" r="100" style={{ fill: "var(--day)" }} />
      <circle cx="105" cy="105" r="92" style={{ fill: "none", stroke: "color-mix(in srgb, var(--day) 55%, #000)", strokeWidth: 3 }} />
      <circle cx="105" cy="105" r="70" style={{ fill: "none", stroke: "color-mix(in srgb, var(--day) 78%, #000)", strokeWidth: 1.5 }} />
      <circle cx="105" cy="105" r="30" style={{ fill: "color-mix(in srgb, var(--day) 85%, #000)" }} />
      <circle cx="105" cy="105" r="19" style={{ fill: "var(--surface)" }} />
      <text x="105" y="186" textAnchor="middle" style={{ fill: "var(--on-day)", fontFamily: "var(--display)", fontWeight: 900, fontSize: 20, letterSpacing: 1 }}>{kg}</text>
    </svg>
  );
}

/** Weekly nudge: shows when the last bodyweight (weigh-in or session) is 7+ days old, or there is none. */
function WeighIn({ sessions, weighins, onSave }) {
  const series = useMemo(() => bodyweightSeries(sessions, weighins), [sessions, weighins]);
  const last = series[series.length - 1];
  const t = today();
  const [bw, setBw] = useState("");
  if (last && daysBetween(last.date, t) < 7) return null;

  const ago = last ? daysBetween(last.date, t) : null;
  const value = parseFloat(bw);
  const valid = value > 0 && value < 1000;
  const save = (e) => {
    e.preventDefault();
    if (!valid) return;
    onSave(t, Math.round(value * 10) / 10);
    setBw("");
  };
  return (
    <form className="weigh" onSubmit={save} aria-label="Weekly weigh-in">
      <div className="weigh-text">
        <b>Weigh-in due</b>
        <span className="small muted">{last ? `Last: ${num(last.bw)} lb · ${plural(ago, "day")} ago` : "Log your bodyweight to start the chart"}</span>
      </div>
      <label className="weigh-field">
        <span className="sr-only">Bodyweight in pounds</span>
        <input id="weigh-bw" type="number" inputMode="decimal" step="0.1" placeholder={last ? num(last.bw) : "—"} value={bw} onChange={(e) => setBw(e.target.value)} />
        <span className="u">lb</span>
      </label>
      <button type="submit" className="btn btn-ink weigh-save" disabled={!valid}>Save</button>
    </form>
  );
}
