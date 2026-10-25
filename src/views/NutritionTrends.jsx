import React, { useMemo, useState } from "react";
import { href } from "../lib/router.js";
import { shortDate, bodyweightSeries, iso } from "../lib/util.js";
import { EmptyState, useScrub, ChartTip, Read } from "../components/ui.jsx";
import { dailyRows, summarize, weekRows, patterns, outcome, topFoods, periodRange, targetsBackfilled, wrongSide, targetsOn, KCAL_BAND, PROTEIN_HIT } from "../lib/nutritionTrends.js";

/* Progress → Nutrition: how what the lifter ate compares with their targets over a period, and whether
   it's doing what the goal needs. In order of what matters: the period's averages against the targets,
   calories and protein day by day, the weight trend against the goal's pace (and the burn it implies),
   then where the eating differs, week by week, and the foods that bring the most calories. The rules
   (partial days, on target, protein hit) are lib/nutritionTrends.js's, the same as the week in review.
   Like the recap, only what's off gets a pill or a color; the rest is plain. */

const RANGES = [{ days: 14, label: "2 weeks" }, { days: 28, label: "4 weeks" }, { days: 84, label: "12 weeks" }];
const RANGE_KEY = "ironlog-nutrition-range";
// The scale moves a pound or two day to day: a weight trend over less than four weeks is mostly noise.
const OUTCOME_DAYS = 28;
const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
const signed = (n, unit = "") => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${fmt(Math.abs(n))}${unit}`;
const lbWeek = (r) => (r == null ? "–" : `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(1)} lb`);

export default function NutritionTrends({ food, prefs, sessions, weighins }) {
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
    return {
      from, to, rows, s, weeks: weekRows(rows), patterns: patterns(rows, sessions),
      out: outcome(days >= OUTCOME_DAYS ? rows : dailyRows(entries, n, periodRange(entries, OUTCOME_DAYS).from, to), bodyweightSeries(sessions, weighins), n),
      outcomeWider: days < OUTCOME_DAYS, top: topFoods(entries, rows),
      backfilled: targetsBackfilled(n, from), side: wrongSide(n, targetsOn(n, to)),
    };
  }, [entries, n, days, sessions, weighins]);

  const picker = (
    <div className="segctl small" role="group" aria-label="Period">
      {RANGES.map((r) => <button key={r.days} aria-pressed={days === r.days} onClick={() => pick(r.days)}>{r.label}</button>)}
    </div>
  );
  if (!data) {
    return (
      <>
        {picker}
        <EmptyState title="Nothing logged yet" action="Log food" href={href("nutrition")}>
          Log a few days of food and this shows how your eating compares with your targets, day by day and week by week.
        </EmptyState>
      </>
    );
  }
  const { rows, s, weeks, out, top, side } = data;
  const t = targetsOn(n, data.to);
  const kcalOff = s.kcalDiff != null && s.targetKcal ? s.kcalDiff / s.targetKcal : 0;
  const kcalWrong = (side === "over" && kcalOff > KCAL_BAND) || (side === "under" && kcalOff < -KCAL_BAND) || (side === "both" && Math.abs(kcalOff) > KCAL_BAND);
  const proteinShare = s.full ? s.proteinHit / s.full : 0;

  return (
    <>
      {picker}

      {/* The period in three numbers, against the targets. */}
      <section className="section">
        <h2 className="lbl">{shortDate(data.from)} – {shortDate(data.to)}</h2>
        <div className="stats">
          <div className="stat">
            <b>{fmt(s.kcal)}</b><span>kcal a day</span>
            {kcalWrong ? <Read tone="watch">{signed(s.kcalDiff)} vs goal</Read>
              : Math.abs(kcalOff) <= KCAL_BAND ? <Read tone="good">On goal</Read> : null}
            <span className="stat-note">goal {fmt(s.targetKcal)}</span>
          </div>
          <div className="stat">
            <b>{fmt(s.protein)}</b><span>g protein a day</span>
            {proteinShare >= 0.8 ? <Read tone="good">{s.proteinHit} of {s.full} days</Read>
              : proteinShare < 0.5 ? <Read tone="watch">{s.proteinHit} of {s.full} days</Read> : null}
            <span className="stat-note">goal {fmt(s.targetProtein)}{proteinShare >= 0.5 && proteinShare < 0.8 ? ` · hit ${s.proteinHit} of ${s.full}` : ""}</span>
          </div>
          <div className="stat">
            <b>{s.logged}</b><span>of {s.days} days logged</span>
            {s.logged < s.days * 0.6 && <Read tone="watch">Gaps</Read>}
            {s.partial > 0 && <span className="stat-note">{s.partial} partly logged</span>}
          </div>
        </div>
        {s.carbs != null && <p className="nt-note">Carbs {fmt(s.carbs)} g a day (goal {fmt(s.targetCarbs)}) · fat {fmt(s.fat)} g (goal {fmt(s.targetFat)})</p>}
      </section>

      <Working out={out} s={s} wider={data.outcomeWider} target={t?.kcal} />

      <section className="section">
        <div className="section-head"><h2 className="lbl">Calories</h2><span className="lbl section-aside">{s.kcalOn} on goal · {s.kcalOver} over · {s.kcalUnder} under</span></div>
        <DayBars rows={rows} value={(r) => r.kcal} goal={(r) => r.t?.kcal} band={KCAL_BAND}
          wrong={(r) => r.full && (side === "both" ? r.kcalStatus !== "on" : r.kcalStatus === side)}
          tip={(r) => <><b>{r.logged ? `${fmt(r.kcal)} kcal` : "Nothing logged"}</b><span>{shortDate(r.date)}{r.t ? ` · goal ${fmt(r.t.kcal)}` : ""}{r.partial ? " · partly logged" : ""}</span></>}
          label={`Calories each day against a goal of ${fmt(t?.kcal)}`} />
        <p className="nt-key"><span><i className="watch" aria-hidden="true" />{side === "over" ? "More than 10% over goal" : side === "under" ? "More than 10% under goal" : "More than 10% off goal"}</span>
          {s.partial > 0 && <span><i className="faint" aria-hidden="true" />Partly logged, not counted</span>}</p>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="lbl">Protein</h2><span className="lbl section-aside">hit on {s.proteinHit} of {s.full} days</span></div>
        <DayBars rows={rows} value={(r) => r.protein} goal={(r) => r.t?.protein}
          wrong={(r) => r.full && !r.proteinHit}
          tip={(r) => <><b>{r.logged ? `${fmt(r.protein)} g protein` : "Nothing logged"}</b><span>{shortDate(r.date)}{r.t ? ` · goal ${fmt(r.t.protein)}` : ""}</span></>}
          label={`Protein each day against a goal of ${fmt(t?.protein)} grams`} />
        <p className="nt-key"><span><i className="watch" aria-hidden="true" />Under {Math.round(PROTEIN_HIT * 100)}% of goal</span></p>
      </section>

      {data.patterns.length > 0 && (
        <section className="section">
          <h2 className="lbl">Where it differs</h2>
          <div className="card-list">
            {data.patterns.map((p) => (
              <div key={p.id} className="nt-row">
                <span className="nt-row-main"><b>{p.a}</b><span>{fmt(p.aKcal)} kcal vs {fmt(p.bKcal)} on {p.b}</span></span>
                <span className="nt-row-v">{signed(p.diff)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2 className="lbl">Week by week</h2>
        <div className="card-list">
          {weeks.map((w) => {
            const off = w.kcalDiff != null && w.targetKcal ? w.kcalDiff / w.targetKcal : 0;
            const bad = w.full && ((side === "over" && off > KCAL_BAND) || (side === "under" && off < -KCAL_BAND) || (side === "both" && Math.abs(off) > KCAL_BAND));
            return (
              <div key={w.start} className="nt-row">
                <span className="nt-row-main"><b>{shortDate(w.start)} – {shortDate(w.end)}</b><span>{w.logged} of {w.days} days logged{w.protein != null ? ` · ${fmt(w.protein)} g protein` : ""}</span></span>
                <span className="nt-row-v">{w.kcal != null ? <>{fmt(w.kcal)}<small className={bad ? "watch" : ""}>{signed(w.kcalDiff)}</small></> : <small>partly logged</small>}</span>
              </div>
            );
          })}
        </div>
      </section>

      {top.length > 0 && (
        <section className="section">
          <h2 className="lbl">Most calories from</h2>
          <div className="card-list">
            {top.map((f) => (
              <div key={f.name} className="nt-row">
                <span className="nt-row-main"><b>{f.name}</b><span>logged {f.times}× · {f.share}% of calories</span></span>
                <span className="nt-row-v">{fmt(f.perDay)}<small>kcal a day</small></span>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.backfilled && (n?.history?.[0]?.from || n?.setAt) && (
        <p className="nt-note">Targets from before {shortDate(n.history?.[0]?.from || iso(new Date(n.setAt)))} weren't kept, so earlier days are compared with the first targets on record.</p>
      )}
    </>
  );
}

/* The weight trend against the goal's pace, and what the log and the scale say about the burn. */
function Working({ out, s, wider, target }) {
  const { rate, goalRate, burn, estimatedBurn, needs, impliedRate } = out;
  if (goalRate == null) return null;
  const toward = rate != null && (goalRate === 0 ? Math.abs(rate) <= 0.3 : Math.sign(rate) === Math.sign(goalRate) && Math.abs(rate) >= Math.abs(goalRate) * 0.6);
  const diff = burn != null && estimatedBurn ? burn - estimatedBurn : 0;
  const line = burn != null
    ? `Your food log and weigh-ins put your burn at about ${fmt(burn)} kcal a day${Math.abs(diff) >= 50 ? `, ${fmt(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than the setup estimated` : ", close to the setup's estimate"}.${
      needs != null && target && Math.abs(needs - target) >= 100 ? ` So your pace needs about ${fmt(needs)} a day, ${fmt(Math.abs(needs - target))} ${needs > target ? "more" : "less"} than your target of ${fmt(target)}.` : ""}`
    : rate != null ? `Log at least 10 full days in this period to work out your real burn from the scale.`
    : impliedRate != null ? `At ${fmt(s.kcal)} a day you'd change about ${lbWeek(impliedRate)} a week by the setup's estimate. Weigh in a few times a week to check it against the scale.`
    : "Weigh in a few times a week to see whether your eating is moving your weight.";
  return (
    <section className="section">
      <div className="section-head"><h2 className="lbl">Is it working?</h2>{wider && <span className="lbl section-aside">last 4 weeks</span>}</div>
      <div className="stats">
        <div className="stat">
          <b>{rate == null ? "–" : `${rate > 0 ? "+" : rate < 0 ? "−" : "±"}${Math.abs(rate).toFixed(1)}`}</b><span>lb a week, weight trend</span>
          {rate != null && (toward ? <Read tone="good">On pace</Read> : <Read tone="watch">Off pace</Read>)}
          <span className="stat-note">goal {lbWeek(goalRate)}</span>
        </div>
        {needs != null
          ? <div className="stat"><b>{fmt(needs)}</b><span>kcal a day for your pace</span><span className="stat-note">burn ≈ {fmt(burn)}</span></div>
          : <div className="stat"><b>{fmt(burn ?? estimatedBurn)}</b><span>kcal burn a day</span><span className="stat-note">{burn != null ? "from your log and weigh-ins" : "setup estimate"}</span></div>}
      </div>
      <p className="nt-line">{line}</p>
    </section>
  );
}

/* One bar a day from zero, the goal as a line (it steps where the targets changed), and the band of
   ±`band` around it when there is one. Bars on the wrong side of the goal take the warning color;
   partly logged days are faint. Hold (or hover) to read a day. */
function DayBars({ rows, value, goal, band, wrong, tip, label }) {
  const W = 326, H = 120, T = 6, B = 4;
  const max = Math.max(1, ...rows.map((r) => (r.logged ? value(r) : 0)), ...rows.map((r) => (goal(r) || 0) * (1 + (band || 0.15))));
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const step = W / rows.length, bw = Math.max(1.5, Math.min(14, step - 2));
  const xs = rows.map((_, i) => i * step + step / 2);
  const [i, bind] = useScrub(xs, W);
  const on = i != null ? rows[i] : null;
  // The goal (and band) as steps, one segment per day, merged where the targets hold.
  const segs = [];
  rows.forEach((r, k) => {
    const g = goal(r);
    if (g == null) return;
    const last = segs[segs.length - 1];
    if (last && last.g === g && last.to === k) last.to = k + 1; else segs.push({ g, from: k, to: k + 1 });
  });
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
