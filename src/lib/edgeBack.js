/* Swipe from the left edge to go back, on any screen with a back arrow in its header: the screen follows
   the finger, and letting go past a third of the way (or with a flick) presses that same arrow, so the
   swipe does exactly what the arrow does (its fallback screen, anything it checks first).

   Only in the home screen app on iPhone: there's no browser around it, so no swipe of its own. In Safari
   the browser already swipes back, and both would go back twice. Not over a sheet (it has its own drag
   down), and not on the tab screens (nothing to go back to).

   While the screen moves, it's a containing block for anything fixed inside it, so the bars pinned to
   the bottom (Finish, the rest timer) would jump; they fade out for the drag instead (styles.css,
   html[data-edge-drag]). The router is told the slide already happened, so it doesn't play its own
   back transition on top (lib/router.js, skipNextTransition). */
import { skipNextTransition } from "./router.js";
import { reducedMotion } from "./motion.js";

const EDGE = 24; // px from the left edge a swipe has to start within
const BACK = 'header.top button[aria-label^="Back"]';

const isIOS = () => /iP(hone|od|ad)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

export function installEdgeBack() {
  if (!isIOS() || !isStandalone()) return;
  const root = document.documentElement;
  let g = null; // { el, btn, x0, y0, t0, dx, on, under }

  const reset = (el, animate) => {
    el.style.transition = animate ? "translate 220ms cubic-bezier(.2, .8, .2, 1)" : "none";
    el.style.translate = "";
    const done = () => { el.style.transition = ""; el.classList.remove("edge-moving"); };
    if (animate) setTimeout(done, 240); else done();
  };
  const endUnder = (under) => { under.style.opacity = "0"; setTimeout(() => under.remove(), 240); };

  addEventListener("touchstart", (e) => {
    g = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > EDGE || document.querySelector(".sheet-wrap, .review")) return;
    const el = document.querySelector("main.screen");
    const btn = el?.querySelector(BACK);
    if (!btn) return;
    g = { el, btn, x0: t.clientX, y0: t.clientY, t0: performance.now(), dx: 0, on: false, under: null };
  }, { passive: true, capture: true });

  addEventListener("touchmove", (e) => {
    if (!g) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if (!g.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { g = null; return; } // a scroll, not a swipe
      if (dx < 10 || dx < Math.abs(dy) * 1.2) return;
      g.on = true;
      root.setAttribute("data-edge-drag", "");
      g.el.classList.add("edge-moving");
      g.el.style.transition = "none";
      // What's behind the screen while it moves: the page colour, a shade darker.
      g.under = Object.assign(document.createElement("div"), { className: "edge-under" });
      document.body.appendChild(g.under);
    }
    e.preventDefault(); // the page doesn't scroll while the screen is in your hand
    g.dx = Math.max(0, dx);
    g.el.style.translate = `${g.dx}px 0`;
    g.under.style.opacity = String(Math.max(0, 1 - g.dx / innerWidth));
  }, { passive: false, capture: true });

  const end = (cancelled) => {
    const s = g;
    g = null;
    if (!s?.on) return;
    root.removeAttribute("data-edge-drag");
    const v = s.dx / Math.max(1, performance.now() - s.t0); // px per ms
    const go = !cancelled && (s.dx > innerWidth / 3 || (v > 0.5 && s.dx > 40));
    if (!go) { reset(s.el, !reducedMotion()); endUnder(s.under); return; }
    // Off the right edge, then the arrow's own back.
    const finish = () => {
      skipNextTransition();
      const from = location.hash;
      s.btn.click();
      endUnder(s.under);
      // The screen behind takes over; if React kept this same element for it, put it back in place.
      // If nothing happened (the back was refused), slide it home.
      let settled = false;
      const settle = () => { if (settled) return; settled = true; reset(s.el, location.hash === from && !reducedMotion()); };
      addEventListener("hashchange", () => requestAnimationFrame(() => requestAnimationFrame(settle)), { once: true });
      setTimeout(settle, 600);
    };
    if (reducedMotion()) { finish(); return; }
    s.el.style.transition = "translate 180ms cubic-bezier(.2, .8, .2, 1)";
    s.el.style.translate = `${innerWidth}px 0`;
    setTimeout(finish, 180);
  };
  addEventListener("touchend", () => end(false), { capture: true });
  addEventListener("touchcancel", () => end(true), { capture: true });
}
