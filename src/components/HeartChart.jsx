import React, { useEffect, useMemo, useRef, useState } from "react";
import { ZONES, zoneOf, timedSets, BEFORE_MS, AFTER_MS } from "../lib/heart.js";
import { fmtSet } from "../lib/util.js";

/* A workout's heart rate over time, drawn the way Google Health draws it (a line colored by zone,
   each zone's threshold marked and named) plus what only GymBuddy knows: when each lift and set
   happened. Three layers, each in its own space so nothing sits on anything else:
     - a readout row above the plot: the workout's average and peak, or, while touching or dragging
       across the chart (or using the arrow keys), that moment's bpm, zone, time, and lift and set;
     - the plot: the line, the zones it crosses (faint tint above each threshold, named at the right),
       and a dot on each set's peak;
     - a lift strip under the plot on the same timeline: a numbered segment per lift with a tick per
       set, the numbers named in the key below.
   Zones are steps of the workout day's color (styles.css, --hr-z1..4), deeper and bolder for harder:
   the color says which day, the step how hard. */

const PLOT_H = 168;
const STRIP_GAP = 10, STRIP_H = 22, AXIS_H = 26;
const PAD = { top: 8, right: 34, left: 2 };
const BREAK_MS = 60_000; // no readings for a minute: the line breaks rather than drawing across the gap

const clock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
/** A zone's range in bpm: "under 117", "117–142", "175+". */
export const zoneRange = (bounds, i) => (i === 0 ? `under ${bounds[1]}` : i === 3 ? `${bounds[3]}+` : `${bounds[i]}–${bounds[i + 1] - 1}`);

export default function HeartChart({ session, readings }) {
  const wrap = useRef(null);
  const [w, setW] = useState(0);
  const [at, setAt] = useState(null); // index of the reading being read, or null
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hr = session.hr;
  const bounds = hr.bounds || null;
  const start = session.startedAt, end = session.finishedAt;
  const pts = useMemo(() => readings.filter(([t]) => t >= start - 30_000 && t <= end + 30_000), [readings, start, end]);
  const sets = useMemo(() => timedSets(session), [session]);

  const g = useMemo(() => {
    if (!w || !pts.length) return null;
    const bpms = pts.map(([, b]) => b);
    let lo = Math.min(...bpms), hi = Math.max(...bpms);
    if (bounds) {
      lo = Math.min(lo, bounds[1] - 10);
      hi = Math.max(hi, bounds[2]);
      if (bounds[3] <= hi + 20) hi = Math.max(hi, bounds[3]);
    }
    lo = Math.floor((lo - 4) / 5) * 5;
    hi = Math.ceil((hi + 8) / 5) * 5;
    const t0 = Math.min(start, pts[0][0]), t1 = Math.max(end, pts[pts.length - 1][0]);
    const x0 = PAD.left, x1 = w - PAD.right, iw = x1 - x0;
    const top = PAD.top, bottom = PAD.top + PLOT_H;
    const x = (t) => x0 + ((t - t0) / (t1 - t0)) * iw;
    const y = (b) => top + (1 - (b - lo) / (hi - lo)) * PLOT_H;

    // Runs of one zone, each joined to the next reading so the line doesn't break at a zone change.
    const runs = [];
    let run = null;
    pts.forEach(([t, b], i) => {
      const z = Math.max(0, zoneOf(b, bounds));
      const gap = i > 0 && t - pts[i - 1][0] > BREAK_MS;
      if (run && !gap) run.d += ` L${x(t).toFixed(1)},${y(b).toFixed(1)}`;
      if (!run || gap || run.z !== z) {
        run = { z, d: `M${x(t).toFixed(1)},${y(b).toFixed(1)}` };
        runs.push(run);
      }
    });

    // Each zone from moderate up: its threshold line, named at the right, and a faint tint above it.
    const zones = bounds ? [1, 2, 3].map((i) => ({ i, b: bounds[i], y: y(bounds[i]) })).filter((z) => z.b > lo && z.b < hi) : [];

    // A segment per lift on the strip, from just before its first set to just after its last.
    const stripY = bottom + STRIP_GAP;
    const byLift = [];
    for (const s of sets) {
      const b = byLift.find((l) => l.lift === s.lift);
      if (b) { b.last = s.t; b.ticks.push(s.t); } else byLift.push({ lift: s.lift, first: s.t, last: s.t, ticks: [s.t] });
    }
    const lifts = byLift.map((b, i) => {
      const a = Math.max(x0, x(b.first - BEFORE_MS)), z = Math.min(x1, x(b.last + AFTER_MS));
      return { ...b, n: i + 1, a, z, ticks: b.ticks.map(x) };
    });

    const marks = sets.filter((s) => s.set.hr).map((s) => ({ ...s, cx: x(s.t), cy: y(s.set.hr) }));
    const ticks = w > 300 ? [t0, (t0 + t1) / 2, t1] : [t0, t1];
    // No set times (logged before they were recorded): no strip, and no gap where it would be.
    const h = bottom + (lifts.length ? STRIP_GAP + STRIP_H : 0) + AXIS_H;
    return { x, y, runs, zones, lifts, marks, ticks, t0, t1, x0, x1, iw, top, bottom, stripY, h };
  }, [w, pts, bounds, sets, start, end]);

  // The moment being read: the reading nearest the pointer.
  const pick = (clientX) => {
    if (!g) return;
    const r = wrap.current.getBoundingClientRect();
    const t = g.t0 + ((clientX - r.left - g.x0) / g.iw) * (g.t1 - g.t0);
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][0] < t) lo = m; else hi = m; }
    setAt(Math.abs(pts[lo][0] - t) <= Math.abs(pts[hi][0] - t) ? lo : hi);
  };
  const onKey = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") { if (e.key === "Escape") setAt(null); return; }
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 6 : -6; // 30 s
    setAt((i) => Math.min(pts.length - 1, Math.max(0, (i ?? (step > 0 ? -step : pts.length - 1 - step)) + step)));
  };

  const read = at != null && g ? (() => {
    const [t, b] = pts[at];
    const set = sets.find((s) => t >= s.t - BEFORE_MS && t <= s.t + AFTER_MS);
    const lift = g.lifts.find((l) => t >= l.first - BEFORE_MS && t <= l.last + AFTER_MS);
    return {
      t, b, z: zoneOf(b, bounds), px: g.x(t), py: g.y(b), lift: lift?.lift,
      what: set ? `${set.lift} · set ${set.i + 1} · ${fmtSet(set.set)}` : lift ? `${lift.lift} · resting` : "Between lifts",
    };
  })() : null;

  const label = `Heart rate from ${clock(start)} to ${clock(end)}: average ${hr.avg}, peak ${hr.max} bpm. Use the arrow keys to read any moment.`;
  return (
    <div className="hr-chart">
      <p className="hr-chart-title">Over the workout, in beats per minute</p>
      {/* The readout: in its own row, so it never covers the chart or anything above it. */}
      <div className="hr-readout" aria-live="polite">
        {read ? (
          <>
            <span className="hr-readout-main">
              <b>{read.b}</b> bpm
              {read.z >= 0 && <span className="hr-zone-chip"><i className={`z${read.z + 1}`} aria-hidden="true" />{ZONES[read.z].label}</span>}
            </span>
            <span className="hr-readout-sub">{clock(read.t)} · {read.what}</span>
          </>
        ) : (
          <>
            <span className="hr-readout-main">Touch or drag across the chart</span>
            <span className="hr-readout-sub">See the bpm, zone, lift and set at any moment.</span>
          </>
        )}
      </div>
      <div className="hr-plot" ref={wrap}>
        {g && (
          <svg width={w} height={g.h} role="img" aria-label={label} tabIndex={0} onKeyDown={onKey} onBlur={() => setAt(null)}
            onPointerDown={(e) => pick(e.clientX)} onPointerMove={(e) => pick(e.clientX)}
            onPointerLeave={(e) => { if (e.pointerType === "mouse") setAt(null); }} onPointerCancel={() => setAt(null)}>
            {/* Zones: a faint tint above each threshold, its line, its bpm on the axis and its name. */}
            {g.zones.map((z) => <rect key={`t${z.i}`} className={`hr-zone-tint z${z.i + 1}`} x={g.x0} y={g.top} width={g.iw} height={Math.max(0, z.y - g.top)} />)}
            {g.zones.map((z) => (
              <g key={`l${z.i}`}>
                <line className="hr-threshold" x1={g.x0} x2={g.x1} y1={z.y} y2={z.y} />
                <text className="hr-axis" x={g.x1 + 6} y={z.y + 4}>{z.b}</text>
              </g>
            ))}
            <line className="hr-baseline" x1={g.x0} x2={g.x1} y1={g.bottom} y2={g.bottom} />
            {g.runs.map((r, i) => <path key={i} className={`hr-line z${r.z + 1}`} d={r.d} />)}
            {/* Zone names over the line, with a halo in the background color so they stay readable. */}
            {g.zones.map((z) => <text key={`n${z.i}`} className="hr-zone-name" x={g.x1 - 4} y={z.y - 5} textAnchor="end">{ZONES[z.i].label}</text>)}
            {g.marks.map((m) => <circle key={`${m.lift}-${m.i}`} className="hr-set" cx={m.cx} cy={m.cy} r={3} />)}

            {/* The lift strip: one numbered segment per lift, a tick per set. */}
            {g.lifts.map((l) => {
              const on = read?.lift === l.lift;
              const wide = l.z - l.a;
              return (
                <g key={l.lift} className={on ? "hr-lift on" : "hr-lift"}>
                  <rect x={l.a} y={g.stripY} width={Math.max(2, wide)} height={STRIP_H} rx={5} />
                  {l.ticks.map((tx, i) => <line key={i} className="hr-lift-tick" x1={tx} x2={tx} y1={g.stripY + STRIP_H - 6} y2={g.stripY + STRIP_H - 2} />)}
                  {wide >= 14 && <text x={(l.a + l.z) / 2} y={g.stripY + 13} textAnchor="middle">{l.n}</text>}
                </g>
              );
            })}
            {g.ticks.map((t, i) => (
              <text key={i} className="hr-axis" x={g.x(t)} y={g.h - 4} textAnchor={i === 0 ? "start" : i === g.ticks.length - 1 ? "end" : "middle"}>{clock(t)}</text>
            ))}
            {read && (
              <g>
                <line className="hr-cross" x1={read.px} x2={read.px} y1={g.top} y2={g.lifts.length ? g.stripY + STRIP_H : g.bottom} />
                <circle className={`hr-dot z${Math.max(0, read.z) + 1}`} cx={read.px} cy={read.py} r={5} />
              </g>
            )}
          </svg>
        )}
      </div>
      {g?.lifts.length > 0 && (
        <ol className="hr-lift-key">
          {g.lifts.map((l) => <li key={l.lift} className={read?.lift === l.lift ? "on" : undefined}><span className="hr-lift-n" aria-hidden="true">{l.n}</span>{l.lift}</li>)}
        </ol>
      )}
      {bounds && (
        <div className="hr-legend" aria-hidden="true">
          {ZONES.map((z, i) => <span key={z.id}><i className={`z${i + 1}`} />{z.label} {zoneRange(bounds, i)}</span>)}
          {g?.marks.length > 0 && <span><i className="dot" />Set peak</span>}
        </div>
      )}
    </div>
  );
}
