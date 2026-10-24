import { useEffect, useRef, useState } from "react";

/** Live prefers-reduced-motion. Border beam's line type ignores it, so callers gate `active` with this. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = (e) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** prefers-reduced-motion right now, for code outside render (gestures, exits). */
export const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/* Exits run quicker than entrances and speed up as they go, so closing feels immediate.
   CSS gets these as --exit-ms and --exit. */
export const EXIT_MS = 200;
export const EXIT_EASE = "cubic-bezier(.4, 0, 1, 1)";

/* ── Springs ──
   Everything that arrives or moves rides one of a few damped springs, named for what moves.
   f is how quick (Hz); z is the damping: 1 settles without overshoot, lower lands with a little give.
   Whole surfaces get slower springs than the small things on them, so a screen glides in while a
   check pops. CSS gets each as a linear() easing and a duration (--enter, --enter-ms, ...), JS as
   EASE.enter and MS.enter. A browser without linear() gets a close cubic-bezier instead. */
const SPRINGS = {
  enter: { f: 3.6, z: 1, fallback: "cubic-bezier(.16, 1, .3, 1)" },       // content arriving
  pop: { f: 3, z: 0.7, fallback: "cubic-bezier(.2, 1.5, .4, 1)" },        // small things landing: checks, chips, bubbles
  slide: { f: 3.4, z: 0.78, fallback: "cubic-bezier(.3, 1.3, .5, 1)" },   // controls moving across: switches, swiped rows
  snap: { f: 5.5, z: 0.82, fallback: "cubic-bezier(.25, 1.2, .5, 1)" },   // the tab pill and tabs: keeps up with a finger
  // Not "surface": --surface is the card color in styles.css, and these go on :root as --<name>.
  glide: { f: 1.9, z: 0.9, fallback: "cubic-bezier(.2, 1, .3, 1)" },      // whole surfaces: screens, sheets, docks
};

/** Closed-form step response of a damped spring released at 0 and settling on 1, t in seconds. */
function spring(t, f, z) {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * f;
  if (z >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}

/** How long until the spring stays within 0.2% of where it lands, in whole ms. */
function settleMs(f, z) {
  let last = 0;
  for (let ms = 0; ms <= 3000; ms++) if (Math.abs(1 - spring(ms / 1000, f, z)) >= 0.002) last = ms;
  return last + 1;
}

const linearOk = typeof CSS !== "undefined" && CSS.supports?.("transition-timing-function", "linear(0, 1)");
export const MS = {}, EASE = {};
for (const [name, { f, z, fallback }] of Object.entries(SPRINGS)) {
  const ms = settleMs(f, z);
  const steps = Math.ceil(ms / 10); // a point every ~10 ms is enough to keep the curve smooth
  MS[name] = ms;
  EASE[name] = linearOk
    ? `linear(${Array.from({ length: steps + 1 }, (_, i) => (i === steps ? 1 : +spring((i / steps) * ms / 1000, f, z).toFixed(4))).join(", ")})`
    : fallback;
}

/** Puts the springs (and the exit curve) on :root for styles.css. Runs once, before the first render. */
export function installMotion() {
  const s = document.documentElement.style;
  for (const name of Object.keys(SPRINGS)) {
    s.setProperty(`--${name}`, EASE[name]);
    s.setProperty(`--${name}-ms`, `${MS[name]}ms`);
  }
  s.setProperty("--exit", EXIT_EASE);
  s.setProperty("--exit-ms", `${EXIT_MS}ms`);
}

/**
 * Keeps something on screen while it plays its leaving animation. Give it the value that decides
 * whether the thing shows (an object, a number, true); when that turns falsy, the last value stays
 * for EXIT_MS with leaving = true. Returns [shown, leaving]. With reduced motion it leaves at once.
 */
export function usePresence(value, ms = EXIT_MS) {
  const last = useRef(value || null);
  const [leaving, setLeaving] = useState(false);
  if (value) {
    last.current = value;
    if (leaving) setLeaving(false); // back before it finished leaving
  } else if (last.current && !leaving) {
    if (reducedMotion()) last.current = null;
    else setLeaving(true);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => { last.current = null; setLeaving(false); }, ms);
    return () => clearTimeout(t);
  }, [leaving, ms]);
  return value ? [value, false] : leaving ? [last.current, true] : [null, false];
}

/**
 * Rolls a field to the value it now shows, the way <Roll> does for text: a copy of the old value
 * slides out one way while the field slides in from the other (dir 1 up, as a number grows; -1 down).
 * For inputs, whose text can't be split into digits. The field's parent must be positioned.
 */
const rolling = new WeakMap();
export function rollField(el, oldText, dir) {
  if (!el?.animate || reducedMotion()) return;
  const s = getComputedStyle(el);
  const ghost = document.createElement("span");
  ghost.textContent = oldText;
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "absolute", left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, width: `${el.offsetWidth}px`, height: `${el.offsetHeight}px`,
    fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, fontStyle: s.fontStyle, fontVariantNumeric: s.fontVariantNumeric,
    letterSpacing: s.letterSpacing, color: s.color, textAlign: s.textAlign, lineHeight: `${el.offsetHeight}px`, pointerEvents: "none",
  });
  el.parentElement.appendChild(ghost);
  const away = { transform: `translateY(${-dir * 0.35}em)`, opacity: 0, filter: "blur(2px)" };
  const from = { transform: `translateY(${dir * 0.35}em)`, opacity: 0, filter: "blur(2px)" };
  const rest = { transform: "none", opacity: 1, filter: "blur(0)" };
  ghost.animate([rest, away], { duration: 140, easing: "ease-out", fill: "forwards" }).finished.catch(() => {}).then(() => ghost.remove());
  rolling.get(el)?.cancel(); // a quick second tap starts over from the new value
  rolling.set(el, el.animate([from, rest], { duration: MS.enter, easing: EASE.enter, delay: 30, fill: "backwards" }));
}

/**
 * Shrinks an element away (height, padding, margins and opacity to nothing) so whatever is below
 * glides up instead of jumping. Resolves when done; the element stays collapsed until it's removed.
 */
export function collapse(el, ms = EXIT_MS + 40) {
  if (!el || reducedMotion() || !el.animate) return Promise.resolve();
  const s = getComputedStyle(el);
  const keep = { height: `${el.offsetHeight}px`, paddingTop: s.paddingTop, paddingBottom: s.paddingBottom, marginTop: s.marginTop, marginBottom: s.marginBottom, opacity: s.opacity };
  const gone = { height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: "0px", marginBottom: "0px", opacity: 0 };
  el.style.overflow = "hidden";
  return el.animate([keep, gone], { duration: ms, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "forwards" }).finished.catch(() => {});
}
