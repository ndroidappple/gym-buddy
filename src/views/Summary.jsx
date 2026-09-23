import React, { useMemo, useState } from "react";
import { href } from "../lib/router.js";
import { priorSessions, allTimeBest, bestSet, bestE1rm, e1rm, fmtW, num, compact, shortDate, plural, sessionVolume, sessionSetCount, byDateDesc, nextDayAfter } from "../lib/util.js";

export default function Summary({ session, sessions, program, go, onUpdate }) {
  const [note, setNote] = useState(session.note || "");
  const p = program[session.day];

  const r = useMemo(() => {
    const prior = priorSessions(sessions, session).sort(byDateDesc);
    const lastSame = prior.find((s) => s.day === session.day);
    const rows = Object.entries(session.sets).map(([n, sets]) => {
      const best = bestSet(sets);
      const score = bestE1rm(sets);
      const allTime = allTimeBest(prior, n);
      const lastS = prior.find((s) => s.sets[n]?.length);
      const lastScore = lastS ? bestE1rm(lastS.sets[n]) : 0;
      return { n, best, score, allTime, lastScore, pct: allTime ? ((score - allTime) / allTime) * 100 : null, vsLast: lastScore ? ((score - lastScore) / lastScore) * 100 : null };
    });
    return {
      vol: sessionVolume(session),
      lastVol: lastSame ? sessionVolume(lastSame) : null,
      sets: sessionSetCount(session),
      records: rows.filter((x) => x.allTime && x.score > x.allTime + 0.05),
      beat: rows.filter((x) => !(x.allTime && x.score > x.allTime + 0.05) && x.lastScore && x.score >= x.lastScore),
      below: rows.filter((x) => x.lastScore && x.score < x.lastScore),
      baseline: rows.filter((x) => !x.lastScore),
      prevRecords: lastSame ? countRecords(sessions, lastSame) : null,
    };
  }, [session, sessions]);

  const mins = session.startedAt && session.finishedAt ? Math.max(1, Math.round((session.finishedAt - session.startedAt) / 60000)) : null;
  const volPct = r.lastVol ? ((r.vol - r.lastVol) / r.lastVol) * 100 : null;
  const next = program[nextDayAfter(sessions)];
  const saveNote = () => { if ((session.note || "") !== note.trim()) onUpdate({ ...session, note: note.trim() || null }); };
  const done = () => { saveNote(); go("#/today", { replace: true }); };

  return (
    <main className="screen" data-day={session.day}>
      <div className="body" style={{ paddingTop: "calc(24px + var(--safe-t))" }}>
        <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="chip" data-day={session.day}><span className="dot" aria-hidden="true" />{p.name} · {shortDate(session.date)}</span>
            <span className="spacer" />
            {mins && <span className="mono small muted">{mins} min</span>}
          </div>
          <h1 className="big-title">Session<br />logged</h1>
        </header>

        <div className="stats">
          <div className="stat"><b>{compact(r.vol)}</b><span>lb volume</span>{volPct != null && <Delta pct={volPct} />}</div>
          <div className="stat"><b>{r.sets}</b><span>sets</span><span className="trend flat">{plural(Object.keys(session.sets).length, "lift")}</span></div>
          <div className="stat"><b>{r.records.length}</b><span>PRs</span>{r.prevRecords != null && <span className="trend flat">{r.prevRecords} last time</span>}</div>
        </div>

        {r.records.length > 0 && (
          <Group title="Records">
            {r.records.map((x) => (
              <a key={x.n} className="rec" href={href("lift", x.n)} style={{ color: "inherit", textDecoration: "none" }}>
                <span className="stamp hit">PR</span>
                <span><span className="n">{x.n}</span><br /><span className="m">e1RM {num(x.score)} · ▲ {x.pct.toFixed(1)}%</span></span>
                <span className="v">{fmtW(x.best.w)} × {x.best.r}</span>
              </a>
            ))}
          </Group>
        )}
        {r.beat.length > 0 && <Group title="Beat last time">{r.beat.map((x) => <Plain key={x.n} x={x} mark={x.vsLast > 0.05 ? `▲ ${x.vsLast.toFixed(1)}%` : "— matched"} />)}</Group>}
        {r.below.length > 0 && <Group title="Below last time">{r.below.map((x) => <Plain key={x.n} x={x} mark={`▼ ${Math.abs(x.vsLast).toFixed(1)}%`} />)}</Group>}
        {r.baseline.length > 0 && <Group title="New baselines">{r.baseline.map((x) => <Plain key={x.n} x={x} mark="first log" />)}</Group>}

        <label className="field">
          <span className="lbl">Note</span>
          <textarea id="summary-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote}
            placeholder="How did it feel? Anything to change next time?" />
        </label>

        <button className="btn btn-day" onClick={done}>Done · {next.name} is next</button>
      </div>
    </main>
  );
}

function countRecords(sessions, s) {
  const prior = priorSessions(sessions, s);
  return Object.entries(s.sets).filter(([n, sets]) => {
    const at = allTimeBest(prior, n);
    return at && bestE1rm(sets) > at + 0.05;
  }).length;
}

function Delta({ pct }) {
  if (Math.abs(pct) < 0.5) return <span className="trend flat">— even</span>;
  return <span className={"trend" + (pct < 0 ? " flat" : "")}>{pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%</span>;
}

function Group({ title, children }) {
  return <section className="section"><h2 className="lbl">{title}</h2><div>{children}</div></section>;
}

function Plain({ x, mark }) {
  return (
    <a className="rec plain" href={href("lift", x.n)} style={{ color: "inherit", textDecoration: "none" }}>
      <span><span className="n">{x.n}</span><br /><span className="m">{fmtW(x.best.w)} × {x.best.r} · e1RM {num(e1rm(x.best.w, x.best.r))}</span></span>
      <span className="trend flat">{mark}</span>
    </a>
  );
}
