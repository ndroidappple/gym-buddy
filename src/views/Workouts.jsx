import React, { useMemo, useState } from "react";
import { EmptyState } from "../components/ui.jsx";
import { Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import { allDays, CUSTOM } from "../data/program.js";
import { href } from "../lib/router.js";
import { fmtSet, bestSet, byDateDesc, longDate, compact, sessionVolume, sessionSetCount, plural, priorSessions, allTimeBest, bestE1rm, e1rm, num, today, iso } from "../lib/util.js";

/** Progress → Workouts: every logged workout as a list or a month calendar, filterable by day.
    The list/calendar switch lives in the Progress header (`calendar`). */
export default function Workouts({ sessions, program, calendar }) {
  const [filter, setFilter] = useState(null);
  const sorted = useMemo(() => [...sessions].sort(byDateDesc), [sessions]);
  const shown = filter ? sorted.filter((s) => s.day === filter) : sorted;

  // Per session, the lifts that set a record: which set did it, the new best est. max and the old one.
  const prs = useMemo(() => {
    const m = {};
    sessions.forEach((s) => {
      const prior = priorSessions(sessions, s);
      const hits = {};
      Object.entries(s.sets).forEach(([n, sets]) => {
        const was = allTimeBest(prior, n);
        const now = bestE1rm(sets);
        if (!was || now <= was + 0.05) return;
        const idx = sets.findIndex((x) => x.w != null && x.r != null && Math.abs(e1rm(x.w, x.r) - now) < 0.01);
        hits[n] = { idx, now, was };
      });
      m[s.id] = hits;
    });
    return m;
  }, [sessions]);

  return (
    <>
      {sessions.length === 0 ? (
        <EmptyState title="No workouts yet" action="Start your first workout" href="#/today">
          Every workout you log shows up here: sets, total weight lifted and any PRs. Tap the pencil on one to fix a mistake.
        </EmptyState>
      ) : (<>
      <div className="filters" role="group" aria-label="Filter by day">
        <button className="chip" aria-pressed={!filter} onClick={() => setFilter(null)}>All</button>
        {[...allDays(program), CUSTOM].filter((d) => !program[d].off || sessions.some((x) => x.day === d)).filter((d) => d !== CUSTOM || sessions.some((x) => x.day === d)).map((d) => (
          <button key={d} className="chip" data-day={d} aria-pressed={filter === d} onClick={() => setFilter(filter === d ? null : d)}>
            <span className="dot" aria-hidden="true" />{program[d].name}
          </button>
        ))}
      </div>

      {calendar
        ? <MonthCalendar sessions={shown} program={program} prs={prs} />
        : (
          <>
            {shown.length === 0 && <p className="muted">No {filter ? program[filter].name : ""} sessions logged yet.</p>}
            {shown.map((s) => <HistCard key={s.id} s={s} program={program} prs={prs} />)}
          </>
        )}
      </>)}
    </>
  );
}

/* A month grid (Monday first, like Today's week) with a dot per workout in that day's colour.
   Tapping a day shows its workouts below, as the same cards the list uses. */
function MonthCalendar({ sessions, program, prs }) {
  const byDate = useMemo(() => {
    const m = {};
    sessions.forEach((s) => { (m[s.date] ||= []).push(s); });
    return m;
  }, [sessions]);
  const latest = sessions[0]?.date; // sessions arrive newest first
  const [picked, setPicked] = useState(latest || today());
  const [month, setMonth] = useState(() => (latest || today()).slice(0, 7)); // "YYYY-MM"

  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1, 12);
  const lead = (first.getDay() + 6) % 7; // blanks before the 1st, Monday-first
  const daysIn = new Date(y, m, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => iso(new Date(y, m - 1, i + 1, 12)))];
  const shift = (n) => { const d = new Date(y, m - 1 + n, 1, 12); setMonth(iso(d).slice(0, 7)); };
  const t = today();
  const count = cells.filter((d) => d && byDate[d]).length;
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));

  return (
    <>
      <section className="card cal" aria-label="Workout calendar">
        <div className="cal-head">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={20} /></button>
          <div className="cal-title">
            <b>{first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b>
            <span>{plural(count, "workout day")}</span>
          </div>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month" disabled={month >= t.slice(0, 7)}><ChevronRight size={20} /></button>
        </div>
        <div className="cal-grid" role="grid">
          {weekdays.map((w, i) => <span key={i} className="cal-wd" aria-hidden="true">{w}</span>)}
          {cells.map((d, i) => {
            if (!d) return <span key={`b${i}`} />;
            const day = byDate[d] || [];
            const label = `${longDate(d)}${day.length ? `: ${day.map((s) => program[s.day].name).join(", ")}` : ", no workout"}`;
            return (
              <button key={d} type="button" className={"cal-day" + (d === t ? " is-today" : "") + (d === picked ? " is-picked" : "") + (day.length ? " has" : "")}
                aria-label={label} aria-pressed={d === picked} disabled={d > t} onClick={() => setPicked(d)}>
                <span className="cal-num">{Number(d.slice(8))}</span>
                <span className="cal-dots" aria-hidden="true">
                  {day.slice(0, 3).map((s) => <i key={s.id} data-day={s.day} />)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {(byDate[picked] || []).length
        ? byDate[picked].map((s) => <HistCard key={s.id} s={s} program={program} prs={prs} />)
        : <p className="muted cal-none">No workout logged on {longDate(picked)}.</p>}
    </>
  );
}

/** One logged workout: sets, volume, PRs (with the record set and what it beat) and an edit link. */
function HistCard({ s, program, prs }) {
  const hits = prs[s.id] || {};
  const n = Object.keys(hits).length;
  // Each lift shows its top set (the record set on a PR); every set is one tap away.
  const [all, setAll] = useState(false);
  return (
    <article className="hist" data-help="workout" data-day={s.day}>
      <div className="hist-head">
        <div style={{ flex: 1 }}>
          <h2 className="hist-date">{longDate(s.date)}</h2>
          <div className="hist-meta">
            {program[s.day].name} · {plural(sessionSetCount(s), "set")}{sessionVolume(s) > 0 && ` · ${compact(sessionVolume(s))} lb lifted`}{s.bw != null && ` · ${s.bw} lb bodyweight`}
          </div>
        </div>
        {n > 0 && <span className="stamp">PR{n > 1 ? ` ×${n}` : ""}</span>}
        <a className="icon-btn" data-help="edit" href={href("session", s.day, s.id)} aria-label={`Edit ${program[s.day].name} session on ${longDate(s.date)}`}><Pencil size={17} /></a>
      </div>
      {s.note && <p className="hist-note">{s.note}</p>}
      <div>
        {Object.entries(s.sets).map(([name, sets]) => {
          const pr = hits[name];
          return (
            <a key={name} className={"hist-line" + (pr ? " is-pr" : "")} href={href("lift", name)} style={{ color: "inherit", textDecoration: "none" }}>
              <span className="name">
                {pr && <span className="stamp pr-stamp">PR</span>}{name}
                {pr && <span className="pr-note">New best est. max {num(pr.now)} lb · was {num(pr.was)}</span>}
              </span>
              <span className="sets">
                {all ? sets.map((x, i) => (
                  <React.Fragment key={i}>{i > 0 && "  "}<span className={i === pr?.idx ? "pr-set" : undefined}>{fmtSet(x)}</span></React.Fragment>
                )) : <TopSet sets={sets} pr={pr} />}
              </span>
            </a>
          );
        })}
      </div>
      <button className="btn-quiet hist-more" onClick={() => setAll(!all)} aria-expanded={all}>{all ? "Show top sets" : "Show all sets"}</button>
    </article>
  );
}

function TopSet({ sets, pr }) {
  const top = (pr && sets[pr.idx]) || bestSet(sets) || sets[0];
  return (
    <>
      <span className={"top-set" + (pr && sets[pr.idx] ? " pr-set" : "")}>{fmtSet(top)}</span>
      {sets.length > 1 && <span className="set-count">{plural(sets.length, "set")}</span>}
    </>
  );
}
