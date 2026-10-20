import React, { useMemo, useRef, useState } from "react";
import { Scale, CalendarDays, List } from "lucide-react";
import { isCardio, activeDays } from "../data/program.js";
import { href } from "../lib/router.js";
import { liftSeries, trend, num, fmtW, bestSet, isIsolation, shortDate, bodyweightSeries, daysBetween, today } from "../lib/util.js";
import { InfoButton, Sparkline, Trend, EmptyState, Sheet, useScrub, ChartTip } from "../components/ui.jsx";
import PhaseCard from "../components/PhaseCard.jsx";
import { adjustedSeries } from "../lib/fatigue.js";
import PhaseSheet from "../components/PhaseSheet.jsx";
import Workouts from "./Workouts.jsx";
import { ReviewList, PastReviewsSheet, useReviews } from "../components/WeekReviewIntro.jsx";
import { reducedMotion } from "../lib/motion.js";

/* A lift is "on a PR" when its latest session beat every earlier one (not its first) in the last two weeks.
   Only PRs from the most recent workout glow; older ones keep a still stamp, so the glow stays news. */
const PR_DAYS = 14;
/* The top card pages through bodyweight, then the FEATURED lifts trained most in the last FEATURE_DAYS. */
const FEATURED = 3, FEATURE_DAYS = 56;

/* Progress has two views: Trends (is it working?) and Workouts (what did I do?, formerly the
   History tab). The view is in the URL (#/progress/trends, #/progress/workouts) so back from a lift or
   a session lands on the same view; a plain #/progress opens whichever was used last on this device. */
const SEG_KEY = "ironlog-progress-view"; // "trends" | "workouts"
const CAL_KEY = "ironlog-history-view"; // "list" | "calendar" (key kept from the History tab)
const readLocal = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

export default function Progress({ open, go, ...props }) {
  const { sessions } = props;
  const seg = open === "workouts" ? "workouts" : open === "trends" || open === "phase" ? "trends" : readLocal(SEG_KEY, "trends") === "workouts" ? "workouts" : "trends";
  const pick = (v) => { writeLocal(SEG_KEY, v); if (v !== seg) go(href("progress", v), { replace: true }); };
  const [calendar, setCalendar] = useState(() => readLocal(CAL_KEY, "list") === "calendar");
  const toggleCalendar = () => { writeLocal(CAL_KEY, calendar ? "list" : "calendar"); setCalendar(!calendar); };
  const workouts = seg === "workouts";

  return (
    <main className="screen has-tabs">
      <header className="top">
        <h1 className="page-title">Progress</h1>
        <span className="spacer" />
        {workouts && sessions.length > 0 && (
          <button className="icon-btn" data-help="calendar" onClick={toggleCalendar} aria-pressed={calendar}
            aria-label={calendar ? "Show as a list" : "Show as a calendar"}>
            {calendar ? <List size={20} strokeWidth={2.4} /> : <CalendarDays size={20} strokeWidth={2.4} />}
          </button>
        )}
        <InfoButton screen={workouts ? "workouts" : "progress"} />
      </header>
      <div className="body">
        <div className="segctl" data-help="views" role="group" aria-label="Progress view">
          <button aria-pressed={!workouts} onClick={() => pick("trends")}>Trends</button>
          <button aria-pressed={workouts} onClick={() => pick("workouts")}>Workouts{sessions.length > 0 && <span className="seg-count"> · {sessions.length}</span>}</button>
        </div>
        {workouts
          ? <Workouts sessions={sessions} program={props.program} calendar={calendar} />
          : <Trends {...props} openPhase={open === "phase"} onPhaseSheetClosed={() => open === "phase" && go(href("progress", "trends"), { replace: true })} />}
      </div>
    </main>
  );
}

/** The latest week in review; See all opens the rest. Hidden until there's one. */
function RecentReviews() {
  const rows = useReviews(2); // a second one means there's more to see
  const [all, setAll] = useState(false);
  if (!rows?.length) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="lbl">Week in review</h2>
        {rows.length > 1 && <button type="button" className="see-all" onClick={() => setAll(true)}>See all</button>}
      </div>
      <ReviewList rows={rows.slice(0, 1)} />
      {all && <PastReviewsSheet onClose={() => setAll(false)} />}
    </section>
  );
}

/** Trends: the bulk/cut phase, bodyweight, and every lift's est. max trend with PRs. */
function Trends({ sessions, program, weighins, prefs, setPref, notify, onWeighin, onProgramChange, openPhase, onPhaseSheetClosed }) {
  const [starting, setStartingRaw] = useState(!!openPhase && !prefs?.phase);
  // Opened from Settings (#/progress/phase): once the sheet closes, drop "phase" from the URL so
  // coming back here (e.g. from a lift) doesn't pop the sheet open again.
  const setStarting = (v) => { setStartingRaw(v); if (!v) onPhaseSheetClosed?.(); };
  const phase = prefs?.phase || null;
  const updatePhase = (patch) => setPref("phase", { ...phase, ...patch });
  // Ending files the phase (with its recap) under phaseHistory; Undo puts it back.
  const endPhase = (recap) => {
    const before = { phase, history: prefs.phaseHistory || [] };
    setPref("phaseHistory", [...before.history, { ...phase, endedAt: Date.now(), recap }]);
    setPref("phase", null);
    notify?.(recap ? "Phase complete" : "Phase ended", () => { setPref("phase", before.phase); setPref("phaseHistory", before.history); });
  };
  const groups = useMemo(() => {
    const latest = sessions.reduce((d, s) => (s.date > d ? s.date : d), "");
    const seen = new Set();
    const out = activeDays(program).map((d) => {
      const lifts = program[d].exercises.map((e) => e.n).filter((n) => !seen.has(n) && seen.add(n));
      return { day: d, name: program[d].name, lifts };
    });
    const other = new Set();
    sessions.forEach((s) => Object.keys(s.sets).forEach((n) => { if (!seen.has(n)) other.add(n); }));
    if (other.size) out.push({ day: null, name: "Off program", lifts: [...other].sort() });
    return out.map((g) => {
      const rows = g.lifts.filter((n) => !isCardio(n)).map((n) => {
        const series = liftSeries(sessions, n);
        // Trend and sparkline compare fresh-equivalent numbers, so a lift done late isn't read as a drop.
        const vals = adjustedSeries(sessions, n).map((x) => x.fresh);
        const last = series[series.length - 1];
        const pr = series.length > 1 && last.pr && daysBetween(last.date, today()) <= PR_DAYS;
        const top = isIsolation(n) && bestSet(series.flatMap((x) => x.sets));
        return { n, day: g.day, series, vals, best: series.length ? Math.max(...series.map((x) => x.orm)) : 0, top, pct: trend(vals), pr, fresh: pr && last.date === latest };
      });
      return { ...g, logged: rows.filter((r) => r.vals.length), unlogged: rows.filter((r) => !r.vals.length).map((r) => r.n) };
    });
  }, [sessions, program]);

  const all = groups.flatMap((g) => g.logged).filter((r) => r.pct != null);
  const up = all.filter((r) => r.pct >= 1).length;
  const bw = useMemo(() => bodyweightSeries(sessions, weighins), [sessions, weighins]);
  // The lifts you train most lately get a page each after bodyweight. Compounds first: they say more.
  const featured = useMemo(() => {
    const recent = (r) => r.series.filter((x) => daysBetween(x.date, today()) <= FEATURE_DAYS).length;
    return groups.flatMap((g) => g.logged).filter((r) => r.series.length > 1)
      .sort((a, b) => !b.top - !a.top || recent(b) - recent(a) || b.series.length - a.series.length)
      .slice(0, FEATURED);
  }, [groups]);
  const [weighing, setWeighing] = useState(false);

  return (
    <>
      {all.length > 0 && <p className="lbl trends-sum">{up} of {all.length} lifts moving up</p>}
      {/* The prompt to start one can be hidden for good; a phase you're in always shows. */}
      {(phase || !prefs?.phasePromptHidden) && <PhaseCard phase={phase} sessions={sessions} weighins={weighins} program={program}
        onStart={() => setStarting(true)} onHide={() => { setPref("phasePromptHidden", true); notify("Hidden. Start a bulk or cut anytime in Settings.", () => setPref("phasePromptHidden", false)); }} onLog={onWeighin} onUpdate={updatePhase} onEnd={endPhase} onProgramChange={onProgramChange} />}
      <ChartPager pages={[
        { key: "bw", label: "Bodyweight", el: <Bodyweight series={bw} phase={phase} onLog={() => setWeighing(true)} /> },
        ...featured.map((r) => ({ key: r.n, label: r.n, el: <LiftCard lift={r} /> })),
      ]} />
      <RecentReviews />
      {weighing && <WeighSheet last={bw[bw.length - 1]} onClose={() => setWeighing(false)} onSave={(v) => { onWeighin(today(), v); setWeighing(false); }} />}
      {starting && (
        <PhaseSheet lastWeight={bw[bw.length - 1]?.bw} onClose={() => setStarting(false)}
          onStart={(p) => {
            setPref("phase", p);
            // The phase starts from today's weight; log it so the chart and pace begin there.
            if (!weighins.some((w) => w.date === p.start && w.bw === p.startWeight)) onWeighin(p.start, p.startWeight);
            setStarting(false);
          }} />
      )}

      {sessions.length === 0 && (
        <EmptyState coach="wings" title="Your lifts will show up here" action="Start your first workout" href="#/today">
          After your first workout, each lift gets a trend line and a PR marker. Two workouts in, you'll see which lifts are moving up.
        </EmptyState>
      )}

      {sessions.length > 0 && groups.map((g) => (g.logged.length || g.unlogged.length) ? (
        <section key={g.name} className="section" data-day={g.day || undefined}>
          <h2 className="lbl" style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="dot" aria-hidden="true" />{g.name}</h2>
          <div className="card-list">
            {g.logged.map((r) => (
              // PRs from the latest workout get the animated gold rim (.pr-rim); with motion off it holds still.
              <a key={r.n} className={"lift-row" + (r.fresh ? " pr-rim" : "")} data-help={r.fresh || r.pr ? "pr" : "lift"} href={href("lift", r.n)}>
                <span className="name">{r.pr && <span className="stamp pr-stamp">PR</span>}{r.n}
                  <span className="sub detail">{r.top ? `Best ${fmtW(r.top.w)} × ${r.top.r}` : `Est. max ${num(r.best)} lb`} · {r.vals.length} session{r.vals.length > 1 ? "s" : ""}</span>
                </span>
                <Sparkline values={r.vals} />
                <Trend pct={r.pct} help="trend" />
              </a>
            ))}
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
    </>
  );
}

/* Weigh-ins and session bodyweight together. The card is a way in, not a verdict: the change is shown, never colored. */
function Bodyweight({ series, phase, onLog }) {
  // During a phase the phase card above has its own weigh-in field.
  if (phase) return <PhaseChart series={series} phase={phase} />;
  if (series.length < 2) {
    return (
      <div className="card bw-empty">
        <span className="weigh-icon" aria-hidden="true"><Scale size={22} /></span>
        <span className="small" style={{ fontWeight: 600, flex: 1 }}>
          {series.length ? `${num(series[0].bw)} lb logged. One more weigh-in and your chart starts.` : "Log your bodyweight to start the chart."}
        </span>
        <button type="button" className="btn btn-ghost bw-log" onClick={onLog}>Log</button>
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
        <button type="button" className="pill bw-log-pill" onClick={onLog} aria-label="Log a weigh-in">+ Log</button>
      </div>
      <BwScrub W={W} H={H} pts={pts} tip={(i) => {
        const d = i > 0 ? series[i].bw - series[i - 1].bw : null;
        return <><b>{num(series[i].bw)} lb</b><span>{shortDate(series[i].date)}{d != null && ` · ${Math.abs(d) < 0.05 ? "±0" : `${d > 0 ? "▲" : "▼"} ${num(Math.abs(d))}`}`}</span></>;
      }}>
        <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {pts.slice(0, -1).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" fill="var(--accent)" stroke="#FFFFFF" strokeWidth="2.5" />)}
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="7" fill="#FFFFFF" />
      </BwScrub>
      <div className="ends"><span style={{ flex: 1 }}>{shortDate(first.date)}</span><span>{shortDate(last.date)}</span></div>
    </section>
  );
}

/* The bodyweight line in its card, readable by press-and-hold. pts are [x, y] in the viewBox. */
function BwScrub({ W, H, pts, tip, children }) {
  const [i, bind] = useScrub(pts.map((p) => p[0]), W);
  const on = i != null ? pts[i] : null;
  return (
    <div className="scrub" {...bind}>
      {on && <ChartTip x={on[0]} y={on[1]} W={W} H={H}>{tip(i)}</ChartTip>}
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {on && <line x1={on[0]} x2={on[0]} y1={0} y2={H} stroke="currentColor" strokeOpacity=".45" strokeWidth="1.5" strokeDasharray="3 4" />}
        {children}
        {on && <circle cx={on[0]} cy={on[1]} r="8" fill="currentColor" stroke="var(--lip)" strokeWidth="3" />}
      </svg>
    </div>
  );
}

/* The top card's pages side by side: swipe across, or tap a dot. Always opens on the first (bodyweight).
   A hold on a chart still reads it (useScrub stops the swipe once the hold picks up). */
function ChartPager({ pages }) {
  const track = useRef(null);
  const [at, setAt] = useState(0);
  if (pages.length < 2) return pages[0].el;
  const step = () => { const t = track.current; return t.children[1].offsetLeft - t.children[0].offsetLeft; };
  const onScroll = () => { const i = Math.round(track.current.scrollLeft / step()); if (i !== at) setAt(i); };
  const show = (i) => track.current.scrollTo({ left: i * step(), behavior: reducedMotion() ? "auto" : "smooth" });
  return (
    <div className="pager" data-help="charts">
      <div className="pager-track" ref={track} onScroll={onScroll}>
        {pages.map((p) => <div key={p.key} className="pager-page">{p.el}</div>)}
      </div>
      <div className="pager-dots">
        {pages.map((p, i) => (
          <button key={p.key} type="button" aria-current={i === at} aria-label={`Show ${p.label}`} onClick={() => show(i)} />
        ))}
      </div>
    </div>
  );
}

/* One lift's est. max, session by session, in its day's color. Details opens its full chart. */
const LIFT_POINTS = 12;
function LiftCard({ lift }) {
  const { n, day, best, top, pct } = lift;
  const series = lift.series.slice(-LIFT_POINTS);
  const first = series[0], last = series[series.length - 1];
  const vals = series.map((x) => x.orm);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const W = 326, H = 86;
  const pts = series.map((x, i) => [4 + (i / (series.length - 1)) * (W - 10), 8 + (1 - (x.orm - lo) / span) * (H - 16)]);
  const change = pct == null ? "Baseline" : Math.abs(pct) < 1 ? `— ${Math.abs(pct).toFixed(1)}%` : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`;
  const headline = top ? `best set ${fmtW(top.w)} × ${top.r}` : `best est. max ${num(best)} pounds`;
  return (
    <section className="bw-card lift-card" data-day={day || undefined} aria-label={`${n}: ${headline}. Trend ${change}.`}>
      <div className="top-row">
        <div className="lift-card-head">
          <span className="lbl">{n}</span>
          <span className="big">{top ? `${fmtW(top.w)} × ${top.r}` : <>{num(best)} <small>lb</small></>}</span>
        </div>
        <span className="pill">{change}</span>
        <a className="pill bw-log-pill" href={href("lift", n)} aria-label={`Open ${n}`}>Details</a>
      </div>
      <BwScrub W={W} H={H} pts={pts} tip={(i) => {
        const d = i > 0 ? series[i].orm - series[i - 1].orm : null;
        return <><b>{num(series[i].orm)} lb est. max</b><span>{shortDate(series[i].date)}{d != null && ` · ${Math.abs(d) < 0.5 ? "±0" : `${d > 0 ? "▲" : "▼"} ${num(Math.abs(d))}`}`}</span></>;
      }}>
        <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {pts.slice(0, -1).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" fill="var(--card-bg)" stroke="currentColor" strokeWidth="2.5" />)}
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="7" fill="currentColor" />
      </BwScrub>
      <div className="ends"><span style={{ flex: 1 }}>{shortDate(first.date)}</span><span>{shortDate(last.date)}</span></div>
    </section>
  );
}

/** Log today's bodyweight from Progress, any day (Today only nudges weekly). */
function WeighSheet({ last, onSave, onClose }) {
  const [v, setV] = useState("");
  const n = parseFloat(v);
  const ok = n > 50 && n < 800;
  return (
    <Sheet title="Log a weigh-in" sub={last ? `Last: ${num(last.bw)} lb on ${shortDate(last.date)}. Same day replaces it.` : "Today's bodyweight in lb."} onClose={onClose} labelledBy="weigh-sheet-title" className="keep-sub">
      <form className="rename-form" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(Math.round(n * 10) / 10); }}>
        <input className="input" type="number" inputMode="decimal" step="0.1" value={v} placeholder={last ? num(last.bw) : "lb"}
          aria-label="Bodyweight in pounds" onChange={(e) => setV(e.target.value)} />
        <button type="submit" className="btn btn-ink" disabled={!ok}>Save</button>
      </form>
    </Sheet>
  );
}

/* During a bulk or cut the chart runs on dates across the whole phase: weigh-ins as dots, and a
   dashed line from the start weight to the target so "on pace" is something you can see. */
function PhaseChart({ series, phase }) {
  const from = !series[0] || phase.start < series[0].date ? phase.start : series[0].date;
  const to = phase.end;
  const pts = series.filter((x) => x.date >= from && x.date <= to);
  const last = pts[pts.length - 1] || { bw: phase.startWeight, date: phase.start };
  const vals = [...pts.map((x) => x.bw), phase.startWeight, phase.target];
  const lo = Math.min(...vals) - 0.5, hi = Math.max(...vals) + 0.5, span = hi - lo || 1;
  const W = 326, H = 96, total = Math.max(1, daysBetween(from, to));
  const X = (d) => 6 + (daysBetween(from, d) / total) * (W - 14);
  const Y = (bw) => 8 + (1 - (bw - lo) / span) * (H - 16);
  return (
    <section className="bw-card" aria-label={`Bodyweight ${num(last.bw)} pounds. Target ${num(phase.target)} by ${shortDate(phase.end)}.`}>
      <div className="top-row">
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <span className="lbl">Bodyweight</span>
          <span className="big">{num(last.bw)} <small>lb</small></span>
        </div>
        <span className="pill">Target {num(phase.target)}</span>
      </div>
      <BwScrub W={W} H={H} pts={pts.map((x) => [X(x.date), Y(x.bw)])} tip={(i) => {
        const d = pts[i].date, pace = phase.startWeight + (phase.target - phase.startWeight) * (daysBetween(phase.start, d) / Math.max(1, daysBetween(phase.start, phase.end)));
        return <><b>{num(pts[i].bw)} lb</b><span>{shortDate(d)} · pace {num(Math.round(pace * 10) / 10)}</span></>;
      }}>
        <line x1={X(phase.start)} y1={Y(phase.startWeight)} x2={X(phase.end)} y2={Y(phase.target)} stroke="#FFFFFF" strokeOpacity=".55" strokeWidth="2.5" strokeDasharray="5 6" strokeLinecap="round" />
        <circle cx={X(phase.end)} cy={Y(phase.target)} r="5" fill="none" stroke="#FFFFFF" strokeWidth="2.5" />
        {pts.length > 1 && <polyline points={pts.map((x) => `${X(x.date)},${Y(x.bw)}`).join(" ")} fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
        {pts.map((x, i) => <circle key={x.date} cx={X(x.date)} cy={Y(x.bw)} r={i === pts.length - 1 ? 7 : 4} fill={i === pts.length - 1 ? "#FFFFFF" : "var(--accent)"} stroke="#FFFFFF" strokeWidth="2.5" />)}
      </BwScrub>
      <div className="ends"><span style={{ flex: 1 }}>{shortDate(from)}</span><span>Target {shortDate(to)}</span></div>
    </section>
  );
}
