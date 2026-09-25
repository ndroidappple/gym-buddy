import React, { useMemo, useState } from "react";
import { InfoButton } from "../components/ui.jsx";
import { Pencil } from "lucide-react";
import { DAYS, CUSTOM } from "../data/program.js";
import { href } from "../lib/router.js";
import { fmtSet, byDateDesc, longDate, fmtW, compact, sessionVolume, sessionSetCount, plural, priorSessions, allTimeBest, bestE1rm, e1rm, num } from "../lib/util.js";

export default function History({ sessions, program }) {
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
    <main className="screen has-tabs">
      <header className="top"><h1 className="page-title">History</h1><span className="spacer" /><span className="mono small muted">{sessions.length} sessions</span><InfoButton screen="history" /></header>
      <div className="body">
        <div className="filters" role="group" aria-label="Filter by day">
          <button className="chip" aria-pressed={!filter} onClick={() => setFilter(null)}>All</button>
          {[...DAYS, CUSTOM].filter((d) => !program[d].off || sessions.some((x) => x.day === d)).filter((d) => d !== CUSTOM || sessions.some((x) => x.day === d)).map((d) => (
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
                  {program[s.day].name} · {plural(sessionSetCount(s), "set")} · {compact(sessionVolume(s))} lb lifted{s.bw != null && ` · ${s.bw} lb bodyweight`}
                </div>
              </div>
              {Object.keys(prs[s.id]).length > 0 && <span className="stamp">PR{Object.keys(prs[s.id]).length > 1 ? ` ×${Object.keys(prs[s.id]).length}` : ""}</span>}
              <a className="icon-btn" href={href("session", s.day, s.id)} aria-label={`Edit ${program[s.day].name} session on ${longDate(s.date)}`}><Pencil size={17} /></a>
            </div>
            {s.note && <p className="hist-note">{s.note}</p>}
            <div>
              {Object.entries(s.sets).map(([n, sets]) => {
                const pr = prs[s.id][n];
                return (
                  <a key={n} className={"hist-line" + (pr ? " is-pr" : "")} href={href("lift", n)} style={{ color: "inherit", textDecoration: "none" }}>
                    <span className="name">
                      {pr && <span className="stamp pr-stamp">PR</span>}{n}
                      {pr && <span className="pr-note">New best est. max {num(pr.now)} lb · was {num(pr.was)}</span>}
                    </span>
                    <span className="sets">
                      {sets.map((x, i) => (
                        <React.Fragment key={i}>{i > 0 && "  "}<span className={i === pr?.idx ? "pr-set" : undefined}>{fmtSet(x)}</span></React.Fragment>
                      ))}
                    </span>
                  </a>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
