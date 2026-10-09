import { useEffect, useState, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { reducedMotion } from "./motion.js";

const TABS = ["today", "nutrition", "progress", "settings"];

/** The History tab became Progress → Workouts: rewrite old links in place so the address matches. */
const upgrade = () => { if (/^#\/?history\/?$/.test(location.hash)) history.replaceState(history.state, "", "#/progress/workouts"); };

export function parse(hash) {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [name = "today", a, b] = parts;
  switch (name) {
    case "session": return { name, day: a, id: b };
    case "summary": return { name, id: a };
    case "review": return { name, id: a }; // a week in review, by the date it ends
    case "lift": return { name, lift: a };
    case "coaches": return { name, coach: a, mode: b };
    case "settings":
      if (a === "program") return { name: "program", day: b };
      if (a === "export") return { name: "export" };
      return { name: "settings" };
    case "progress": return { name, open: a };
    case "nutrition": return { name, open: a }; // open: "setup" for Tank's targets chat
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
   "forward" when drilling in, "back" when coming out, "tab" between the tabs (they settle in place).
   None when the screen underneath stays put (a sheet or the week in review opening over it: those
   animate themselves), with reduced motion, or when the browser already animated a swipe back. */
const isTab = (r) => TABS.includes(r.name);
const screenOf = (r) => {
  if (r.name === "review") return "today"; // the week in review opens over Today
  if (r.name === "nutrition") return "nutrition"; // #/nutrition/setup is a sheet over it
  if (r.name === "progress") return r.open === "workouts" ? "progress/workouts" : "progress"; // #/progress/phase is a sheet over Trends
  return [r.name, r.day, r.id, r.lift, r.coach].filter(Boolean).join("/");
};
function navKind(from, to, dir) {
  if (screenOf(from) === screenOf(to)) return null;
  if (isTab(from) && isTab(to)) return "tab";
  return dir || (isTab(to) ? "back" : "forward"); // a replace has no history to go by: out to a tab is back
}

/** Hash routing so the phone's back gesture and browser back stay inside the app. */
export function useRoute() {
  const [route, setRoute] = useState(() => { upgrade(); return parse(location.hash); });
  const shown = useRef(route);
  const show = useCallback((next, dir, uaAnimated = false) => {
    const nav = navKind(shown.current, next, dir);
    shown.current = next;
    if (!nav || uaAnimated || !document.startViewTransition || reducedMotion()) { setRoute(next); return; }
    document.documentElement.dataset.nav = nav;
    document.startViewTransition(() => flushSync(() => setRoute(next)));
  }, []);

  useEffect(() => {
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
