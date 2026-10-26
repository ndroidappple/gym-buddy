/* Starts the app and a phone-sized browser for the end-to-end tests, pointed at the fake backend.
   Needs a Chromium; set CHROMIUM_PATH if it isn't at /opt/pw-browsers/chromium. */
import { createServer } from "vite";
import { chromium, devices } from "playwright-core";
import { SUPABASE_URL, installFakeBackend } from "./fake-backend.mjs";

/** The app on a local dev server, its Supabase pointed at the fake. Returns { url, close }. */
export async function startApp() {
  // Vite hands VITE_* variables in the environment to the app, ahead of any .env file.
  process.env.VITE_SUPABASE_URL = SUPABASE_URL;
  process.env.VITE_SUPABASE_ANON_KEY = "e2e-anon-key";
  const server = await createServer({ logLevel: "error", server: { port: 0, strictPort: false, hmr: false } });
  await server.listen();
  return { url: server.resolvedUrls.local[0], close: () => server.close() };
}

export async function launch() {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
}

/**
 * A fresh iPhone-sized page, signed in, with its own fake backend (see installFakeBackend for `seed`).
 * Returns { page, backend, errors }: errors collects the page's uncaught exceptions and console errors.
 */
export async function openApp(browser, url, seed) {
  const { defaultBrowserType, ...iphone } = devices["iPhone 13"];
  // Service workers would fetch around the fakes; the app runs fine without one.
  const context = await browser.newContext({ ...iphone, serviceWorkers: "block" });
  const backend = await installFakeBackend(context, seed);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url);
  return { page, backend, errors, context };
}
