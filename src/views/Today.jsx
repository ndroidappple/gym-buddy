import React, { useMemo, useState } from "react";
import { InfoButton, Sheet } from "../components/ui.jsx";
import { Scale, ArrowLeftRight, Check, X } from "lucide-react";
import { DAYS, CUSTOM, activeDays } from "../data/program.js";
import { href } from "../lib/router.js";
import { COACHES, coachesFor } from "../data/coaches.js";
import SetupCard from "../components/SetupCard.jsx";
import Coach from "../components/Coach.jsx";
import { byDateDesc, bestSet, fmtW, num, shortDate, weekDates, today, nextDayAfter, bodyweightSeries, daysBetween, plural, readyToIncrease } from "../lib/util.js";

export default function Today({ name, sessions, program, drafts, weighins, prefs, onWeighin }) {
  const sorted = useMemo(() => [...sessions].sort(byDateDesc), [sessions]);
  const draftDay = [...activeDays(program), CUSTOM].find((d) => drafts[d]);
  const t = today();
  const [pick, setPick] = useState(loadPick);
  const [choosing, setChoosing] = useState(false);
  // A swapped day holds for today only, until the next session is logged.
  const picked = pick && pick.date === t && pick.after === sessions.length && program[pick.day] ? pick.day : null;
  const suggested = nextDayAfter(sessions, program);
  // A workout in progress leads unless the lifter picked another day; that draft stays saved.
  const fallback = draftDay || suggested;
  const day = picked || fallback;
  const p = program[day];
  const draft = drafts[day];
  const lastOfDay = sorted.find((s) => s.day === day);
  const choose = (d) => {
    const next = d === fallback ? null : { date: t, day: d, after: sessions.length };
    setPick(next);
    try { next ? localStorage.setItem(PICK_KEY, JSON.stringify(next)) : localStorage.removeItem(PICK_KEY); } catch {}
    setChoosing(false);
  };

  const setsLogged = draft ? Object.values(draft.grid || {}).reduce((a, rows) => a + rows.filter((r) => r.done).length, 0) : 0;
  const plannedSets = p.exercises.reduce((a, e) => a + e.sets, 0);
  const crew = useMemo(() => coachesFor(p.exercises.map((e) => e.n)), [p]);
  const daysOff = sorted[0] ? daysBetween(sorted[0].date, t) : null;
  const lead = crew[0];

  /* Typical length of this day, from sessions with both start and finish times. */
  const usualMins = useMemo(() => {
    const mins = sessions.filter((s) => s.day === day && s.startedAt && s.finishedAt)
      .map((s) => (s.finishedAt - s.startedAt) / 60000).filter((m) => m >= 5 && m <= 240);
    return mins.length ? Math.round(mins.reduce((a, m) => a + m, 0) / mins.length) : null;
  }, [sessions, day]);

  // Lifts that earned more weight lead the list; the rest show last time's best set to beat.
  const targets = useMemo(() => p.exercises.map((ex) => {
    const prior = sorted.find((s) => s.sets[ex.n]?.length);
    const best = prior && bestSet(prior.sets[ex.n]);
    return best ? { n: ex.n, best, bump: readyToIncrease(ex, prior.sets[ex.n]) } : null;
  }).filter(Boolean).sort((a, b) => !!b.bump - !!a.bump).slice(0, 3), [p, sorted]);

  const week = weekDates();
  const byDate = useMemo(() => {
    const m = {};
    sessions.forEach((s) => { m[s.date] ||= s.day; });
    return m;
  }, [sessions]);
  const doneThisWeek = week.filter((d) => byDate[d]).length;

  const names = crew.map((id) => COACHES[id].name);
  const onDeck = names.length <= 2 ? names.join(" & ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  const to = name ? `, ${name}` : "";
  const headline = draft ? `${p.name} in progress.` : daysOff != null && daysOff >= 5 ? `${daysOff} days off${to}. Back to it.` : `${p.name} day${to}. Let's lift.`;

  return (
    <main className="screen has-tabs">
      <header className="top today-top">
        <div className="today-head">
          <span className="lbl">{new Date(t + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
          <h1>{headline}</h1>
        </div>
        <a className="coach-link" href="#/coaches" aria-label="Meet your coaches">
          {/* 5+ days away and the lead coach misses you. */}
          <Coach id={lead} mood={daysOff != null && daysOff >= 5 ? "sleepy" : "idle"} size={38} badge decorative />
        </a>
        <InfoButton screen="today" />
      </header>

      <div className="body" data-day={day}>
        {sessions.length === 0 && <SetupCard prefs={prefs} glow />}
        <section className="hero-card" aria-label={draft ? `${p.name} in progress` : `Up next: ${p.name}`}>
          <div className="hero-top">
            <span className="pill day-lbl">{draft ? `In progress · ${plural(setsLogged, "set")} logged` : day === CUSTOM ? "Today · Custom workout" : `${picked ? "Today" : "Up next"} · Day ${activeDays(program).indexOf(day) + 1}`}</span>
            <button type="button" className="pill hero-switch" onClick={() => setChoosing(true)} aria-haspopup="dialog">
              <ArrowLeftRight size={14} strokeWidth={2.6} aria-hidden="true" />Change
            </button>
          </div>
          <div className="hero-text">
            <span className={"hero-day" + (p.name.length > 6 ? " long" : "")}>{p.name}</span>
            <span className="hero-meta">{p.detail}{lastOfDay ? ` · last done ${shortDate(lastOfDay.date)}` : ""}</span>
          </div>
          {p.exercises.length > 0 && (
            <>
              <div className="hero-pills">
                <span className="pill">{plural(p.exercises.length, "lift")}</span>
                <span className="pill">{plannedSets} sets</span>
                {usualMins && <span className="pill">~{usualMins} min</span>}
              </div>
              <div className="hero-coaches">
                <span className="coach-stack">{crew.slice(0, 3).map((id) => <span key={id} className="coach-chip"><Coach id={id} size={32} still badge decorative /></span>)}</span>
                <span>{onDeck} {crew.length === 1 ? "is" : "are"} on deck</span>
              </div>
            </>
          )}
          <a className="btn hero-cta" href={href("session", day)}>{draft ? `Resume ${p.name}` : "Start lifting"}</a>
        </section>

        {choosing && (
          <Sheet title="Train something else" sub={draftDay ? `Your ${program[draftDay].name} workout in progress stays saved. Tap it to pick back up.` : "Swap today's workout. Your rotation picks back up after you log it."} onClose={() => setChoosing(false)} labelledBy="swap-title">
            <div className="list">
              {[...activeDays(program), CUSTOM].map((d) => (
                <button key={d} type="button" className="list-row" data-day={d} aria-pressed={d === day} onClick={() => choose(d)}>
                  <span className="dot" aria-hidden="true" />
                  <span className="name">{d === CUSTOM ? "Custom workout" : program[d].name}{drafts[d] ? " · in progress" : d === suggested ? " · up next" : ""}
                    <span className="sub">{d === CUSTOM ? "Start empty and add any lifts or cardio." : `${program[d].detail} · ${plural(program[d].exercises.length, "lift")}`}</span></span>
                  {d === day && <Check size={18} strokeWidth={2.6} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </Sheet>
        )}

        {sessions.length > 0 && <SetupCard prefs={prefs} />}

        <WeighIn sessions={sessions} weighins={weighins} onSave={onWeighin} />

        {targets.length > 0 && (
          <section className="section">
            <h2 className="lbl">Beat these today</h2>
            <div className="card-list">
              {targets.map((x) => (
                <a key={x.n} className="card-row" href={href("lift", x.n)}>
                  <span className="name">{x.n}</span>
                  {x.bump
                    ? <span className="v up" aria-label={`Go up to ${fmtW(x.bump.to)} pounds`}>↑ {fmtW(x.bump.to)} lb</span>
                    : <span className="v">{fmtW(x.best.w)} × {x.best.r}</span>}
                </a>
              ))}
            </div>
          </section>
        )}

        <section className="section">
          <div className="section-head"><h2 className="lbl">This week</h2><span className="lbl">{doneThisWeek} done · aim ~{prefs?.profile?.days || activeDays(program).length}</span></div>
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
          <h2 className="lbl">Or train another day</h2>
          <div className="others">
            {activeDays(program).filter((d) => d !== day).map((d) => {
              const last = sorted.find((s) => s.day === d);
              return (
                <a key={d} className="other" data-day={d} href={href("session", d)}>
                  <b><span className="dot" aria-hidden="true" />{program[d].name}</b>
                  <span>{drafts[d] ? "In progress" : last ? `Last done ${shortDate(last.date)}` : "Not done yet"}</span>
                </a>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}

/** Weekly nudge: shows when the last bodyweight (weigh-in or session) is 7+ days old, or there is none. */
const PICK_KEY = "ironlog-today-pick";
const SKIP_KEY = "ironlog-weigh-skip"; // holds the Monday of the week the weigh-in was skipped
function loadPick() {
  try { return JSON.parse(localStorage.getItem(PICK_KEY)) || null; } catch { return null; }
}

function WeighIn({ sessions, weighins, onSave }) {
  const series = useMemo(() => bodyweightSeries(sessions, weighins), [sessions, weighins]);
  const last = series[series.length - 1];
  const t = today();
  const [bw, setBw] = useState("");
  // ✕ skips the weigh-in until next Monday.
  const week = weekDates()[0];
  const [skipped, setSkipped] = useState(() => { try { return localStorage.getItem(SKIP_KEY) === week; } catch { return false; } });
  if (skipped || (last && daysBetween(last.date, t) < 7)) return null;
  const skip = () => {
    try { localStorage.setItem(SKIP_KEY, week); } catch {}
    setSkipped(true);
  };

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
      <span className="weigh-icon" aria-hidden="true"><Scale size={22} /></span>
      <div className="weigh-text">
        <b>Weigh-in due</b>
        <span className="small muted">{last ? `Last: ${num(last.bw)} lb · ${plural(ago, "day")} ago` : "Log your bodyweight to start the chart"}</span>
      </div>
      <label className="weigh-field">
        <span className="sr-only">Bodyweight in pounds</span>
        <input id="weigh-bw" type="number" inputMode="decimal" step="0.1" placeholder={last ? num(last.bw) : "—"} value={bw} onChange={(e) => setBw(e.target.value)} />
        <span className="u">lb</span>
      </label>
      <button type="submit" className="btn weigh-save" disabled={!valid}>Save</button>
      <button type="button" className="weigh-skip" onClick={skip} aria-label="Skip this week's weigh-in"><X size={14} strokeWidth={3} aria-hidden="true" /></button>
    </form>
  );
}
