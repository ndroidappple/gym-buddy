import { useEffect, useState, useCallback } from "react";

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

/** Hash routing so the phone's back gesture and browser back stay inside the app. */
export function useRoute() {
  const [route, setRoute] = useState(() => { upgrade(); return parse(location.hash); });
  useEffect(() => {
    if (history.state?.ironlogIdx == null) history.replaceState({ ironlogIdx: 0 }, "");
    counter = pos();
    const on = () => {
      upgrade();
      if (history.state?.ironlogIdx == null) history.replaceState({ ironlogIdx: ++counter }, "");
      else counter = pos();
      setRoute(parse(location.hash));
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  const go = useCallback((to, { replace = false } = {}) => {
    if (replace) { history.replaceState({ ironlogIdx: pos() }, "", to); setRoute(parse(to)); return; }
    location.hash = to;
  }, []);

  const back = useCallback((fallback = "#/today") => {
    if (pos() > 0) { history.back(); return; }
    history.replaceState({ ironlogIdx: 0 }, "", fallback);
    setRoute(parse(fallback));
  }, []);

  return { route, go, back };
}
