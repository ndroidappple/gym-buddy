import { useLayoutEffect, useRef } from "react";
import { reducedMotion } from "./motion.js";

/* Switching tabs swaps the screen at once (no view transition: nothing to wait on, so rapid taps keep
   up, see lib/router.js). The new screen's content then fades in from nothing with a 10 px rise, the
   header first and the rest 50 ms behind it, on an even curve so the fade is seen, not just felt.
   Run on the compositor, so it never holds the next tap. Its content, not the screen itself: a
   transform there would carry the fixed fade behind the tab bar with it. A newer tab cancels the fade
   still running; drilling in and out keep their own slide; reduced motion swaps plainly. */
const TAB_FADE_MS = 280, STAGGER_MS = 50;
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
    running.current = parts.map((el, i) => el.animate(
      [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
      { duration: TAB_FADE_MS, delay: Math.min(i, 2) * STAGGER_MS, easing: "cubic-bezier(.33, .1, .25, 1)", fill: "backwards" },
    ));
  }, [key]);
}
