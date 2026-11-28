import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { href } from "../lib/router.js";
import { shortDate, bodyweightSeries, iso, daysBetween, plural } from "../lib/util.js";
import { EmptyState, useScrub, ChartTip, Read } from "../components/ui.jsx";
import { alcoholTrend } from "../lib/wellness.js";
import { dailyRows, summarize, weekRows, patterns, outcome, topFoods, periodRange, targetsBackfilled, wrongSide, targetsOn, KCAL_BAND, PROTEIN_HIT } from "../lib/nutritionTrends.js";

/* Nutrition → Trends: how what the lifter ate compares with their targets over a period, and whether
   it's doing what the goal needs.

   The first view is a scorecard that fits on one screen: four equal tiles (calories, protein, the
   weight trend, how much was logged), each with its number, its goal, a small chart and one status,
   then a slim row for carbs and fat (and alcohol, when it's tracked). Every tile drills into a detail
   screen (#/nutrition/trends/<key>) with the full day-by-day chart and the breakdowns: where the eating
   differs, the foods that bring the most calories, week by week, the burn the scale implies.

   The rules (partial days, on target, protein hit) are lib/nutritionTrends.js's, the same as the week
   in review. Like the recap, only what's off (or clearly on) gets a pill; the rest is plain text in the
   same slot, so every tile keeps the same shape. */

const RANGES = [{ days: 14, label: "2 weeks" }, { days: 28, label: "4 weeks" }, { days: 84, label: "12 weeks" }];
const RANGE_KEY = "ironlog-nutrition-range";
// The scale moves a pound or two day to day: a weight trend over less than four weeks is mostly noise.
const OUTCOME_DAYS = 28;
const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
const signed = (n, unit = "") => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${fmt(Math.abs(n))}${unit}`;
const signed1 = (r) => (r == null ? "–" : `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(1)}`);
const lbWeek = (r) => (r == null ? "–" : `${signed1(r)} lb`);

/** The detail screens, by their key in the address. */
export const TREND_DETAILS = { calories: "Calories", protein: "Protein", weight: "Weight trend", logged: "Logging", macros: "Carbs & fat", alcohol: "Alcohol" };

/** The period (remembered on this device) and everything computed over it. */
function useTrends({ food, prefs, sessions, weighins, well }) {
  const n = prefs.nutrition;
  const entries = food?.entries || [];
  const [days, setDays] = useState(() => { try { return +localStorage.getItem(RANGE_KEY) || 28; } catch { return 28; } });
  const pick = (d) => { setDays(d); try { localStorage.setItem(RANGE_KEY, String(d)); } catch {} };

  const data = useMemo(() => {
    const { from, to } = periodRange(entries, days);
    if (from > to) return null;
    const rows = dailyRows(entries, n, from, to);
    const s = summarize(rows);
    if (!s.logged) return null;
    const outRows = days >= OUTCOME_DAYS ? rows : dailyRows(entries, n, periodRange(entries, OUTCOME_DAYS).from, to);
    const bw = bodyweightSeries(sessions, weighins);
    const outFrom = outRows[0].date;
    const t = targetsOn(n, to);
    const side = wrongSide(n, t);
    const kcalOff = s.kcalDiff != null && s.targetKcal ? s.kcalDiff / s.targetKcal : 0;
    return {
      from, to, rows, s, t, side, n,
      weeks: weekRows(rows), patterns: patterns(rows, sessions),
      out: outcome(outRows, bw, n), outFrom, weights: bw.filter((p) => p.date >= outFrom && p.date <= to),
      outcomeWider: days < OUTCOME_DAYS, top: topFoods(entries, rows),
      alcohol: well ? alcoholTrend(entries, rows) : null,
      backfilled: targetsBackfilled(n, from),
      kcalOff,
      kcalWrong: (side === "over" && kcalOff > KCAL_BAND) || (side === "under" && kcalOff < -KCAL_BAND) || (side === "both" && Math.abs(kcalOff) > KCAL_BAND),
    };
  }, [entries, n, days, sessions, weighins, well]);
  return { days, pick, data };
}

/* ── Verdicts: what each tile's status slot says. tone "good" / "watch" is a pill; null is plain text. ── */

function kcalVerdict(d) {
  const { s, kcalWrong, kcalOff } = d;
  if (s.kcalDiff == null) return { tone: null, text: "No full days yet" };
  if (kcalWrong) return { tone: "watch", text: `${fmt(Math.abs(s.kcalDiff))} ${s.kcalDiff < 0 ? "under" : "over"}` };
  if (Math.abs(kcalOff) <= KCAL_BAND) return { tone: "good", text: "On goal" };
  return { tone: null, text: `${s.kcalOn} of ${s.full} days on goal` };
}
function proteinVerdict({ s }) {
  if (!s.full) return { tone: null, text: "No full days yet" };
  const share = s.proteinHit / s.full;
  return { tone: share >= 0.8 ? "good" : share < 0.5 ? "watch" : null, text: `Hit ${s.proteinHit} of ${s.full} days` };
}
const onPace = ({ rate, goalRate }) => rate != null && goalRate != null &&
  (goalRate === 0 ? Math.abs(rate) <= 0.3 : Math.sign(rate) === Math.sign(goalRate) && Math.abs(rate) >= Math.abs(goalRate) * 0.6);
function weightVerdict({ out }) {
  if (out.rate == null) return { tone: null, text: "Needs 3+ weigh-ins" };
  if (out.goalRate == null) return { tone: null, text: "No goal pace set" };
  return onPace(out) ? { tone: "good", text: "On pace" } : { tone: "watch", text: "Off pace" };
}
function loggedVerdict({ s }) {
  const share = s.logged / s.days;
  if (share < 0.6) return { tone: "watch", text: "Gaps" };
  if (share >= 0.85) return { tone: "good", text: "Consistent" };
  return { tone: null, text: `${Math.round(share * 100)}% of days` };
}

function Status({ tone, text }) {
  return <span className="sc-status">{tone ? <Read tone={tone}>{text}</Read> : <span className="sc-plain">{text}</span>}</span>;
}

/* The period: a chip on the date line. */
function Period({ data, days, pick }) {
  return (
    <div className="section-head sc-period">
      <h2 className="lbl">{data ? `${shortDate(data.from)} – ${shortDate(data.to)}` : "Period"}</h2>
      <label className="range-pick">
        <span className="sr-only">Period</span>
        <select value={days} onChange={(e) => pick(+e.target.value)}>
          {RANGES.map((r) => <option key={r.days} value={r.days}>Last {r.label}</option>)}
        </select>
        <ChevronDown size={16} strokeWidth={2.8} aria-hidden="true" />
      </label>
    </div>
  );
}

const Empty = () => (
  <EmptyState title="Nothing logged yet" action="Log food" href={href("nutrition")}>
    Log a few days of food and this shows how your eating compares with your targets, day by day and week by week.
  </EmptyState>
);

/* ═══════════════ The scorecard ═══════════════ */

export default function NutritionTrends(props) {
  const { days, pick, data } = useTrends(props);
  if (!data) return <><Period data={null} days={days} pick={pick} /><Empty /></>;
  const { rows, s, t, side, out, n } = data;
  const last = data.weights[data.weights.length - 1];
  const kv = kcalVerdict(data), pv = proteinVerdict(data), wv = weightVerdict(data), lv = loggedVerdict(data);

  return (
    <>
      <section className="section">
        <Period data={data} days={days} pick={pick} />
        <div className="sc-grid">
          <Tile to="calories" label="Calories" value={fmt(s.kcal)} unit="kcal" sub={`a day · goal ${fmt(s.targetKcal ?? t?.kcal)}`} verdict={kv}>
            {(W) => <MiniBars W={W} rows={rows} value={(r) => r.kcal} goal={(r) => r.t?.kcal}
              wrong={(r) => r.full && (side === "both" ? r.kcalStatus !== "on" : r.kcalStatus === side)} />}
          </Tile>
          <Tile to="protein" label="Protein" value={fmt(s.protein)} unit="g" sub={`a day · goal ${fmt(s.targetProtein ?? t?.protein)}`} verdict={pv}>
            {(W) => <MiniBars W={W} rows={rows} value={(r) => r.protein} goal={(r) => r.t?.protein} wrong={(r) => r.full && !r.proteinHit} />}
          </Tile>
          {/* No trend yet (under 3 weigh-ins over 10+ days): the latest weight, so the tile still says something. */}
          <Tile to="weight" label="Weight" {...(out.rate != null || !last
            ? { value: signed1(out.rate), unit: "lb", sub: `a week${out.goalRate != null ? ` · goal ${signed1(out.goalRate)}` : ""}` }
            : { value: last.bw.toFixed(1), unit: "lb", sub: `latest · ${shortDate(last.date)}` })} verdict={wv}>
            {(W) => <WeightChart W={W} pts={data.weights} from={data.outFrom} to={data.to} goalRate={out.goalRate} />}
          </Tile>
          <Tile to="logged" label="Logged" value={s.logged} unit={`/${s.days}`} sub={`days${s.partial ? ` · ${s.partial} partly` : ""}`} verdict={lv}>
            {(W) => <LogStrip W={W} rows={rows} />}
          </Tile>
        </div>

        {s.full === 0 && (
          <p className="nt-note sc-why">Every day logged here is under 45% of your calorie goal, so it counts as partly logged and stays out of the averages. Averages start with your first full day.</p>
        )}
        {s.carbs != null && (
          <a className="card sc-row" href={href("nutrition", "trends", "macros")}
            aria-label={`Carbs and fat: carbs ${fmt(s.carbs)} of ${fmt(s.targetCarbs)} grams a day, fat ${fmt(s.fat)} of ${fmt(s.targetFat)}`}>
            <Macro name="Carbs" k="carbs" v={s.carbs} goal={s.targetCarbs} />
            <Macro name="Fat" k="fat" v={s.fat} goal={s.targetFat} />
            <ChevronRight size={18} strokeWidth={2.6} className="sc-chev" aria-hidden="true" />
          </a>
        )}
        {data.alcohol && (
          <a className="card sc-row" href={href("nutrition", "trends", "alcohol")}>
            <span className="sc-row-main"><b>Alcohol</b><span>{data.alcohol.perWeek} drinks a week{data.alcohol.share != null ? ` · ${data.alcohol.share}% of calories` : ""}</span></span>
            <ChevronRight size={18} strokeWidth={2.6} className="sc-chev" aria-hidden="true" />
          </a>
        )}
      </section>

      {data.backfilled && (n?.history?.[0]?.from || n?.setAt) && (
        <p className="nt-note">Targets from before {shortDate(n.history?.[0]?.from || iso(new Date(n.setAt)))} weren't kept, so earlier days are compared with the first targets on record.</p>
      )}
    </>
  );
}

/** The width of a box, kept up to date: the tile charts draw at their real width instead of a fixed
    150 that got centred, small, in wider tiles (T-04). */
function useBoxWidth(fallback) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.max(60, Math.round(el.getBoundingClientRect().width)) || fallback);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
}

/** One scorecard tile: label, number, its goal, a small chart, one status. Always the same five rows.
    `children` is a function of the chart's width. */
function Tile({ to, label, value, unit, sub, verdict, children }) {
  const [viz, W] = useBoxWidth(150);
  return (
    <a className="card sc-tile" href={href("nutrition", "trends", to)} aria-label={`${label}: ${value} ${unit} ${sub}. ${verdict.text}. Details`}>
      <span className="sc-top">{label}<ChevronRight size={16} strokeWidth={2.6} className="sc-chev" aria-hidden="true" /></span>
      <span className="sc-val"><b>{value}</b>{value !== "–" && <small>{unit}</small>}</span>
      <span className="sc-sub">{sub}</span>
      <span className="sc-viz" aria-hidden="true" ref={viz}>{children(W)}</span>
      <Status {...verdict} />
    </a>
  );
}

function Macro({ name, k, v, goal }) {
  const pct = goal ? Math.min(100, (v / goal) * 100) : 0;
  return (
    <span className="macro sc-macro" data-macro={k}>
      <span className="macro-top"><span>{name}</span><b>{fmt(v)}<small> / {fmt(goal)} g</small></b></span>
      <span className="macro-bar"><i style={{ width: `${pct}%` }} /></span>
    </span>
  );
}

/* ═══════════════ Small charts ═══════════════ */

/** Goal segments: one per run of days with the same target, so a change of targets steps the line. */
function goalSegs(rows, goal) {
  const segs = [];
  rows.forEach((r, k) => {
    const g = goal(r);
    if (g == null) return;
    const last = segs[segs.length - 1];
    if (last && last.g === g && last.to === k) last.to = k + 1; else segs.push({ g, from: k, to: k + 1 });
  });
  return segs;
}

/** A tile's day bars: no axis, no scrubbing; the goal as a dashed line. */
function MiniBars({ rows, value, goal, wrong, W = 150 }) {
  const H = 40;
  const max = Math.max(1, ...rows.map((r) => (r.logged ? value(r) : 0)), ...rows.map((r) => (goal(r) || 0) * 1.15));
  const y = (v) => 2 + (1 - v / max) * (H - 3);
  const step = W / rows.length, bw = Math.max(1.5, Math.min(8, step - 1.5));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sc-svg">
      <line className="nt-base" x1={0} x2={W} y1={H - 0.75} y2={H - 0.75} />
      {rows.map((r, k) => r.logged && value(r) > 0 && (
        <rect key={r.date} x={k * step + (step - bw) / 2} y={y(value(r))} width={bw} height={H - 1 - y(value(r))} rx={Math.min(2, bw / 2)}
          className={"nt-bar" + (r.partial ? " faint" : wrong(r) ? " watch" : "")} />
      ))}
      {goalSegs(rows, goal).map((s) => <line key={s.from} className="nt-goal sc-goal" x1={s.from * step} x2={s.to * step} y1={y(s.g)} y2={y(s.g)} />)}
    </svg>
  );
}

/** One tick a day: tall and solid when fully logged, tall and faint when partly, a dot when nothing. */
function LogStrip({ rows, H = 40, W = 150 }) {
  const step = W / rows.length, bw = Math.max(1.5, Math.min(8, step - 1.5));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sc-svg">
      {rows.map((r, k) => {
        const x = k * step + (step - bw) / 2;
        return r.logged
          ? <rect key={r.date} x={x} y={4} width={bw} height={H - 5} rx={Math.min(2, bw / 2)} className={"nt-bar" + (r.partial ? " faint" : "")} />
          : <rect key={r.date} x={x} y={H - 1 - bw} width={bw} height={bw} rx={bw / 2} className="nt-none" />;
      })}
    </svg>
  );
}

/** Weigh-ins over the window as a line, and the goal's pace from the first one as a dashed line.
    `big` adds the axis ends and hold-to-read. */
function WeightChart({ pts, from, to, goalRate, big = false, W: w = 150 }) {
  const W = big ? 326 : w, H = big ? 140 : 40, T = big ? 10 : 3, B = big ? 10 : 3;
  const span = Math.max(1, daysBetween(from, to));
  const x = (d) => (daysBetween(from, d) / span) * W;
  const first = pts[0];
  const goalEnd = first && goalRate != null ? first.bw + (goalRate / 7) * daysBetween(first.date, to) : null;
  const vals = [...pts.map((p) => p.bw), ...(goalEnd != null ? [goalEnd] : [])];
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(0.5, (hi - lo) * 0.15);
  const y = (v) => T + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - T - B);
  const xs = pts.map((p) => x(p.date));
  const [i, bind] = useScrub(xs, W);
  if (pts.length < 2) {
    return big
      ? <p className="nt-line">Weigh in a few times a week (on Progress, or the Today card) and your trend shows here.</p>
      : <span className="sc-empty">{pts.length ? "1 weigh-in" : "No weigh-ins"}</span>;
  }
  const on = big && i != null ? pts[i] : null;
  const svg = (
    <svg viewBox={`0 0 ${W} ${H}`} className={big ? undefined : "sc-svg"} aria-hidden="true">
      {goalEnd != null && <line className="nt-goal sc-goal" x1={x(first.date)} x2={W} y1={y(first.bw)} y2={y(goalEnd)} />}
      <polyline className="sc-line" points={pts.map((p) => `${x(p.date)},${y(p.bw)}`).join(" ")} />
      {pts.map((p, k) => <circle key={p.date} className={"sc-dot" + (on && k === i ? " on" : "")} cx={x(p.date)} cy={y(p.bw)} r={big ? 4 : 2} />)}
    </svg>
  );
  if (!big) return svg;
  return (
    <div className="card nt-chart">
      <div className="scrub" {...bind} role="img" aria-label={`Weigh-ins from ${shortDate(from)} to ${shortDate(to)}, against your goal's pace`}>
        {on && <ChartTip x={xs[i]} y={y(on.bw)} W={W} H={H}><b>{on.bw.toFixed(1)} lb</b><span>{shortDate(on.date)}</span></ChartTip>}
        {svg}
      </div>
      <div className="ends"><span style={{ flex: 1 }}>{shortDate(from)}</span><span>{shortDate(to)}</span></div>
    </div>
  );
}

/* One bar a day from zero, the goal as a line (it steps where the targets changed), and the band of
   ±`band` around it when there is one. Bars on the wrong side of the goal take the warning color;
   partly logged days are faint. Hold (or hover) to read a day. */
function DayBars({ rows, value, goal, band, wrong, tip, label }) {
  const W = 326, H = 140, T = 6, B = 4;
  const max = Math.max(1, ...rows.map((r) => (r.logged ? value(r) : 0)), ...rows.map((r) => (goal(r) || 0) * (1 + (band || 0.15))));
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const step = W / rows.length, bw = Math.max(1.5, Math.min(14, step - 2));
  const xs = rows.map((_, i) => i * step + step / 2);
  const [i, bind] = useScrub(xs, W);
  const on = i != null ? rows[i] : null;
  const segs = goalSegs(rows, goal);
  const bar = (x, top) => {
    const h = y(0) - top, r = Math.min(4, bw / 2, h);
    return `M${x - bw / 2},${y(0)} V${top + r} Q${x - bw / 2},${top} ${x - bw / 2 + r},${top} H${x + bw / 2 - r} Q${x + bw / 2},${top} ${x + bw / 2},${top + r} V${y(0)} Z`;
  };
  return (
    <div className="card nt-chart">
      <div className="scrub" {...bind} role="img" aria-label={label}>
        {on && <ChartTip x={xs[i]} y={on.logged ? y(value(on)) : y(0)} W={W} H={H}>{tip(on)}</ChartTip>}
        <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {band && segs.map((s) => <rect key={`b${s.from}`} className="nt-band" x={s.from * step} width={(s.to - s.from) * step} y={y(s.g * (1 + band))} height={y(s.g * (1 - band)) - y(s.g * (1 + band))} />)}
          {rows.map((r, k) => r.logged && value(r) > 0 && (
            <path key={r.date} d={bar(xs[k], y(value(r)))} className={"nt-bar" + (r.partial ? " faint" : wrong(r) ? " watch" : "") + (i === k ? " on" : "")} />
          ))}
          {segs.map((s) => <line key={`g${s.from}`} className="nt-goal" x1={s.from * step} x2={s.to * step} y1={y(s.g)} y2={y(s.g)} />)}
          <line className="nt-base" x1={0} x2={W} y1={y(0)} y2={y(0)} />
        </svg>
      </div>
      <div className="ends"><span style={{ flex: 1 }}>{shortDate(rows[0].date)}</span><span>{shortDate(rows[rows.length - 1].date)}</span></div>
    </div>
  );
}

/* ═══════════════ Detail screens ═══════════════ */

/** A detail's lead: the number big, what it's against, and the same status as its tile. */
function Lead({ value, unit, sub, verdict }) {
  return (
    <div className="sc-lead">
      <span className="sc-val big"><b>{value}</b><small>{unit}</small></span>
      <span className="sc-sub">{sub}</span>
      {verdict?.tone && <Status {...verdict} />}
    </div>
  );
}

const Rows = ({ title, children }) => (
  <section className="section">
    <h2 className="lbl">{title}</h2>
    <div className="card-list">{children}</div>
  </section>
);
const Row = ({ main, sub, v, vSub, watch }) => (
  <div className="nt-row">
    <span className="nt-row-main"><b>{main}</b>{sub && <span>{sub}</span>}</span>
    {v != null && <span className="nt-row-v">{v}{vSub && <small className={watch ? "watch" : ""}>{vSub}</small>}</span>}
  </div>
);

/** The body of #/nutrition/trends/<which>: its title, the period, then what that tile summarized, in full. */
export function TrendsDetail({ which, ...props }) {
  const { days, pick, data } = useTrends(props);
  return (
    <>
      <h1 className="detail-title">{TREND_DETAILS[which]}</h1>
      <Period data={data} days={days} pick={pick} />
      {data ? <DetailBody which={which} d={data} /> : <Empty />}
    </>
  );
}

function DetailBody({ which, d }) {
  const { rows, s, t, side, out, weeks, top } = d;
  if (which === "calories") return (
    <>
      <Lead value={fmt(s.kcal)} unit="kcal a day" sub={`goal ${fmt(s.targetKcal ?? t?.kcal)}${s.full ? ` · ${s.kcalOn} on goal · ${s.kcalOver} over · ${s.kcalUnder} under` : " · no full days yet, so no average"}`} verdict={kcalVerdict(d)} />
      <section className="section">
        <DayBars rows={rows} value={(r) => r.kcal} goal={(r) => r.t?.kcal} band={KCAL_BAND}
          wrong={(r) => r.full && (side === "both" ? r.kcalStatus !== "on" : r.kcalStatus === side)}
          tip={(r) => <><b>{r.logged ? `${fmt(r.kcal)} kcal` : "Nothing logged"}</b><span>{shortDate(r.date)}{r.t ? ` · goal ${fmt(r.t.kcal)}` : ""}{r.partial ? " · partly logged" : ""}</span></>}
          label={`Calories each day against a goal of ${fmt(t?.kcal)}`} />
        <p className="nt-key"><span><i className="watch" aria-hidden="true" />{side === "over" ? "More than 10% over goal" : side === "under" ? "More than 10% under goal" : "More than 10% off goal"}</span>
          {s.partial > 0 && <span><i className="faint" aria-hidden="true" />Partly logged, not counted</span>}
          <span>Hold to read a day</span></p>
      </section>
      {d.patterns.length > 0 && (
        <Rows title="Where it differs">
          {d.patterns.map((p) => <Row key={p.id} main={p.a} sub={`${fmt(p.aKcal)} kcal vs ${fmt(p.bKcal)} on ${p.b}`} v={signed(p.diff)} />)}
        </Rows>
      )}
      {top.length > 0 && (
        <Rows title="Most calories from">
          {top.map((f) => <Row key={f.name} main={f.name} sub={`logged ${f.times}× · ${f.share}% of calories`} v={fmt(f.perDay)} vSub="kcal a day" />)}
        </Rows>
      )}
    </>
  );

  if (which === "protein") return (
    <>
      <Lead value={fmt(s.protein)} unit="g a day" sub={`goal ${fmt(s.targetProtein ?? t?.protein)} · ${s.full ? `a hit is ${Math.round(PROTEIN_HIT * 100)}% or more` : "no full days yet, so no average"}`} verdict={proteinVerdict(d)} />
      <section className="section">
        <DayBars rows={rows} value={(r) => r.protein} goal={(r) => r.t?.protein}
          wrong={(r) => r.full && !r.proteinHit}
          tip={(r) => <><b>{r.logged ? `${fmt(r.protein)} g protein` : "Nothing logged"}</b><span>{shortDate(r.date)}{r.t ? ` · goal ${fmt(r.t.protein)}` : ""}</span></>}
          label={`Protein each day against a goal of ${fmt(t?.protein)} grams`} />
        <p className="nt-key"><span><i className="watch" aria-hidden="true" />Under {Math.round(PROTEIN_HIT * 100)}% of goal</span><span>Hold to read a day</span></p>
      </section>
      <Rows title="Week by week">
        {weeks.map((w) => <Row key={w.start} main={`${shortDate(w.start)} – ${shortDate(w.end)}`} sub={w.full ? `hit ${w.proteinHit} of ${plural(w.full, "day")}` : "partly logged"}
          v={w.protein != null ? `${fmt(w.protein)} g` : null} vSub="a day" />)}
      </Rows>
    </>
  );

  if (which === "weight") return <WeightDetail d={d} />;

  if (which === "logged") return (
    <>
      <Lead value={s.logged} unit={`of ${s.days} days`} sub={s.partial ? `${s.partial} partly logged, left out of the averages` : "every logged day counted"} verdict={loggedVerdict(d)} />
      <div className="card nt-chart"><LogStrip rows={rows} H={32} />
        <div className="ends"><span style={{ flex: 1 }}>{shortDate(rows[0].date)}</span><span>{shortDate(rows[rows.length - 1].date)}</span></div></div>
      <p className="nt-note">A day under 45% of your calorie goal is probably only partly logged, so it's left out of every average.</p>
      <Rows title="Week by week">
        {weeks.map((w) => {
          const off = w.kcalDiff != null && w.targetKcal ? w.kcalDiff / w.targetKcal : 0;
          const bad = w.full && ((side === "over" && off > KCAL_BAND) || (side === "under" && off < -KCAL_BAND) || (side === "both" && Math.abs(off) > KCAL_BAND));
          return <Row key={w.start} main={`${shortDate(w.start)} – ${shortDate(w.end)}`} sub={`${w.logged} of ${w.days} days logged${w.protein != null ? ` · ${fmt(w.protein)} g protein` : ""}`}
            v={w.kcal != null ? fmt(w.kcal) : null} vSub={w.kcal != null ? `${signed(w.kcalDiff)} vs goal` : null} watch={bad} />;
        })}
      </Rows>
    </>
  );

  if (which === "macros") return (
    <>
      {[["carbs", "Carbs"], ["fat", "Fat"]].map(([k, name]) => (
        <section key={k} className="section">
          <div className="section-head"><h2 className="lbl">{name}</h2><span className="lbl section-aside">{fmt(s[k])} g a day · goal {fmt(s[k === "carbs" ? "targetCarbs" : "targetFat"])}</span></div>
          <DayBars rows={rows} value={(r) => r[k]} goal={(r) => r.t?.[k]} wrong={() => false}
            tip={(r) => <><b>{r.logged ? `${fmt(r[k])} g ${k}` : "Nothing logged"}</b><span>{shortDate(r.date)}{r.t?.[k] ? ` · goal ${fmt(r.t[k])}` : ""}</span></>}
            label={`${name} each day against a goal of ${fmt(t?.[k])} grams`} />
        </section>
      ))}
      <p className="nt-note">Carbs and fat flex around calories and protein, so nothing here is flagged.</p>
    </>
  );

  if (which === "alcohol" && d.alcohol) return <Drinks a={d.alcohol} />;
  return <p className="nt-line">Nothing to show for this period.</p>;
}

/* The weight trend against the goal's pace, and what the log and the scale say about the burn. */
function WeightDetail({ d }) {
  const { out, s, t, weights } = d;
  const { rate, goalRate, burn, estimatedBurn, needs, impliedRate } = out;
  const target = t?.kcal;
  const diff = burn != null && estimatedBurn ? burn - estimatedBurn : 0;
  const line = burn != null
    ? `Your food log and weigh-ins put your burn at about ${fmt(burn)} kcal a day${Math.abs(diff) >= 50 ? `, ${fmt(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than the setup estimated` : ", close to the setup's estimate"}.${
      needs != null && target && Math.abs(needs - target) >= 100 ? ` So your pace needs about ${fmt(needs)} a day, ${fmt(Math.abs(needs - target))} ${needs > target ? "more" : "less"} than your target of ${fmt(target)}.` : ""}`
    : rate != null ? `Log at least 10 full days in this period to work out your real burn from the scale.`
    : impliedRate != null ? `At ${fmt(s.kcal)} a day you'd change about ${lbWeek(impliedRate)} a week by the setup's estimate. Weigh in a few times a week to check it against the scale.`
    : "Weigh in a few times a week to see whether your eating is moving your weight.";
  return (
    <>
      {rate == null && weights.length
        ? <Lead value={weights[weights.length - 1].bw.toFixed(1)} unit="lb" sub={`latest weigh-in, ${shortDate(weights[weights.length - 1].date)} · a trend needs 3+ over 10+ days`} verdict={weightVerdict(d)} />
        : <Lead value={signed1(rate)} unit="lb a week" sub={`${goalRate != null ? `goal ${lbWeek(goalRate)} · ` : ""}${d.outcomeWider ? "over the last 4 weeks" : plural(weights.length, "weigh-in")}`} verdict={weightVerdict(d)} />}
      <section className="section">
        <WeightChart pts={weights} from={d.outFrom} to={d.to} goalRate={goalRate} big />
        {weights.length >= 2 && <p className="nt-key"><span><i className="line" aria-hidden="true" />Your weigh-ins</span>{goalRate != null && <span><i className="dash" aria-hidden="true" />Goal pace</span>}</p>}
      </section>
      <div className="card-list">
        {needs != null && <Row main="Calories for your pace" sub="what to eat a day to hit the goal" v={fmt(needs)} vSub="kcal a day" />}
        <Row main={burn != null ? "Your real burn" : "Burn"} sub={burn != null ? "from your log and weigh-ins" : "the setup's estimate"} v={fmt(burn ?? estimatedBurn)} vSub="kcal a day" />
        {burn != null && estimatedBurn != null && <Row main="Setup estimate" sub="what the setup worked out" v={fmt(estimatedBurn)} vSub="kcal a day" />}
      </div>
      <p className="nt-line">{line}</p>
    </>
  );
}

/** Food against alcohol (wellness on, and drinks in the period): how much of the eating is drinks, and
    whether drinking days bring more food with them. Plain numbers; nothing is colored. */
function Drinks({ a }) {
  const diff = a.foodOnDrinkDays != null && a.foodOtherDays != null ? a.foodOnDrinkDays - a.foodOtherDays : null;
  return (
    <>
      <Lead value={a.perWeek} unit="drinks a week" sub={`${a.drinkDays} drinking day${a.drinkDays === 1 ? "" : "s"}${a.share != null ? ` · ${a.share}% of calories` : ""}`} />
      <div className="card-list">
        <Row main="Food on drinking days" sub={diff != null ? `${fmt(a.foodOnDrinkDays)} vs ${fmt(a.foodOtherDays)} kcal other days` : "not enough days to compare"} v={diff == null ? "–" : signed(diff)} vSub="kcal" />
      </div>
      <p className="nt-note">Alcohol is 7 kcal a gram with no protein. Food is everything else logged that day.</p>
    </>
  );
}
