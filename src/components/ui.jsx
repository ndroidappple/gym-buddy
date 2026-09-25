import React, { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Home, CalendarDays, TrendingUp, Settings as Gear, Plus, Info } from "lucide-react";
import { HELP } from "../data/help.js";
import { vibrate } from "../lib/util.js";
import { LIBRARY, specLine } from "../data/program.js";

/* iOS lays the keyboard over the page instead of resizing it. The sheet follows the visible
   viewport instead, so the keyboard pushes it up rather than covering it. */
function useVisibleViewport(wrap) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = wrap.current;
    if (!vv || !el) return;
    const fit = () => {
      el.style.setProperty("--vv-top", `${vv.offsetTop}px`);
      el.style.setProperty("--vv-h", `${vv.height}px`);
      el.toggleAttribute("data-kb", window.innerHeight - vv.height > 120);
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); };
  }, [wrap]);
}

export function Sheet({ title, sub, onClose, children, labelledBy = "sheet-title", className = "" }) {
  const ref = useRef(null);
  const wrap = useRef(null);
  useVisibleViewport(wrap);
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
  // Portalled to <body>: a sheet opened from a sticky header would otherwise sit under the tab bar.
  return createPortal((
    <div className="sheet-wrap" ref={wrap} onClick={onClose}>
      <div className={"sheet " + className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
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
  ), document.body);
}

/** The (i) in a screen's header: opens a short sheet on what the screen is for. */
export function InfoButton({ screen }) {
  const [open, setOpen] = useState(false);
  const h = HELP[screen];
  if (!h) return null;
  return (
    <>
      <button className="icon-btn info-btn" onClick={() => setOpen(true)} aria-label={`About ${h.title}`}><Info size={20} strokeWidth={2.4} /></button>
      {open && (
        <Sheet title={h.title} sub={h.sub} onClose={() => setOpen(false)} labelledBy="info-title">
          <ul className="info-list">{h.points.map((p) => <li key={p}>{p}</li>)}</ul>
          <button className="btn btn-ink" onClick={() => setOpen(false)}>Got it</button>
        </Sheet>
      )}
    </>
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

/* Tab bar. Switches on finger-down, not on release: a tap snaps the pill to the nearest tab. Hold
   (or clearly slide) and the pill follows the finger, opening each tab you cross. Tab switches replace the
   history entry, so the back gesture never replays a string of tab taps.
   The active tab gets a wider column so its label has room inside the pill. Tab geometry is
   computed from the bar's width (not measured) so the pill lands right while the columns animate. */
const TAB_PAD = 7, TAB_GAP = 4, ACTIVE_FR = 2; // keep in sync with .tabbar padding and gap
const HOLD_MS = 200, DRAG_SLOP = 12; // hold time / finger travel (px) before the pill follows the finger
function tabGeometry(navW, idx) {
  const unit = (navW - 2 * TAB_PAD - TAB_GAP * (TABS.length - 1)) / (TABS.length - 1 + ACTIVE_FR);
  let left = TAB_PAD;
  return TABS.map((_, i) => {
    const width = i === idx ? unit * ACTIVE_FR : unit;
    const g = { left, width };
    left += width + TAB_GAP;
    return g;
  });
}

export function TabBar({ active, onSelect }) {
  const nav = useRef(null);
  const [navW, setNavW] = useState(0);
  const [drag, setDrag] = useState(null); // pill centre x while a finger is down
  const idx = Math.max(0, TABS.findIndex((t) => t.key === active));
  const geo = navW ? tabGeometry(navW, idx) : null;

  useLayoutEffect(() => {
    const measure = () => setNavW(nav.current.clientWidth);
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, []);

  const keyAt = (x) => {
    const px = x - nav.current.getBoundingClientRect().left;
    const i = geo ? geo.findIndex((t) => px < t.left + t.width + TAB_GAP / 2) : 0;
    return TABS[i < 0 ? TABS.length - 1 : i].key;
  };
  const pick = (key) => { if (key !== active) { onSelect(key); vibrate(6); } };

  // A tap snaps the pill to the tab under the finger. Free dragging starts only after a short
  // hold, or once the finger clearly travels, so a slightly wobbly tap never drags the pill.
  const press = useRef(null); // { startX, x, timer } while a finger is down
  const relX = (clientX) => clientX - nav.current.getBoundingClientRect().left;
  const startDrag = () => { const p = press.current; if (!p) return; clearTimeout(p.timer); p.dragging = true; setDrag(relX(p.x)); vibrate(4); };
  const down = (e) => {
    if (e.button > 0) return;
    nav.current.setPointerCapture(e.pointerId);
    if (press.current) clearTimeout(press.current.timer);
    press.current = { id: e.pointerId, startX: e.clientX, x: e.clientX, dragging: false, timer: setTimeout(startDrag, HOLD_MS) };
    pick(keyAt(e.clientX));
  };
  const move = (e) => {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return; // ignore other fingers and a hovering mouse
    p.x = e.clientX;
    if (!p.dragging) { if (Math.abs(e.clientX - p.startX) < DRAG_SLOP) return; startDrag(); }
    setDrag(relX(e.clientX));
    pick(keyAt(e.clientX));
  };
  const up = (e) => {
    if (!press.current || e.pointerId !== press.current.id) return;
    clearTimeout(press.current.timer);
    press.current = null;
    setDrag(null);
  };
  useEffect(() => () => { if (press.current) clearTimeout(press.current.timer); }, []);

  const g = geo?.[idx];
  const w = g?.width || 0;
  const maxX = geo ? geo[geo.length - 1].left : 0;
  const x = drag != null && geo ? Math.min(maxX, Math.max(geo[0].left, drag - w / 2)) : g?.left || 0;
  return (
    <nav className={"tabbar" + (drag != null ? " dragging" : "")} aria-label="Main" ref={nav}
      style={{ gridTemplateColumns: TABS.map((_, i) => (i === idx ? `${ACTIVE_FR}fr` : "1fr")).join(" ") }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>
      {g && <span className="tab-pill" aria-hidden="true" style={{ width: w, transform: `translateX(${x}px)` }} />}
      {TABS.map(({ key, label, Icon }) => (
        <a key={key} className="tab" href={`#/${key}`} aria-current={active === key ? "page" : undefined}
          // Pointer input already switched on press; this handles keyboard activation only.
          onClick={(e) => { e.preventDefault(); if (e.detail === 0) pick(key); }}>
          <Icon size={21} strokeWidth={2.4} aria-hidden="true" />
          <span className="tab-label">{label}</span>
        </a>
      ))}
    </nav>
  );
}

export function Boot() {
  return (
    <div className="boot" role="status" aria-label="Loading GymBuddy">
      <div className="plates" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="wordmark">GymBuddy</div>
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
              <span style={{ flex: 1 }}><span className="name">{e.n}</span><span className="sub">{specLine(e)}</span></span>
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
      <div className="wordmark">GymBuddy</div>
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
