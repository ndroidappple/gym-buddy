import React, { useEffect, useRef, useState, useMemo } from "react";
import { X, Home, CalendarDays, TrendingUp, Settings as Gear, Plus } from "lucide-react";
import { LIBRARY } from "../data/program.js";

export function Sheet({ title, sub, onClose, children, labelledBy = "sheet-title" }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    const first = ref.current?.querySelector("input, textarea");
    (first || ref.current)?.focus();
    const onKey = (e) => { if (e.key === "Escape") close.current(); };
    addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
  }, []);
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <div style={{ flex: 1 }}>
            <h2 className="sheet-title" id={labelledBy}>{title}</h2>
            {sub && <p className="sheet-sub">{sub}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmSheet({ title, body, confirm, onConfirm, onClose }) {
  return (
    <Sheet title={title} sub={body} onClose={onClose} labelledBy="confirm-title">
      <div className="btn-row">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" onClick={() => { onConfirm(); onClose(); }}>{confirm}</button>
      </div>
    </Sheet>
  );
}

export function Toast({ toast, onDismiss, raised }) {
  return (
    <div aria-live="polite" className="sr-live">
      {toast && (
        <div className={"toast" + (raised ? " raised" : "")} role="status">
          <span className="msg">{toast.msg}</span>
          {toast.undo && <button onClick={() => { toast.undo(); onDismiss(); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}

const TABS = [
  { key: "today", label: "Today", Icon: Home },
  { key: "history", label: "History", Icon: CalendarDays },
  { key: "progress", label: "Progress", Icon: TrendingUp },
  { key: "settings", label: "Settings", Icon: Gear },
];

export function TabBar({ active }) {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map(({ key, label, Icon }) => (
        <a key={key} className="tab" href={`#/${key}`} aria-current={active === key ? "page" : undefined}>
          <Icon size={21} strokeWidth={2.4} aria-hidden="true" />
          <span className="tab-label">{label}</span>
        </a>
      ))}
    </nav>
  );
}

export function Boot() {
  return (
    <div className="boot" role="status" aria-label="Loading IRONLOG">
      <div className="plates" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="wordmark">IRONLOG</div>
    </div>
  );
}

export function Trend({ pct }) {
  if (pct == null) return <span className="trend flat">new</span>;
  if (Math.abs(pct) < 1) return <span className="trend flat">— {Math.abs(pct).toFixed(1)}%</span>;
  return <span className={"trend" + (pct < 0 ? " flat" : "")}>{pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%</span>;
}

export function Sparkline({ values }) {
  if (values.length < 2) return <svg className="spark" aria-hidden="true" />;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 72, 26 - ((v - min) / span) * 24]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox="0 0 72 28" aria-hidden="true">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} style={{ fill: "none", stroke: "var(--day, var(--ink))", strokeWidth: 3.5, strokeLinejoin: "round", strokeLinecap: "round" }} />
      <circle cx={lx} cy={ly} r="3.5" style={{ fill: "var(--day, var(--ink))" }} />
    </svg>
  );
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = [];
  for (let v = lo; v <= hi + step / 2; v += step) t.push(Math.round(v * 100) / 100);
  return t;
}

/** Line chart drawn to scale. Points: {label, value, pr?}. Tap a point to read it. */
export function LineChart({ points, format = (v) => v, height = 150, ariaLabel }) {
  const [sel, setSel] = useState(null);
  const W = 300, H = height, L = 34, R = 8, T = 10, B = 22;
  const vals = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const lo = ticks[0], hi = ticks[ticks.length - 1], span = hi - lo || 1;
  const x = (i) => L + (points.length === 1 ? (W - L - R) / 2 : (i / (points.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / span) * (H - T - B);
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const area = `M${x(0)},${H - B} L${line.replace(/ /g, " L")} L${x(points.length - 1)},${H - B} Z`;
  const s = sel != null ? points[sel] : null;
  return (
    <div className="chart">
      {s && <div className="chart-tip">{s.label} · {format(s.value)}{s.pr ? " · PR" : ""}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} style={{ stroke: "var(--rule)", strokeWidth: 1 }} />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end" style={{ fill: "var(--mute)", fontSize: 10, fontWeight: 600 }}>{format(t)}</text>
          </g>
        ))}
        <path d={area} style={{ fill: "var(--day, var(--ink))", opacity: 0.12 }} />
        <polyline points={line} style={{ fill: "none", stroke: "var(--day, var(--ink))", strokeWidth: 3.5, strokeLinejoin: "round", strokeLinecap: "round" }} />
        {points.map((p, i) => (
          <g key={i} onClick={() => setSel(sel === i ? null : i)} style={{ cursor: "pointer" }}>
            <circle cx={x(i)} cy={y(p.value)} r="14" style={{ fill: "transparent" }} />
            <circle cx={x(i)} cy={y(p.value)} r={sel === i ? 6 : p.pr ? 4.5 : 3.5}
              style={{ fill: p.pr ? "var(--day, var(--ink))" : "var(--surface)", stroke: "var(--day, var(--ink))", strokeWidth: 2 }} />
          </g>
        ))}
        <text x={x(0)} y={H - 5} textAnchor={points.length === 1 ? "middle" : "start"} style={{ fill: "var(--mute)", fontSize: 10, fontWeight: 600 }}>{points[0].label}</text>
        {points.length > 1 && <text x={x(points.length - 1)} y={H - 5} textAnchor="end" style={{ fill: "var(--mute)", fontSize: 10, fontWeight: 600 }}>{points[points.length - 1].label}</text>}
      </svg>
    </div>
  );
}

/** Library search plus "create your own". Calls onPick({n, sets, reps, rest, cue}). */
export function ExercisePicker({ title, sub, existingNames, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [custom, setCustom] = useState(null);

  const grouped = useMemo(() => {
    const taken = new Set(existingNames);
    const t = q.trim().toLowerCase();
    const m = {};
    LIBRARY.filter((e) => !taken.has(e.n) && (!t || e.n.toLowerCase().includes(t) || e.g.toLowerCase().includes(t)))
      .forEach((e) => { (m[e.g] ||= []).push(e); });
    return m;
  }, [q, existingNames]);

  if (custom) {
    const valid = custom.n.trim() && !existingNames.includes(custom.n.trim());
    const set = (k) => (e) => setCustom({ ...custom, [k]: e.target.value });
    return (
      <Sheet title="New exercise" sub="Set your defaults. You can change them later in Settings." onClose={onClose}>
        <label className="field"><span className="lbl">Exercise name</span>
          <input id="custom-name" className="input" value={custom.n} onChange={set("n")} placeholder="e.g. Smith Machine Row" /></label>
        <div className="grid-4">
          {[["sets", "Sets"], ["min", "Rep low"], ["max", "Rep high"], ["rest", "Rest s"]].map(([k, l]) => (
            <label key={k} className="field"><span className="lbl">{l}</span>
              <input id={`custom-${k}`} className="input tn" type="number" inputMode="numeric" value={custom[k]} onChange={set(k)} /></label>
          ))}
        </div>
        <label className="field"><span className="lbl">Cue (optional)</span>
          <input id="custom-cue" className="input" value={custom.cue} onChange={set("cue")} placeholder="Form reminder you want to see mid-set" /></label>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => setCustom(null)}>Back</button>
          <button className="btn btn-ink" disabled={!valid} onClick={() => onPick({
            n: custom.n.trim(),
            sets: Math.max(1, parseInt(custom.sets) || 3),
            reps: [parseInt(custom.min) || 8, parseInt(custom.max) || 12],
            rest: Math.max(15, parseInt(custom.rest) || 90),
            cue: custom.cue.trim(),
          })}>Add</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={title} sub={sub} onClose={onClose}>
      <label className="field"><span className="sr-only">Search lifts</span>
        <input id="lift-search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lifts or muscle groups" /></label>
      {Object.keys(grouped).length === 0 && <p className="muted small" style={{ textAlign: "center", padding: "16px 0" }}>Nothing in the library matches "{q}".</p>}
      {Object.entries(grouped).map(([g, items]) => (
        <div key={g} className="section">
          <div className="lbl group-lbl">{g}</div>
          {items.map((e) => (
            <button key={e.n} className="lib-row" onClick={() => onPick({ n: e.n, sets: e.sets, reps: e.reps, rest: e.rest, cue: "" })}>
              <span style={{ flex: 1 }}><span className="name">{e.n}</span><span className="sub">{e.sets} × {e.reps[0]}–{e.reps[1]} · {e.rest}s rest</span></span>
              <Plus size={18} aria-hidden="true" />
            </button>
          ))}
        </div>
      ))}
      <button className="btn btn-ink" onClick={() => setCustom({ n: q.trim(), sets: 3, min: 8, max: 12, rest: 90, cue: "" })}>
        <Plus size={18} aria-hidden="true" /> {q.trim() ? `Create "${q.trim()}"` : "Create your own"}
      </button>
    </Sheet>
  );
}

/** Shown when the account can't be reached on launch and this phone has no copy yet. */
export function LoadError({ onRetry }) {
  return (
    <main className="boot" role="alert">
      <div className="wordmark">IRONLOG</div>
      <p className="muted" style={{ maxWidth: 280, textAlign: "center" }}>Couldn't load your log. Check your connection and try again. Nothing has been changed.</p>
      <button className="btn btn-ink" style={{ width: "auto" }} onClick={onRetry}>Try again</button>
    </main>
  );
}

/** Persistent note while changes are saved on this phone but not yet in the account. */
export function SyncNote({ raised }) {
  return (
    <div className={"sync-note" + (raised ? " raised" : "")} role="status">
      Offline · saved on this phone, will sync when you're back online
    </div>
  );
}
