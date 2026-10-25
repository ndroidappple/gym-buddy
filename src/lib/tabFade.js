import { useLayoutEffect, useRef } from "react";
import { reducedMotion } from "./motion.js";

/* Switching tabs swaps the screen at once (no view transition: nothing to wait on, so rapid taps keep
   up, see lib/router.js). The new screen's content then settles in: a short fade up from 35% with a
   6 px rise, run on the compositor, so it never holds the next tap. Its content, not the screen
   itself: a transform there would carry the fixed fade behind the tab bar with it. A newer tab cancels
   the fade still running; drilling in and out keep their own slide; reduced motion swaps plainly. */
const TAB_FADE_MS = 200;
/** Call once in App with the route (null until it shows) and the routes that have the tab bar. */
export function useTabFade(route, tabViews) {
  const last = useRef(null);
  const running = useRef([]);
  const key = route && tabViews.includes(route.name) && route.name !== "lift" ? `${route.name}/${route.open || ""}` : null;
  useLayoutEffect(() => {
    const before = last.current;
    last.current = key;
    const nav = document.documentElement.dataset.nav;
    if (!key || !before || before === key || nav === "forward" || nav === "back" || reducedMotion()) return;
    running.current.forEach((a) => a.cancel());
    const parts = [...(document.querySelector(".app > main.screen, .app main.screen")?.children || [])].filter((el) => !el.classList.contains("sheet-wrap"));
    running.current = parts.map((el) => el.animate(
      [{ opacity: 0.35, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
      { duration: TAB_FADE_MS, easing: "cubic-bezier(.2, .8, .2, 1)" },
    ));
  }, [key]);
}
