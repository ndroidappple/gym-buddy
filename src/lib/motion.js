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
   Keep EXIT_MS in step with the .leaving animations in styles.css. */
export const EXIT_MS = 200;
export const EXIT_EASE = "cubic-bezier(.4, 0, 1, 1)";

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
