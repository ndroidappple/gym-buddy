import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ZONES, zoneOf, timedSets, BEFORE_MS, AFTER_MS } from "../lib/heart.js";
import { fmtSet } from "../lib/util.js";

/* A workout's heart rate over time, drawn the way Google Health draws it (a line colored by zone,
   with each zone's threshold marked) plus what only GymBuddy knows: a numbered band for each lift
   (the numbers match the lift list under the chart: names don't fit a phone-width band) and a dot on
   each set's peak. Touch or drag across it (or use the arrow keys) to read any moment: bpm, zone,
   and which lift and set it was. Zones are one ink ramp, darker for harder: they're a scale, and
   the plate colors belong to the days. */

const H = 200;
const PAD = { top: 22, right: 34, bottom: 22, left: 4 };
const BREAK_MS = 60_000; // no readings for a minute: the line breaks rather than drawing across the gap

const clock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export default function HeartChart({ session, readings }) {
  const wrap = useRef(null);
  const [w, setW] = useState(0);
  const [at, setAt] = useState(null); // index of the reading being read, or null
  const tip = useRef(null);
  const [tipW, setTipW] = useState(0);
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
      lo = Math.min(lo, bounds[1]);
      hi = Math.max(hi, bounds[2]);
      if (bounds[3] <= hi + 20) hi = Math.max(hi, bounds[3]);
    }
    lo = Math.floor((lo - 6) / 5) * 5;
    hi = Math.ceil((hi + 6) / 5) * 5;
    const t0 = Math.min(start, pts[0][0]), t1 = Math.max(end, pts[pts.length - 1][0]);
    const iw = w - PAD.left - PAD.right, ih = H - PAD.top - PAD.bottom;
    const x = (t) => PAD.left + ((t - t0) / (t1 - t0)) * iw;
    const y = (b) => PAD.top + (1 - (b - lo) / (hi - lo)) * ih;

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

    // A band for each lift, from just before its first set to just after its last.
    const byLift = [];
    for (const s of sets) {
      const b = byLift.find((x) => x.lift === s.lift);
      if (b) b.last = s.t; else byLift.push({ lift: s.lift, first: s.t, last: s.t });
    }
    const bands = byLift.map((b, i) => {
      const x0 = Math.max(PAD.left, x(b.first - BEFORE_MS)), x1 = Math.min(w - PAD.right, x(b.last + AFTER_MS));
      return { ...b, n: i + 1, x0, x1 };
    });

    const marks = sets.filter((s) => s.set.hr).map((s) => ({ ...s, cx: x(s.t), cy: y(s.set.hr) }));
    const lines = bounds ? bounds.slice(1).map((b, i) => ({ b, z: i + 1, y: y(b) })).filter((l) => l.b > lo && l.b < hi) : [];
    const ticks = w > 300 ? [t0, (t0 + t1) / 2, t1] : [t0, t1];
    return { x, y, runs, bands, marks, lines, ticks, t0, t1, iw };
  }, [w, pts, bounds, sets, start, end]);

  // The moment being read: the reading nearest the pointer.
  const pick = (clientX) => {
    if (!g) return;
    const r = wrap.current.getBoundingClientRect();
    const t = g.t0 + ((clientX - r.left - PAD.left) / g.iw) * (g.t1 - g.t0);
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
    const z = zoneOf(b, bounds);
    const set = sets.find((s) => t >= s.t - BEFORE_MS && t <= s.t + AFTER_MS);
    const band = g.bands.find((x) => t >= x.first - BEFORE_MS && t <= x.last + AFTER_MS);
    const what = set ? `${set.lift} · set ${set.i + 1} · ${fmtSet(set.set)}` : band ? `${band.lift} · resting` : null;
    const px = g.x(t);
    // Centered on the moment, kept inside the chart's width.
    return { t, b, z, what, px, py: g.y(b), left: Math.min(Math.max(px - tipW / 2, 0), Math.max(0, w - tipW)) };
  })() : null;
  useLayoutEffect(() => { if (tip.current) setTipW(tip.current.offsetWidth); }, [at != null, read?.what]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = `Heart rate from ${clock(start)} to ${clock(end)}: average ${hr.avg}, peak ${hr.max} bpm. Use the arrow keys to read it.`;
  return (
    <div className="hr-chart" ref={wrap}>
      {g && (
        <svg width={w} height={H} role="img" aria-label={label} tabIndex={0} onKeyDown={onKey} onBlur={() => setAt(null)}
          onPointerDown={(e) => pick(e.clientX)} onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") setAt(null); }} onPointerCancel={() => setAt(null)}>
          {g.bands.map((b) => (
            <g key={b.lift}>
              <rect className="hr-band" x={b.x0} y={PAD.top - 18} width={Math.max(0, b.x1 - b.x0)} height={H - PAD.bottom - PAD.top + 18} rx={6} />
              <text className="hr-band-label" x={(b.x0 + b.x1) / 2} y={PAD.top - 5} textAnchor="middle">{b.n}</text>
            </g>
          ))}
          {g.lines.map((l) => (
            <g key={l.z}>
              <line className="hr-threshold" x1={PAD.left} x2={w - PAD.right} y1={l.y} y2={l.y} />
              <text className="hr-axis" x={w - PAD.right + 6} y={l.y + 4}>{l.b}</text>
            </g>
          ))}
          {g.runs.map((r, i) => <path key={i} className={`hr-line z${r.z + 1}`} d={r.d} />)}
          {g.marks.map((m) => <circle key={`${m.lift}-${m.i}`} className="hr-set" cx={m.cx} cy={m.cy} r={4} />)}
          {g.ticks.map((t, i) => (
            <text key={i} className="hr-axis" x={g.x(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === g.ticks.length - 1 ? "end" : "middle"}>{clock(t)}</text>
          ))}
          {read && (
            <g>
              <line className="hr-cross" x1={read.px} x2={read.px} y1={PAD.top - 18} y2={H - PAD.bottom} />
              <circle className={`hr-dot z${Math.max(0, read.z) + 1}`} cx={read.px} cy={read.py} r={5} />
            </g>
          )}
        </svg>
      )}
      {read && (
        <div className="hr-tip" ref={tip} style={{ left: read.left, visibility: tipW ? "visible" : "hidden" }} role="status">
          <b>{read.b} bpm</b>
          <span>{clock(read.t)}{read.z >= 0 ? ` · ${ZONES[read.z].label}` : ""}</span>
          {read.what && <span>{read.what}</span>}
        </div>
      )}
      {bounds && (
        <div className="hr-legend" aria-hidden="true">
          {ZONES.map((z, i) => <span key={z.id}><i className={`z${i + 1}`} />{z.label} {bounds[i]}+</span>)}
          {g?.marks.length > 0 && <span><i className="dot" />Set peak</span>}
          {g?.bands.length > 0 && <span><i className="band" />Lift, numbered below</span>}
        </div>
      )}
    </div>
  );
}
