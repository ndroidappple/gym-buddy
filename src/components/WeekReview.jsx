import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, RefreshCw, Trophy, TrendingDown, ArrowUp } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import Coach from "./Coach.jsx";
import { LineChart } from "./ui.jsx";
import { COACHES, COACH_ORDER } from "../data/coaches.js";
import { useTheme } from "../lib/theme.js";
import { reducedMotion } from "../lib/motion.js";
import { cachedReview, loadReview, requestReview } from "../lib/reviews.js";
import { rangeLabel, MAX_GENERATIONS, WEEKDAYS } from "../lib/weekReview.js";
import { num, fmtW, shortDate } from "../lib/util.js";

/* The week in review, as full-screen story cards. Tap the right of the screen (or swipe left) for
   the next card, the left for the previous one; ✕, Escape or a swipe down closes it at any card.
   The numbers and charts come from the review's facts (worked out in code); the words from the
   coaches (the agent in api/review.js, or code when it couldn't be reached). */

const WAIT_LINES = [
  "Pulling up your workouts…",
  "Checking your food against your targets…",
  "Lining up this week against the last few…",
  "Looking for patterns in your numbers…",
  "Writing it up…",
];

/**
 * weekEnd: the week to show. current: it's the week Today is offering, so it can be written now and
 * updated when `fingerprint` (what the phone has logged) moves past the review's.
 */
export default function WeekReview({ weekEnd, current, fingerprint, head = "tank", onClose }) {
  const [review, setReview] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | writing | ready | error
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);
  const [tried, setTried] = useState(null); // the fingerprint an update was last asked for
  const [idx, setIdx] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const write = useCallback(async (refresh = false) => {
    if (refresh) { setUpdating(true); setTried(fingerprint); } else setStatus("writing");
    try {
      const r = await requestReview(weekEnd, { refresh });
      if (!alive.current) return;
      setReview(r); setStatus("ready");
      if (refresh) setIdx(0);
    } catch (e) {
      if (!alive.current) return;
      if (refresh) setUpdating(false);
      else { setError(e.message); setStatus("error"); }
    } finally {
      if (alive.current) setUpdating(false);
    }
  }, [weekEnd, fingerprint]);

  // The phone's copy first (instant), then the account's; written now if neither has it.
  useEffect(() => {
    let done = false;
    (async () => {
      const mine = await cachedReview(weekEnd).catch(() => null);
      if (mine && alive.current) { setReview(mine); setStatus("ready"); done = true; }
      const saved = await loadReview(weekEnd).catch(() => null);
      if (!alive.current) return;
      if (saved) { setReview(saved); setStatus("ready"); return; }
      if (done) return;
      if (current) write();
      else { setError("This week's review isn't saved."); setStatus("error"); }
    })();
  }, [weekEnd, current, write]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const cards = useMemo(() => (review ? deck(review) : []), [review]);
  const last = cards.length - 1;
  const go = useCallback((d) => setIdx((i) => Math.max(0, Math.min(last, i + d))), [last]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [go, onClose]);

  // Swipes: left/right move between cards, down closes. A tap is handled by onClick.
  const touch = useRef(null);
  const onTouchStart = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    const s = touch.current; touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.4) onClose();
    else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
  };
  const onStageClick = (e) => {
    if (e.target.closest("button, a, .chart")) return;
    const r = e.currentTarget.getBoundingClientRect();
    go(e.clientX - r.left < r.width * 0.3 ? -1 : 1);
  };

  // Something logged since it was written: offer to update (once per change, while updates are left).
  const canUpdate = current && review && review.fingerprint !== fingerprint && tried !== fingerprint && (review.gens || 1) < MAX_GENERATIONS;
  const card = cards[idx];
  const coach = card?.coach || head;
  const range = rangeLabel(weekEnd);

  return createPortal((
    <div className="review" role="dialog" aria-modal="true" aria-label={`Week in review, ${range}`}
      style={{ "--c": COACHES[coach].color }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="review-glow" aria-hidden="true" />
      <header className="review-top">
        {cards.length > 0 && (
          <div className="review-bars" aria-hidden="true">
            {cards.map((c, i) => <span key={c.id} className={i < idx ? "done" : i === idx ? "on" : ""} />)}
          </div>
        )}
        <div className="review-head">
          <span className="review-title">Week in review<span> · {range}</span></span>
          <button type="button" className="icon-btn review-close" onClick={onClose} aria-label="Close week in review"><X size={22} strokeWidth={2.6} /></button>
        </div>
      </header>

      {status === "ready" && card ? (
        <>
          <div className="review-stage" onClick={onStageClick}>
            <section key={card.id} className="review-card" aria-roledescription="card" aria-label={`${idx + 1} of ${cards.length}: ${card.label}`}>
              <card.Body review={review} canUpdate={canUpdate} updating={updating} onUpdate={() => write(true)} />
            </section>
          </div>
          <footer className="review-foot">
            <button type="button" className="icon-btn review-nav" onClick={() => go(-1)} disabled={idx === 0} aria-label="Previous card"><ChevronLeft size={22} strokeWidth={2.6} /></button>
            {idx < last
              ? <span className="review-count" aria-live="polite">{idx + 1} / {cards.length}</span>
              : <button type="button" className="btn btn-ink review-done" onClick={onClose}>Done</button>}
            <button type="button" className="icon-btn review-nav" onClick={() => go(1)} disabled={idx === last} aria-label="Next card"><ChevronRight size={22} strokeWidth={2.6} /></button>
          </footer>
        </>
      ) : status === "error" ? (
        <div className="review-wait">
          <Coach id={head} mood="encourage" size={96} />
          <p className="review-wait-line">{error}</p>
          {current && <button type="button" className="btn btn-ink" onClick={() => write()}>Try again</button>}
          <button type="button" className="btn-quiet" onClick={onClose}>Close</button>
        </div>
      ) : (
        <Writing writing={status === "writing"} />
      )}
    </div>
  ), document.body);
}

/** While the coaches write: the crew, an orb, and what they're doing. */
function Writing({ writing }) {
  const theme = useTheme();
  const [line, setLine] = useState(0);
  useEffect(() => {
    if (!writing || reducedMotion()) return;
    const id = setInterval(() => setLine((l) => Math.min(WAIT_LINES.length - 1, l + 1)), 3200);
    return () => clearInterval(id);
  }, [writing]);
  return (
    <div className="review-wait" role="status">
      <div className="review-crew">{COACH_ORDER.map((id, i) => <span key={id} className="coach-chip" style={{ "--i": i }}><Coach id={id} size={44} still badge decorative /></span>)}</div>
      <ThinkingOrb state="breathing" size={32} theme={theme} aria-hidden="true" />
      {writing ? (
        <>
          <p className="review-wait-line" key={line}>{WAIT_LINES[line]}</p>
          <p className="review-wait-sub">Takes about half a minute. You can close this: it keeps writing and will be here when you're back.</p>
        </>
      ) : <p className="review-wait-line">Opening your week…</p>}
    </div>
  );
}

/* ── The cards ── */

/** Which cards this review has, in order. Cards with nothing to say are left out. */
function deck(review) {
  const { facts: f, story: s } = review;
  const h = f.head || "tank"; // reviews written before head coaches were picked have none: Tank led those
  return [
    { id: "cover", label: "Your week", coach: h, Body: Cover },
    { id: "training", label: "Training", coach: s.training?.coach || h, Body: Training },
    f.nutrition && s.nutrition && { id: "nutrition", label: "Nutrition", coach: s.nutrition.coach, Body: Nutrition },
    f.body && s.body && { id: "body", label: "Bodyweight", coach: s.body.coach, Body: Body },
    { id: "highlow", label: "High and low", coach: s.high?.coach || h, Body: HighLow },
    s.trends?.length > 0 && f.history >= 2 && { id: "trends", label: "Trends", coach: s.trends[0].coach, Body: Trends },
    s.insights?.length > 0 && { id: "insights", label: "Coach's notes", coach: s.insights[0].coach, Body: Insights },
    { id: "focus", label: "Next week", coach: s.focus?.[0]?.coach || h, Body: Focus },
  ].filter(Boolean);
}

/** A coach saying something: their badge, then the words. */
function Says({ note, small }) {
  if (!note) return null;
  const c = COACHES[note.coach] || COACHES.tank;
  return (
    <div className={"rv-says" + (small ? " small" : "")} style={{ "--c": c.color }}>
      <span className="coach-chip"><Coach id={note.coach} size={small ? 30 : 36} still badge decorative /></span>
      <div className="rv-bubble">
        <span className="rv-who">{c.name}</span>
        {note.title && <b>{note.title}</b>}
        <p>{note.body}</p>
        {note.evidence && <p className="rv-evidence">{note.evidence}</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="rv-stat">
      <span className="rv-stat-v">{value}</span>
      <span className="rv-stat-l">{label}</span>
      {sub && <span className="rv-stat-s">{sub}</span>}
    </div>
  );
}

const signed = (x, unit = "") => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${num(Math.abs(x))}${unit}`;
const delta = (now, before) => (before ? `${now >= before ? "▲" : "▼"} ${Math.abs(Math.round(((now - before) / before) * 100))}% vs last week` : null);
/* The training goal is days a week, so weeks count days trained: a second workout on a day adds
   nothing. Reviews saved before facts had `days` count them from the sessions. */
const trainedDays = (t) => t.days ?? new Set(t.sessions.map((x) => x.date)).size;
const dayLetter = (d) => WEEKDAYS[new Date(d + "T12:00:00").getDay()][0];

function Cover({ review, canUpdate, updating, onUpdate }) {
  const { facts: f, story: s } = review;
  const t = f.training, n = f.nutrition, b = f.body;
  return (
    <div className="rv-body rv-cover">
      <div className="coach-stack rv-crew-small">{COACH_ORDER.slice(0, 4).map((id) => <span key={id} className="coach-chip"><Coach id={id} size={30} still badge decorative /></span>)}</div>
      <h2 className="rv-headline">{s.headline}</h2>
      <p className="rv-lead">{s.summary}</p>
      <div className="rv-stats">
        <Stat label="training days" value={t.target ? `${trainedDays(t)}/${t.target}` : trainedDays(t)} sub={t.streak >= 2 ? `${t.streak} weeks on target` : null} />
        <Stat label="working sets" value={t.sets} sub={delta(t.sets, t.prevSets)} />
        {n && n.avgKcal != null && <Stat label="kcal a day" value={n.avgKcal.toLocaleString()} sub={`target ${n.targets.kcal.toLocaleString()}`} />}
        {b && b.change != null ? <Stat label="lb vs last week" value={signed(b.change)} sub={`${num(b.weekAvg)} lb average`} />
          : n ? <Stat label="protein days" value={`${n.proteinHit}/7`} sub={`target ${n.targets.protein} g`} /> : null}
      </div>
      {canUpdate && (
        <button type="button" className="chip rv-update" onClick={onUpdate} disabled={updating}>
          <RefreshCw size={14} strokeWidth={2.6} aria-hidden="true" className={updating ? "spin" : ""} />{updating ? "Updating…" : "You've logged more since. Update"}
        </button>
      )}
      {review.source === "code" && <p className="rv-fine">Your coaches couldn't be reached, so this one is straight from your numbers.</p>}
    </div>
  );
}

function Training({ review }) {
  const { facts: f, story: s } = review;
  const t = f.training;
  const byDate = {};
  for (const x of t.sessions) (byDate[x.date] ||= []).push(x);
  const days = trainedDays(t);
  const max = Math.max(1, ...t.groups.map((g) => Math.max(g.sets, g.avg4 || 0)));
  const usual = t.groups.some((g) => g.avg4 != null);
  return (
    <div className="rv-body">
      <p className="rv-kicker">Training</p>
      <p className="rv-big">{days}<small>{t.target && days <= t.target ? ` of ${t.target} training days` : ` training day${days === 1 ? "" : "s"}${t.target ? ` · goal ${t.target}` : ""}`}</small></p>
      <div className="week rv-week">
        {f.dates.map((d) => {
          const xs = byDate[d] || [];
          const x = xs[0];
          return (
            <div key={d} className="wd" data-day={x?.day || undefined} aria-label={`${WEEKDAYS[new Date(d + "T12:00:00").getDay()]}: ${xs.length ? xs.map((s) => `${s.name}, ${s.sets} sets`).join("; ") : "rest"}`}>
              <i className={x ? "on" : ""} />{dayLetter(d)}
            </div>
          );
        })}
      </div>
      {t.groups.length > 0 && (
        <div className="rv-groups" role="list" aria-label="Working sets by area this week">
          <p className="rv-groups-head" aria-hidden="true"><span>Working sets by muscle group</span><span>sets</span></p>
          {t.groups.map((g) => (
            <div key={g.id} className="rv-group" role="listitem" style={{ "--c": COACHES[g.id].color }}
              aria-label={`${g.name}: ${g.sets} sets${g.avg4 != null ? `, usually ${Math.round(g.avg4)}` : ""}`}>
              <span className="rv-group-name">{g.name}</span>
              <span className="rv-group-track">
                <span className="rv-group-bar" style={{ width: `${(g.sets / max) * 100}%` }} />
                {g.avg4 != null && <span className="rv-group-tick" style={{ left: `${(g.avg4 / max) * 100}%` }} />}
              </span>
              <span className="rv-group-v">{g.sets}</span>
            </div>
          ))}
          <p className="rv-legend">
            <span><span className="rv-bar-key" aria-hidden="true" />this week</span>
            {usual && <span><span className="rv-tick-key" aria-hidden="true" />your usual week (4-week average)</span>}
          </p>
        </div>
      )}
      {t.prs.length > 0 && (
        <ul className="rv-prs">
          {t.prs.slice(0, 3).map((p) => <li key={p.lift}><span className="stamp pr-stamp">PR</span><span>{p.lift}</span><b>{p.set}</b></li>)}
        </ul>
      )}
      <Says note={s.training} />
    </div>
  );
}

function Nutrition({ review }) {
  const { facts: f, story: s } = review;
  const n = f.nutrition, tk = n.targets.kcal;
  const W = 300, H = 132, B = 18, top = 8;
  const max = Math.max(tk * 1.25, ...n.days.map((d) => d.kcal));
  const y = (v) => top + (1 - v / max) * (H - B - top);
  const bw = 26, gap = (W - bw * 7) / 7;
  return (
    <div className="rv-body">
      <p className="rv-kicker">Nutrition</p>
      <p className="rv-big">{n.avgKcal != null ? n.avgKcal.toLocaleString() : "—"}<small> kcal a day · target {tk.toLocaleString()}</small></p>
      <svg className="rv-kcal" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Calories each day: ${n.days.map((d) => `${WEEKDAYS[new Date(d.date + "T12:00:00").getDay()]} ${d.logged ? `${d.kcal} kcal, ${d.protein} g protein` : "not logged"}`).join("; ")}`}>
        {n.days.map((d, i) => {
          const x = gap / 2 + i * (bw + gap);
          const hit = d.logged && d.protein >= n.targets.protein * 0.9;
          return (
            <g key={d.date}>
              {d.logged
                ? <path d={bar(x, y(d.kcal), bw, H - B - y(d.kcal))} className="rv-kcal-bar" />
                : <rect x={x} y={H - B - 4} width={bw} height={4} rx={2} className="rv-kcal-none" />}
              <text x={x + bw / 2} y={H - 4} textAnchor="middle" className={"rv-axis" + (d.trained ? " strong" : "")}>{dayLetter(d.date)}</text>
              {d.logged && <circle cx={x + bw / 2} cy={y(d.kcal) - 7} r={3.5} className={hit ? "rv-dot hit" : "rv-dot"} />}
            </g>
          );
        })}
        <line x1={0} x2={W} y1={y(tk)} y2={y(tk)} className="rv-target" />
      </svg>
      <p className="rv-legend">
        <span><span className="rv-dot-key" aria-hidden="true" />protein target hit</span>
        <span><span className="rv-line-key" aria-hidden="true" />calorie target</span>
        <span><b>Bold</b> day: trained</span>
      </p>
      <div className="rv-stats three">
        <Stat label="days logged" value={`${n.logged}/7`} />
        <Stat label="g protein a day" value={n.avgProtein ?? "—"} sub={`target ${n.targets.protein}`} />
        {n.trainingDays.days > 0 && n.restDays.days > 0
          ? <Stat label="g protein, train / rest days" value={`${n.trainingDays.protein}/${n.restDays.protein}`} />
          : <Stat label="protein days" value={`${n.proteinHit}/7`} />}
      </div>
      <Says note={s.nutrition} />
    </div>
  );
}

/** A bar with 4px rounded top corners, sitting square on the baseline. */
function bar(x, y, w, h) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function Body({ review }) {
  const { facts: f, story: s } = review;
  const b = f.body;
  const points = b.points.map((p) => ({ value: p.bw, label: shortDate(p.date) }));
  return (
    <div className="rv-body">
      <p className="rv-kicker">Bodyweight</p>
      <p className="rv-big">{num(b.weekAvg ?? b.last.bw)}<small> lb{b.weekAvg != null ? " this week" : ` on ${shortDate(b.last.date)}`}{b.change != null ? ` · ${signed(b.change, " lb")}` : ""}</small></p>
      {points.length >= 2 && <div className="rv-chart"><LineChart points={points} format={(v) => num(v)} height={130} ariaLabel={`Bodyweight over the last 8 weeks, from ${num(points[0].value)} to ${num(points[points.length - 1].value)} lb`} /></div>}
      {b.phase && (
        <p className="rv-phase"><b>{b.phase.label}</b> · week {b.phase.week} of {b.phase.weeks} · aiming {signed(b.phase.rate, " lb")}/week
          {b.rate4 != null ? `, moving ${signed(b.rate4, " lb")}/week` : ""}</p>
      )}
      <Says note={s.body} />
    </div>
  );
}

function HighLow({ review }) {
  const { story: s } = review;
  return (
    <div className="rv-body">
      <div className="rv-hl high pr-rim">
        <p className="rv-kicker"><Trophy size={15} strokeWidth={2.6} aria-hidden="true" /> High point</p>
        <Says note={s.high} />
      </div>
      <div className="rv-hl low">
        <p className="rv-kicker"><TrendingDown size={15} strokeWidth={2.6} aria-hidden="true" /> Low point</p>
        <Says note={s.low} />
      </div>
    </div>
  );
}

function Trends({ review }) {
  const { facts: f, story: s } = review;
  const rows = [
    { label: "Working sets", values: f.weeks.map((w) => w.sets), fmt: (v) => v },
    f.nutrition && { label: "Protein, g/day", values: f.weeks.map((w) => w.avgProtein), fmt: (v) => v },
    f.body && { label: "Bodyweight, lb", values: f.weeks.map((w) => w.bw), fmt: (v) => num(v) },
  ].filter((r) => r && r.values.filter((v) => v != null && v !== 0).length >= 3);
  return (
    <div className="rv-body">
      <p className="rv-kicker">Trends · last 8 weeks</p>
      {rows.map((r) => <WeekBars key={r.label} {...r} />)}
      {s.trends.map((x, i) => <Says key={i} note={x} small />)}
    </div>
  );
}

/** Eight weekly values as columns, this week (the last) in the coach's colour. */
function WeekBars({ label, values, fmt }) {
  const vals = values.map((v) => (v == null ? null : +v));
  const known = vals.filter((v) => v != null);
  const lo = label.startsWith("Bodyweight") ? Math.min(...known) - 2 : 0, hi = Math.max(...known);
  const last = vals[vals.length - 1];
  return (
    <div className="rv-weeks" role="img" aria-label={`${label} by week: ${vals.map((v) => (v == null ? "none" : fmt(v))).join(", ")}`}>
      <div className="rv-weeks-head"><span>{label}</span><b>{last == null ? "—" : fmt(last)}</b></div>
      <div className="rv-weeks-cols" aria-hidden="true">
        {vals.map((v, i) => (
          <span key={i} className={"rv-col" + (i === vals.length - 1 ? " now" : "") + (v == null ? " none" : "")}
            style={{ height: v == null ? undefined : `${Math.max(8, ((v - lo) / (hi - lo || 1)) * 100)}%` }} />
        ))}
      </div>
    </div>
  );
}

function Insights({ review }) {
  return (
    <div className="rv-body">
      <p className="rv-kicker">Coach's notes</p>
      <h2 className="rv-title">What your numbers are saying</h2>
      {review.story.insights.map((x, i) => <Says key={i} note={x} />)}
    </div>
  );
}

function Focus({ review }) {
  const { facts: f, story: s } = review;
  const named = s.focus.map((x) => x.action).join(" ");
  const extra = f.training.ready.filter((r) => !named.includes(r.lift)).slice(0, 3);
  return (
    <div className="rv-body">
      <p className="rv-kicker">Next week</p>
      <h2 className="rv-title">Your focus</h2>
      <ol className="rv-focus">
        {s.focus.map((x, i) => (
          <li key={i} style={{ "--c": COACHES[x.coach]?.color }}>
            <span className="rv-focus-n" aria-hidden="true">{i + 1}</span>
            <span><b>{x.action}</b>{x.why && <span>{x.why}</span>}</span>
          </li>
        ))}
      </ol>
      {extra.length > 0 && (
        <div className="rv-ready">
          <p className="rv-kicker">Ready for more weight</p>
          <div className="rv-ready-chips">
            {extra.map((r) => <span key={r.lift} className="chip"><ArrowUp size={13} strokeWidth={3} aria-hidden="true" />{r.lift} · {fmtW(r.to)} lb</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
