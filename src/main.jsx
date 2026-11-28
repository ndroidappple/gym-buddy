import "./storage-polyfill.js"; // must run before App.jsx touches window.storage
import "./styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import AuthGate from "./Auth.jsx";
import OAuthConsent from "./OAuthConsent.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { applySavedTheme } from "./lib/theme.js";
import { applySavedIcon } from "./lib/icons.js";
import { applySavedView } from "./lib/view.js";
import { registerServiceWorker } from "./lib/restAlerts.js";
import { installMotion } from "./lib/motion.js";
import { installKeyboardWatch } from "./lib/keyboard.js";

// Before first paint: this device's theme (dark by default), detail level and home screen icon.
applySavedTheme();
applySavedView();
applySavedIcon();
installMotion(); // the spring easings styles.css animates with
registerServiceWorker(); // shows rest alerts
installKeyboardWatch(); // keeps the rest timer and other bottom bars clear of the keyboard and on the bottom edge

// Pinch-zoom stays on: the text is sized in px and doesn't follow the phone's text size, so zooming is
// the only way to make it bigger (WCAG 1.4.4, audit 2026-11-28). Double-tap zoom is still off
// (touch-action: manipulation in styles.css), so a quick double tap on a stepper never zooms.
// iOS only shows :active press styles when the page listens for touches.
document.addEventListener("touchstart", () => {}, { passive: true });

// /oauth/consent: approving a connection from an AI app (api/mcp.js). Sign-in first, then only the consent screen.
const consent = location.pathname === "/oauth/consent";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthGate>
      <ErrorBoundary>
        {consent ? <OAuthConsent /> : <App />}
      </ErrorBoundary>
    </AuthGate>
  </React.StrictMode>
);
