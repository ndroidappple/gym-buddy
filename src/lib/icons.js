/* Home screen icons. PNGs live in public/icons/<id>/ (180 for iOS, 192/512 for the manifest).
   A web app can't change an icon that's already on the home screen: iOS copies it once, at
   Add to Home Screen. So picking one here changes what the next Add to Home Screen gets. */
export const ICONS = [
  { id: "plates", label: "Plates" },
  { id: "tank", label: "Tank", coach: "tank" },
  { id: "wings", label: "Wings", coach: "wings" },
  { id: "boulder", label: "Boulder", coach: "boulder" },
  { id: "piston", label: "Piston", coach: "piston" },
  { id: "brick", label: "Brick", coach: "brick" },
  { id: "dash", label: "Dash", coach: "dash" },
  { id: "classic", label: "Classic" },
];
const KEY = "ironlog-icon";
export const iconSrc = (id, size = 180) => `/icons/${id}/${size}.png`;

/** Points the page's icon links at the chosen icon and remembers it on this device for the next launch. */
export function applyIcon(id) {
  if (!ICONS.some((i) => i.id === id)) id = "plates";
  try { localStorage.setItem(KEY, id); } catch {}
  const set = (rel, href) => { const l = document.querySelector(`link[rel="${rel}"]`); if (l && l.getAttribute("href") !== href) l.setAttribute("href", href); };
  set("apple-touch-icon", iconSrc(id, 180));
  set("icon", iconSrc(id, 192));
  set("manifest", `/icons/${id}/manifest.webmanifest`);
}

/** Before first paint: reuse this device's last choice so the links are right even before sign-in. */
export function applySavedIcon() {
  let id = null;
  try { id = localStorage.getItem(KEY); } catch {}
  if (id) applyIcon(id);
}
