import { useEffect, useState, useCallback, useRef, startTransition } from "react";
import { flushSync } from "react-dom";
import { reducedMotion, MS, EXIT_MS } from "./motion.js";

const TABS = ["today", "nutrition", "progress", "settings"];

/** Old links, rewritten in place so the address matches: the History tab became Progress → Workouts,
    and food trends moved from Progress → Nutrition to Nutrition → Trends. */
const MOVED = [[/^#\/?history\/?$/, "#/progress/workouts"], [/^#\/?progress\/nutrition\/?$/, "#/nutrition/trends"]];
const upgrade = () => { const m = MOVED.find(([re]) => re.test(location.hash)); if (m) history.replaceState(history.state, "", m[1]); };

export function parse(hash) {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [name = "today", a, b] = parts;
  switch (name) {
    case "session": return { name, day: a, id: b };
    case "preview": return { name, day: a }; // a day's workout screen, looked through before starting
    case "summary": return { name, id: a, past: b === "view" }; // #/summary/<id>/view: opened from Workouts, not just finished
    case "review": return { name, id: a }; // a week in review, by the date it ends
    case "lift": return { name, lift: a };
    case "coaches": return { name, coach: a, mode: b };
    case "settings":
      if (a === "program") return { name: "program", day: b };
      if (a === "export") return { name: "export" };
      if (a === "ai") return { name: "ai" }; // AI assistants: connecting Claude, ChatGPT or Muse
      return { name: "settings" };
    case "progress": return a === "nutrition" ? { name: "nutrition", open: "trends" } : { name, open: a };
    // open: "trends" for the Trends view, "setup" for Tank's targets chat; #/nutrition/trends/<tile> drills into a scorecard tile.
    case "nutrition": return a === "trends" && b ? { name, open: a, detail: b } : { name, open: a };
    // The History tab is now Progress → Workouts; old links still land there.
    case "history": return { name: "progress", open: "workouts" };
    default: return TABS.includes(name) ? { name } : { name: "today" };
  }
}

export const href = (...parts) => "#/" + parts.map((p) => encodeURIComponent(p)).join("/");

/* Each in-app history entry carries its position, so "back" knows whether
   there's an app screen behind it or whether it would leave the app. */
const pos = () => history.state?.ironlogIdx ?? 0;
let counter = 0;

/* Screen changes play as a view transition (styles.css, "Route transitions"), marked on <html data-nav>:
   "forward" when drilling in, "back" when coming out. Switching tabs swaps the screen without one, like a
   native tab bar, and renders it as interruptible work: tap tabs in quick succession and each new tap
   drops the half-drawn screen for the latest, while the tab bar's pill (drawn first) never waits on it.
   None when the screen underneath stays put (a sheet or the week in review opening over it: those
   animate themselves), with reduced motion, or when the browser already animated a swipe back. */
const isTab = (r) => TABS.includes(r.name) && !r.detail; // a Trends tile drills in like any detail screen
const screenOf = (r) => {
  if (r.name === "review") return "today"; // the week in review opens over Today
  if (r.name === "nutrition") return r.open === "trends" ? ["nutrition/trends", r.detail].filter(Boolean).join("/") : "nutrition"; // #/nutrition/setup is a sheet over Day
  if (r.name === "progress") return r.open === "workouts" ? "progress/workouts" : "progress"; // #/progress/phase is a sheet over Trends
  return [r.name, r.day, r.id, r.lift, r.coach].filter(Boolean).join("/");
};
function navKind(from, to, dir) {
  if (screenOf(from) === screenOf(to)) return null;
  if (isTab(from) && isTab(to)) return "tab";
  return dir || (isTab(to) ? "back" : "forward"); // a replace has no history to go by: out to a tab is back
}

/* The next screen change was already animated by hand (an edge swipe back, lib/edgeBack.js): show it
   without a view transition, the way a swipe the browser animated is shown. */
let skipOnce = false;
export const skipNextTransition = () => { skipOnce = true; };

/** Hash routing so the phone's back gesture and browser back stay inside the app. */
export function useRoute() {
  const [route, setRoute] = useState(() => { upgrade(); return parse(location.hash); });
  const shown = useRef(route);
  const show = useCallback((next, dir, uaAnimated = false) => {
    if (skipOnce) { skipOnce = false; uaAnimated = true; }
    const nav = navKind(shown.current, next, dir);
    shown.current = next;
    if (nav) document.documentElement.dataset.nav = nav; // also stops the first screen's cascade replaying
    if (nav === "tab") { startTransition(() => setRoute(next)); return; }
    if (!nav || uaAnimated || !document.startViewTransition || reducedMotion()) { setRoute(next); return; }
    // The new screen starts at the top, and gets there before its snapshot is taken: a scroll that
    // moved during the capture (iOS restoring the old one on Back, or App's own reset a beat later)
    // could leave iOS's transition stuck on a blank screen under the tab bar (Nick, 2026-11-28: Back
    // from the AI assistants' Muse steps, a long page).
    const vt = document.startViewTransition(() => { window.scrollTo(0, 0); flushSync(() => setRoute(next)); });
    // A second navigation mid-animation skips this one; the screen still changes, so that's not an error.
    vt.ready.catch(() => {});
    // And if a transition still hasn't finished well after its longest animation, it's stuck: end it.
    // The page under it is already the new screen, so ending it just shows it.
    const stuck = setTimeout(() => vt.skipTransition?.(), Math.max(EXIT_MS, ...Object.values(MS)) + 600);
    vt.finished.catch(() => {}).finally(() => clearTimeout(stuck));
  }, []);

  useEffect(() => {
    // Every screen opens at the top (App resets it), so the browser restoring an old scroll on Back
    // only moves the page mid-transition. Off.
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    if (history.state?.ironlogIdx == null) history.replaceState({ ironlogIdx: 0 }, "");
    counter = pos();
    // A back swipe the browser animates itself says so on popstate, which comes just before hashchange.
    let uaAnimated = false;
    const onPop = (e) => { uaAnimated = !!e.hasUAVisualTransition; };
    const on = () => {
      upgrade();
      const before = counter;
      if (history.state?.ironlogIdx == null) history.replaceState({ ironlogIdx: ++counter }, "");
      else counter = pos();
      show(parse(location.hash), counter < before ? "back" : "forward", uaAnimated);
      uaAnimated = false;
    };
    addEventListener("popstate", onPop);
    addEventListener("hashchange", on);
    return () => { removeEventListener("popstate", onPop); removeEventListener("hashchange", on); };
  }, [show]);

  const go = useCallback((to, { replace = false } = {}) => {
    if (replace) { history.replaceState({ ironlogIdx: pos() }, "", to); show(parse(to)); return; }
    location.hash = to;
  }, [show]);

  const back = useCallback((fallback = "#/today") => {
    if (pos() > 0) { history.back(); return; }
    history.replaceState({ ironlogIdx: 0 }, "", fallback);
    show(parse(fallback), "back");
  }, [show]);

  return { route, go, back };
}
