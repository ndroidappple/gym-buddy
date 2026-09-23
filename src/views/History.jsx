import React, { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { DAYS } from "../data/program.js";
import { href } from "../lib/router.js";
import { byDateDesc, longDate, fmtW, compact, sessionVolume, sessionSetCount, plural, priorSessions, allTimeBest, bestE1rm } from "../lib/util.js";

export default function History({ sessions, program }) {
  const [filter, setFilter] = useState(null);
  const sorted = useMemo(() => [...sessions].sort(byDateDesc), [sessions]);
  const shown = filter ? sorted.filter((s) => s.day === filter) : sorted;

  const prCount = useMemo(() => {
    const m = {};
    sessions.forEach((s) => {
      const prior = priorSessions(sessions, s);
      m[s.id] = Object.entries(s.sets).filter(([n, sets]) => { const at = allTimeBest(prior, n); return at && bestE1rm(sets) > at + 0.05; }).length;
    });
    return m;
  }, [sessions]);

  return (
    <main className="screen has-tabs">
      <header className="top"><h1 className="page-title">History</h1><span className="spacer" /><span className="mono small muted">{sessions.length} sessions</span></header>
      <div className="body">
        <div className="filters" role="group" aria-label="Filter by day">
          <button className="chip" aria-pressed={!filter} onClick={() => setFilter(null)}>All</button>
          {DAYS.map((d) => (
            <button key={d} className="chip" data-day={d} aria-pressed={filter === d} onClick={() => setFilter(filter === d ? null : d)}>
              <span className="dot" aria-hidden="true" />{program[d].name}
            </button>
          ))}
        </div>

        {shown.length === 0 && <p className="muted">No {filter ? program[filter].name : ""} sessions logged yet.</p>}

        {shown.map((s) => (
          <article key={s.id} className="hist" data-day={s.day}>
            <div className="hist-head">
              <div style={{ flex: 1 }}>
                <h2 className="hist-date">{longDate(s.date)}</h2>
                <div className="hist-meta">
                  {program[s.day].name} · {plural(sessionSetCount(s), "set")} · {compact(sessionVolume(s))} lb{s.bw != null && ` · ${s.bw} bw`}
                </div>
              </div>
              {prCount[s.id] > 0 && <span className="stamp">PR{prCount[s.id] > 1 ? ` ×${prCount[s.id]}` : ""}</span>}
              <a className="icon-btn" href={href("session", s.day, s.id)} aria-label={`Edit ${program[s.day].name} session on ${longDate(s.date)}`}><Pencil size={17} /></a>
            </div>
            {s.note && <p className="hist-note">{s.note}</p>}
            <div>
              {Object.entries(s.sets).map(([n, sets]) => (
                <a key={n} className="hist-line" href={href("lift", n)} style={{ color: "inherit", textDecoration: "none" }}>
                  <span className="name">{n}</span>
                  <span className="sets">{sets.map((x) => `${fmtW(x.w)}×${x.r}`).join("  ")}</span>
                </a>
              ))}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
