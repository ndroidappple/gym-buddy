import React, { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { createPortal, flushSync } from "react-dom";
import { X, Home, TrendingUp, Settings as Gear, Utensils, Plus, Info, ChevronLeft, ArrowUpRight } from "lucide-react";
import { HELP } from "../data/help.js";
import { vibrate } from "../lib/util.js";
import { reducedMotion, usePresence, EXIT_MS, EXIT_EASE } from "../lib/motion.js";
import { LIBRARY, specLine } from "../data/program.js";
import Coach from "./Coach.jsx";

/* iOS lays the keyboard over the page instead of resizing it. The sheet follows the visible
   viewport instead, so the keyboard pushes it up rather than covering it. */
function useVisibleViewport(wrap) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = wrap.current;
    if (!vv || !el) return;
    // Newer iOS shrinks innerHeight along with the visual viewport, so the height gap alone can
    // miss the keyboard. On touch screens a focused text field inside the sheet means it's up.
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const typing = () => touch && el.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    const fit = () => {
      el.style.setProperty("--vv-top", `${vv.offsetTop}px`);
      el.style.setProperty("--vv-h", `${vv.height}px`);
      el.toggleAttribute("data-kb", window.innerHeight - vv.height > 120 || typing());
    };
    // focusout fires before focus lands elsewhere; wait a tick so moving between fields doesn't flicker.
    const blur = () => setTimeout(fit, 0);
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    el.addEventListener("focusin", fit);
    el.addEventListener("focusout", blur);
    return () => {
      vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit);
      el.removeEventListener("focusin", fit); el.removeEventListener("focusout", blur);
    };
  }, [wrap]);
}

/* Leaving: a sheet's parent closes it by not rendering it any more (from many places: Save, Cancel,
   a confirm, a route change), so the sheet can't hold itself open to animate. Instead, just before
   React removes it, it leaves a copy behind that slides down while the scrim fades, then goes. */
function copyForExit(node) {
  const copy = node.cloneNode(true);
  // What cloneNode doesn't carry: scroll positions, typed text, ticks, and the camera's frame.
  const from = node.querySelectorAll("*"), to = copy.querySelectorAll("*");
  const scrolls = [];
  from.forEach((el, i) => {
    if (el.scrollTop || el.scrollLeft) scrolls.push([to[i], el.scrollTop, el.scrollLeft]);
    if (el.matches("input:not([type=file]), textarea, select")) { to[i].value = el.value; to[i].checked = el.checked; }
    if (el.tagName === "VIDEO" && el.videoWidth) {
      const c = document.createElement("canvas");
      c.width = el.videoWidth; c.height = el.videoHeight; c.className = el.className;
      c.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
      try { c.getContext("2d").drawImage(el, 0, 0); to[i].replaceWith(c); } catch {}
    }
  });
  return { copy, scrolls };
}
function playExit({ copy, scrolls }) {
  copy.classList.add("sheet-leaving");
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  copy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  // Under any sheet that's opening as this one goes, so the new one is on top.
  document.body.insertBefore(copy, document.body.querySelector(":scope > .sheet-wrap"));
  for (const [el, top, left] of scrolls) { el.scrollTop = top; el.scrollLeft = left; }
  const sheet = copy.querySelector(".sheet"), scrim = copy.querySelector(".sheet-scrim");
  const at = getComputedStyle(sheet).transform; // where a drag left it, or none
  const opts = { duration: EXIT_MS + 20, easing: EXIT_EASE, fill: "forwards" };
  sheet.animate([{ transform: at === "none" ? "translateY(0)" : at }, { transform: "translateY(100%)" }], opts)
    .finished.catch(() => {}).then(() => copy.remove());
  scrim?.animate([{ opacity: getComputedStyle(scrim).opacity }, { opacity: 0 }], opts);
  setTimeout(() => copy.remove(), EXIT_MS + 400); // in case the animation never reports back
}
function useExitCopy(wrap) {
  const pending = useRef(null);
  useLayoutEffect(() => {
    // StrictMode (dev) unmounts and remounts once on open: that's not a close, so drop its copy.
    if (pending.current) pending.current.cancelled = true;
    const node = wrap.current;
    return () => {
      // Layout cleanup runs while the sheet is still in the page, scrolled where it was.
      if (!node?.isConnected || reducedMotion() || !node.animate) return;
      const job = { cancelled: false, snap: copyForExit(node) };
      pending.current = job;
      queueMicrotask(() => { if (!job.cancelled) playExit(job.snap); });
    };
  }, [wrap]);
}

/* Drag down to close, from the grab bar and header, or from the content when it's scrolled to the
   top. Text fields, sliders and charts keep their own gestures. Far enough or fast enough closes;
   otherwise it springs back. Touch only: a mouse has the ✕, Escape and the scrim. */
const DRAG_START = 8, DRAG_CLOSE = 140, FLICK = 0.5; // px, px, px/ms
function useDragToClose(sheetRef, wrapRef, close) {
  useEffect(() => {
    const sheet = sheetRef.current, wrap = wrapRef.current;
    const scrim = wrap?.querySelector(".sheet-scrim");
    if (!sheet || !wrap) return;
    let g = null;
    const settle = () => {
      const at = sheet.style.transform;
      sheet.style.transform = "";
      if (scrim) scrim.style.opacity = "";
      if (at && !reducedMotion()) sheet.animate([{ transform: at }, { transform: "translateY(0)" }], { duration: 260, easing: "cubic-bezier(.2, 1.2, .35, 1)" });
    };
    const start = (e) => {
      g = null;
      if (e.touches.length !== 1) return;
      const t = e.target;
      if (t.closest("input, textarea, select, [contenteditable], .scrub, [data-no-drag]")) return;
      for (let el = t; el && el !== sheet; el = el.parentElement) if (el.scrollTop > 0) return; // scroll back up first
      const p = e.touches[0];
      g = { x: p.clientX, y: p.clientY, dy: 0, on: null, trail: [] };
    };
    const move = (e) => {
      if (!g || g.on === false) return;
      const p = e.touches[0];
      if (g.on === null) {
        const dx = p.clientX - g.x, dy = p.clientY - g.y;
        if (Math.hypot(dx, dy) < DRAG_START) return;
        g.on = dy > 0 && dy > Math.abs(dx);
        if (!g.on) return;
        g.y += DRAG_START; // the dead zone doesn't count, so the sheet doesn't jump when it starts following
        sheet.classList.add("dragging");
      }
      e.preventDefault(); // the page and the sheet's content stay put while the sheet moves
      g.dy = Math.max(0, p.clientY - g.y);
      sheet.style.transform = `translateY(${g.dy}px)`;
      if (scrim) scrim.style.opacity = String(1 - Math.min(1, g.dy / sheet.offsetHeight));
      g.trail.push([p.clientY, e.timeStamp]);
      if (g.trail.length > 5) g.trail.shift();
    };
    const end = (e) => {
      const d = g;
      g = null;
      if (!d?.on) return;
      e.stopPropagation(); // a drag isn't also a tap or a swipe for what's inside (the help cards)
      sheet.classList.remove("dragging");
      const [a, b] = [d.trail[0], d.trail[d.trail.length - 1]];
      const speed = a && b && b[1] > a[1] ? (b[0] - a[0]) / (b[1] - a[1]) : 0;
      if (e.type === "touchend" && (d.dy > Math.min(DRAG_CLOSE, sheet.offsetHeight * 0.35) || (speed > FLICK && d.dy > 24))) {
        flushSync(() => close.current()); // closed now, so the exit copy starts from where the finger let go
        if (sheet.isConnected) settle(); // the parent kept it open after all
      } else settle();
    };
    sheet.addEventListener("touchstart", start, { passive: true });
    sheet.addEventListener("touchmove", move, { passive: false });
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
    return () => {
      sheet.removeEventListener("touchstart", start);
      sheet.removeEventListener("touchmove", move);
      sheet.removeEventListener("touchend", end);
      sheet.removeEventListener("touchcancel", end);
    };
  }, [sheetRef, wrapRef, close]);
}

export function Sheet({ title, sub, onClose, children, labelledBy = "sheet-title", className = "" }) {
  const ref = useRef(null);
  const wrap = useRef(null);
  useVisibleViewport(wrap);
  useExitCopy(wrap);
  const close = useRef(onClose);
  close.current = onClose;
  useDragToClose(ref, wrap, close);
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
      <div className="sheet-scrim" aria-hidden="true" />
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

/** Text with [Name] marked as an inline chip, so anything you can see or tap in the app stands out. */
function HelpText({ text }) {
  return text.split(/(\[[^\]]+\])/).map((part, i) =>
    part.startsWith("[") ? <span key={i} className="help-chip inline">{part.slice(1, -1)}</span> : part);
}

/* Points at a part of the screen: scrolls it into view and pulses a ring around it. */
function spotlight(el) {
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("help-spot");
  void el.offsetWidth; // restart the pulse if it's already running
  el.classList.add("help-spot");
  setTimeout(() => el.classList.remove("help-spot"), 2400);
}

/** The (i) in a screen's header: a short tap-through, one feature per card. A feature that's on
    screen gets a "Show me" chip that closes the sheet and points at it. */
export function InfoButton({ screen }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const swipe = useRef(null);
  const h = HELP[screen];
  if (!h) return null;
  const steps = h.steps;
  const step = steps[i];
  const last = i === steps.length - 1;
  const target = open && step.spot ? document.querySelector(`[data-help="${step.spot}"]`) : null;
  const close = () => { setOpen(false); setI(0); };
  const show = (e) => { e.stopPropagation(); close(); requestAnimationFrame(() => spotlight(target)); };
  const next = () => (last ? close() : setI(i + 1));
  const back = () => i > 0 && setI(i - 1);
  // The whole card is the tap target, like stories: tap for next, swipe either way.
  const onTouchStart = (e) => { swipe.current = { x: e.touches[0].clientX, moved: false }; };
  const onTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - (swipe.current?.x ?? 0);
    if (Math.abs(dx) < 40) return;
    swipe.current.moved = true; // the click that follows a swipe isn't a tap
    dx < 0 ? next() : back();
  };
  const onTap = () => { if (swipe.current?.moved) { swipe.current.moved = false; return; } next(); };
  const { Icon } = step;
  return (
    <>
      <button className="icon-btn info-btn" onClick={() => setOpen(true)} aria-label={`About ${h.title}`}><Info size={20} strokeWidth={2.4} /></button>
      {open && (
        <Sheet title={h.title} sub={`${i + 1} of ${steps.length}`} onClose={close} labelledBy="info-title" className="help-sheet">
          <div className="help-tap" onClick={onTap} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div className="help-card" key={i} aria-live="polite">
            {target ? (
              <button type="button" className="help-chip" onClick={show} aria-label={`${step.name}: show me`}>
                <Icon size={18} strokeWidth={2.6} aria-hidden="true" />{step.name}
                <span className="help-show">Show me<ArrowUpRight size={14} strokeWidth={3} aria-hidden="true" /></span>
              </button>
            ) : (
              <span className="help-chip"><Icon size={18} strokeWidth={2.6} aria-hidden="true" />{step.name}</span>
            )}
            <p className="help-text"><HelpText text={step.text} /></p>
          </div>
          <div className="help-dots" aria-hidden="true">
            {steps.map((_, j) => <span key={j} className={j === i ? "on" : ""} />)}
          </div>
          <p className="help-hint" aria-hidden="true">{last ? "Tap to finish" : "Tap anywhere for next"}</p>
          </div>
          <div className="btn-row help-nav">
            {i > 0 && <button type="button" className="btn btn-ghost help-back" onClick={back} aria-label="Back"><ChevronLeft size={20} strokeWidth={2.8} /></button>}
            <button type="button" className="btn btn-ink" onClick={next}>{last ? "Got it" : "Next"}</button>
          </div>
        </Sheet>
      )}
    </>
  );
}

/** `danger` (the default) is for deletes and resets; pass false for a confirm that loses nothing. */
export function ConfirmSheet({ title, body, confirm, onConfirm, onClose, danger = true }) {
  return (
    <Sheet title={title} sub={body} onClose={onClose} labelledBy="confirm-title">
      <div className="btn-row">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className={"btn " + (danger ? "btn-danger" : "btn-ink")} onClick={() => { onConfirm(); onClose(); }}>{confirm}</button>
      </div>
    </Sheet>
  );
}

export function Toast({ toast, onDismiss, raised }) {
  // Slides down and fades when it times out or Undo is tapped; a new message rises in its place.
  const [t, leaving] = usePresence(toast);
  return (
    <div aria-live="polite" className="sr-live">
      {t && (
        <div key={t.at} className={"toast" + (raised ? " raised" : "") + (leaving ? " leaving" : "")} role="status" inert={leaving ? "" : undefined}>
          <span className="msg">{t.msg}</span>
          {t.undo && <button onClick={() => { t.undo(); onDismiss(); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}

const ALL_TABS = [
  { key: "today", label: "Today", Icon: Home },
  { key: "nutrition", label: "Nutrition", Icon: Utensils }, // only while food tracking is on
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
function tabGeometry(TABS, navW, idx) {
  const unit = (navW - 2 * TAB_PAD - TAB_GAP * (TABS.length - 1)) / (TABS.length - 1 + ACTIVE_FR);
  let left = TAB_PAD;
  return TABS.map((_, i) => {
    const width = i === idx ? unit * ACTIVE_FR : unit;
    const g = { left, width };
    left += width + TAB_GAP;
    return g;
  });
}

export function TabBar({ active, onSelect, nutrition = false }) {
  const TABS = ALL_TABS.filter((t) => t.key !== "nutrition" || nutrition);
  const nav = useRef(null);
  const [navW, setNavW] = useState(0);
  const [drag, setDrag] = useState(null); // pill centre x while a finger is down
  const idx = Math.max(0, TABS.findIndex((t) => t.key === active));
  const geo = navW ? tabGeometry(TABS, navW, idx) : null;

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

export function Trend({ pct, help }) {
  if (pct == null) return <span className="trend flat" data-help={help}>baseline</span>;
  if (Math.abs(pct) < 1) return <span className="trend flat" data-help={help}>— {Math.abs(pct).toFixed(1)}%</span>;
  return <span className={"trend" + (pct < 0 ? " flat" : "")} data-help={help}>{pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%</span>;
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

/* Press and hold a chart to read it: after a short hold the nearest point is picked, and sliding
   the finger scrubs along the line. A quick swipe still scrolls the page. A mouse just hovers.
   xs are the points' x positions in the SVG's viewBox, W its width. */
const SCRUB_HOLD_MS = 250, SCRUB_SLOP = 10;
export function useScrub(xs, W, onRelease) {
  const [idx, setIdx] = useState(null);
  const ref = useRef(null);
  const [el, setEl] = useState(null); // the chart can mount after the hook (e.g. once a second weigh-in lands)
  const press = useRef(null); // { id, x0, y0, active, timer } while a finger is down
  const last = useRef(null);
  const swallowClick = useRef(false);
  const nearest = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    return xs.reduce((b, x, i) => (Math.abs(x - vx) < Math.abs(xs[b] - vx) ? i : b), 0);
  };
  const show = (i) => { if (last.current !== i) vibrate(4); last.current = i; setIdx(i); };
  const end = () => {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.timer);
    press.current = null;
    if (p.active) { swallowClick.current = true; setTimeout(() => { swallowClick.current = false; }, 400); onRelease?.(last.current); }
    last.current = null;
    setIdx(null);
  };
  // Once the hold has picked up, the finger belongs to the chart: stop the page from scrolling.
  // React's touch listeners are passive, so this one is added by hand.
  useEffect(() => {
    if (!el) return;
    const stop = (e) => { if (press.current?.active) e.preventDefault(); };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => { el.removeEventListener("touchmove", stop); if (press.current) clearTimeout(press.current.timer); };
  }, [el]);
  const attach = useRef((n) => { ref.current = n; setEl(n); }).current;
  const bind = {
    ref: attach,
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" || !xs.length) return;
      if (press.current) clearTimeout(press.current.timer);
      const p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, active: false };
      p.timer = setTimeout(() => { p.active = true; show(nearest(p.x)); }, SCRUB_HOLD_MS);
      press.current = p;
    },
    onPointerMove: (e) => {
      if (!xs.length) return;
      if (e.pointerType === "mouse") { show(nearest(e.clientX)); return; }
      const p = press.current;
      if (!p || e.pointerId !== p.id) return;
      p.x = e.clientX;
      if (p.active) show(nearest(e.clientX));
      else if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > SCRUB_SLOP) { clearTimeout(p.timer); press.current = null; }
    },
    onPointerUp: end,
    onPointerCancel: end,
    onPointerLeave: (e) => { if (e.pointerType === "mouse") { last.current = null; setIdx(null); } },
    onContextMenu: (e) => e.preventDefault(),
    onClickCapture: (e) => { if (swallowClick.current) { e.stopPropagation(); e.preventDefault(); } },
  };
  return [idx, bind];
}

/** Floating readout over a point at (x, y) in a W×H viewBox. It slides along its own width as x
    moves across, so it never hangs off either edge. */
export function ChartTip({ x, y, W, H, children }) {
  const px = (x / W) * 100;
  return (
    <div className="chart-tip" role="status" style={{ left: `${px}%`, top: `${(y / H) * 100}%`, transform: `translate(-${px}%, calc(-100% - 14px))` }}>
      {children}
    </div>
  );
}

/** Line chart drawn to scale. Points: {label, value, pr?}. Tap a dot, or hold and slide, to read it. */
export function LineChart({ points, format = (v) => v, height = 150, ariaLabel }) {
  const [sel, setSel] = useState(null);
  const W = 300, H = height, L = 34, R = 8, T = 10, B = 22;
  const vals = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const lo = ticks[0], hi = ticks[ticks.length - 1], span = hi - lo || 1;
  const x = (i) => L + (points.length === 1 ? (W - L - R) / 2 : (i / (points.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / span) * (H - T - B);
  const [scrub, bind] = useScrub(points.map((_, i) => x(i)), W, (i) => setSel(i));
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const area = `M${x(0)},${H - B} L${line.replace(/ /g, " L")} L${x(points.length - 1)},${H - B} Z`;
  const on = scrub ?? sel;
  const s = on != null ? points[on] : null;
  return (
    <div className="chart">
      <div className="scrub" {...bind}>
        {s && <ChartTip x={x(on)} y={y(s.value)} W={W} H={H}><b>{format(s.value)}{s.pr ? " · PR" : ""}</b><span>{s.label}</span></ChartTip>}
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} style={{ stroke: "var(--rule)", strokeWidth: 1 }} />
              <text x={L - 6} y={y(t) + 3.5} textAnchor="end" style={{ fill: "var(--mute)", fontSize: 10, fontWeight: 600 }}>{format(t)}</text>
            </g>
          ))}
          <path d={area} style={{ fill: "var(--day, var(--ink))", opacity: 0.12 }} />
          {s && <line x1={x(on)} x2={x(on)} y1={T} y2={H - B} style={{ stroke: "var(--mute)", strokeWidth: 1.5, strokeDasharray: "3 4" }} />}
          <polyline points={line} style={{ fill: "none", stroke: "var(--day, var(--ink))", strokeWidth: 3.5, strokeLinejoin: "round", strokeLinecap: "round" }} />
          {points.map((p, i) => (
            <g key={i} onClick={() => setSel(sel === i ? null : i)} style={{ cursor: "pointer" }}>
              <circle cx={x(i)} cy={y(p.value)} r="14" style={{ fill: "transparent" }} />
              <circle cx={x(i)} cy={y(p.value)} r={on === i ? 6 : p.pr ? 4.5 : 3.5}
                style={{ fill: p.pr ? "var(--day, var(--ink))" : "var(--surface)", stroke: "var(--day, var(--ink))", strokeWidth: 2 }} />
            </g>
          ))}
          <text x={x(0)} y={H - 5} textAnchor={points.length === 1 ? "middle" : "start"} style={{ fill: "var(--mute)", fontSize: 10, fontWeight: 600 }}>{points[0].label}</text>
          {points.length > 1 && <text x={x(points.length - 1)} y={H - 5} textAnchor="end" style={{ fill: "var(--mute)", fontSize: 10, fontWeight: 600 }}>{points[points.length - 1].label}</text>}
        </svg>
      </div>
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
          {[["sets", "Sets"], ["min", "Min reps"], ["max", "Max reps"], ["rest", "Rest (sec)"]].map(([k, l]) => (
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
export function SyncNote({ show, raised }) {
  const [on, leaving] = usePresence(show);
  if (!on) return null;
  return (
    <div className={"sync-note" + (raised ? " raised" : "") + (leaving ? " leaving" : "")} role="status">
      Offline · saved on this phone, will sync when you're back online
    </div>
  );
}

/** A screen with nothing to show yet: a coach, what will appear here, and the way to get it. */
export function EmptyState({ coach = "tank", title, children, action, href }) {
  return (
    <section className="card empty">
      <Coach id={coach} mood="idle" size={64} decorative />
      <h2 className="empty-title">{title}</h2>
      <p className="empty-text">{children}</p>
      {action && <a className="btn btn-ink empty-btn" href={href}>{action}</a>}
    </section>
  );
}
