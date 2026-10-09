import "./storage-polyfill.js"; // must run before App.jsx touches window.storage
import "./styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import AuthGate from "./Auth.jsx";
import { applySavedTheme } from "./lib/theme.js";
import { applySavedIcon } from "./lib/icons.js";
import { applySavedView } from "./lib/view.js";
import { registerServiceWorker } from "./lib/restAlerts.js";
import { installMotion } from "./lib/motion.js";

// Before first paint: this device's theme (dark by default), detail level and home screen icon.
applySavedTheme();
applySavedView();
applySavedIcon();
installMotion(); // the spring easings styles.css animates with
registerServiceWorker(); // shows rest alerts

// iOS Safari ignores user-scalable=no; block pinch-zoom so it behaves like a native app.
["gesturestart", "gesturechange"].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
// iOS only shows :active press styles when the page listens for touches.
document.addEventListener("touchstart", () => {}, { passive: true });
document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>
);
