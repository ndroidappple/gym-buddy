import { useEffect, useState } from "react";

/* Light or dark, chosen in Settings (dark by default). Stored on the device so the first
   paint is right before sign-in, and in the account prefs so it follows you. */
const KEY = "ironlog-theme";
const BG = { dark: "#121117", light: "#F5F2ED" };
const EVENT = "ironlog-theme";

export const currentTheme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

export function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  try { localStorage.setItem(KEY, t); } catch {}
  if (document.documentElement.dataset.theme === t) return;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BG[t]);
  dispatchEvent(new Event(EVENT));
}

export function applySavedTheme() {
  let t = null;
  try { t = localStorage.getItem(KEY); } catch {}
  document.documentElement.dataset.theme = ""; // force applyTheme to write the meta too
  applyTheme(t || "dark");
}

/** The live theme, for effects that take a theme prop (border beam, metal, orbs). */
export function useTheme() {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => {
    const on = () => setTheme(currentTheme());
    addEventListener(EVENT, on);
    return () => removeEventListener(EVENT, on);
  }, []);
  return theme;
}
