/* How much the app explains, chosen in Settings → Display:
   - "detailed": everything, including the grey lines that say what a thing is or how it went.
   - "focused": the same screens with those explanations taken out, and tighter rows.
   The difference is all CSS (styles.css, "Focused view"), keyed off <html data-view>. Text that only
   explains is marked `detail` in the markup; anything you need to act (numbers, errors, set progress)
   shows in both. Like the theme, it's kept on the device for the first paint and in the account prefs. */
const KEY = "ironlog-view";

export const VIEWS = [
  { id: "detailed", label: "Detailed", sub: "Every screen explains itself, with the grey context lines." },
  { id: "focused", label: "Focused", sub: "Just names, numbers and buttons. Less to read mid-workout." },
];

const valid = (v) => (v === "focused" ? "focused" : "detailed");

export function applyView(view) {
  const v = valid(view);
  try { localStorage.setItem(KEY, v); } catch {}
  document.documentElement.dataset.view = v;
}

export function applySavedView() {
  let v = null;
  try { v = localStorage.getItem(KEY); } catch {}
  applyView(v);
}
