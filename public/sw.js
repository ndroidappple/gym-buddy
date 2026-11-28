/* GymBuddy service worker.
   1. Notifications: it shows the pushes the server sends (a rest timer ending, api/rest-alert.js; the
      week in review being ready, api/review.js) and opens the app when one is tapped.
   2. The app shell, so the app opens with no signal (audit 2026-11-28, P-07). The page is network-first:
      online, every launch loads fresh exactly as before and the copy is updated; offline, the last copy
      opens and the app runs from the phone's saved data (lib/store.js). Built files under /assets/ have
      their hash in the name, so they never change: cache-first, and the ones no current page needs are
      dropped after each fresh load. Supabase and /api are never touched here. */

const SHELL = "gb-shell-v1";   // the page, icons, manifest
const ASSETS = "gb-assets-v1"; // hashed JS, CSS and WASM from the build
const FONTS = "gb-fonts-v1";   // Lexend from Google Fonts
const KEEP = [SHELL, ASSETS, FONTS];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  // The first install happens after the page already loaded, so fetch the shell now rather than waiting
  // for the next launch to fill the cache.
  e.waitUntil(refreshShell().catch(() => {}));
});
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("gb-") && !KEEP.includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;
    if (req.mode === "navigate") return e.respondWith(page(req, e));
    if (url.pathname.startsWith("/assets/")) return e.respondWith(cacheFirst(req, ASSETS));
    if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") return e.respondWith(staleWhileRevalidate(req, SHELL, e));
    return;
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") e.respondWith(staleWhileRevalidate(req, FONTS, e));
});

/** The page: the network when there is one (and the copy is updated), else the last copy. */
async function page(req, e) {
  try {
    const res = await fetch(req);
    if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
      const copy = res.clone();
      e.waitUntil((async () => {
        const html = await copy.clone().text();
        await (await caches.open(SHELL)).put("/", copy);
        await syncAssets(html);
      })().catch(() => {}));
    }
    return res;
  } catch {
    const cached = await caches.match("/", { cacheName: SHELL, ignoreVary: true });
    return cached || Response.error();
  }
}

async function refreshShell() {
  const res = await fetch("/", { cache: "no-store" });
  if (!res.ok) return;
  const html = await res.clone().text();
  await (await caches.open(SHELL)).put("/", res);
  await syncAssets(html);
  await cacheFonts(html);
}

/* Lexend, so an offline launch doesn't fall back to Helvetica: the stylesheet the page links and the
   font files it names. Kept fresh afterwards by the fetch handler. */
async function cacheFonts(html) {
  const cache = await caches.open(FONTS);
  for (const [, href] of html.matchAll(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/g)) {
    const url = href.replace(/&amp;/g, "&");
    if (await cache.match(url, ANY)) continue;
    const res = await fetch(url);
    if (!res.ok) continue;
    const css = await res.clone().text();
    await cache.put(url, res);
    for (const [, font] of css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) {
      if (!(await cache.match(font, ANY))) { const f = await fetch(font); if (f.ok) await cache.put(font, f); }
    }
  }
}

/* The build files a page needs: the ones its HTML names, and the lazy chunks those name in turn
   ("./ponyfill-….js"), cached if missing. Anything else in the cache is from an older build: dropped. */
async function syncAssets(html) {
  const cache = await caches.open(ASSETS);
  const want = new Set([...html.matchAll(/\/assets\/[\w.-]+/g)].map((m) => m[0]));
  const queue = [...want];
  while (queue.length) {
    const path = queue.shift();
    let res = await cache.match(path, ANY);
    if (!res) {
      // Lazy chunks (the barcode scanner's 1 MB of WASM) are cached when first used, not downloaded here.
      if (!html.includes(path)) continue;
      try { res = await fetch(path); } catch { continue; }
      if (!res.ok) continue;
      await cache.put(path, res.clone());
    }
    if (!/\.js$/.test(path)) continue;
    const text = await res.text();
    for (const m of text.matchAll(/["'`]\.\/([\w.-]+\.(?:js|css|wasm))["'`]/g)) {
      const p = `/assets/${m[1]}`;
      if (!want.has(p)) { want.add(p); queue.push(p); }
    }
  }
  for (const req of await cache.keys()) if (!want.has(new URL(req.url).pathname)) await cache.delete(req);
}

// Matched by URL alone: a module script asks with an Origin header the stored copy didn't have, and a
// Vary header on the response would otherwise make it a miss exactly when there's no network.
const ANY = { ignoreVary: true };

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req.url, ANY);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req.url, res.clone());
  return res;
}

async function staleWhileRevalidate(req, name, e) {
  const cache = await caches.open(name);
  const hit = await cache.match(req.url, ANY);
  const fresh = fetch(req).then((res) => { if (res.ok || res.type === "opaque") cache.put(req.url, res.clone()); return res; });
  if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh.catch(() => Response.error());
}

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data?.json() || {}; } catch {}
  // iOS cancels a web app's push permission if a push shows nothing, so always show one.
  // One tag for every rest alert: each new one replaces the last instead of piling up.
  e.waitUntil(self.registration.showNotification(d.title || "Rest over", {
    body: d.body || "Time for your next set.",
    tag: d.tag || "rest",
    data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const url = e.notification.data?.url || "/";
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (open[0]) {
      // A rest alert: the app is usually still open on the workout, so bring it forward as is.
      // Anything else (the week in review) goes where it points.
      if (e.notification.tag !== "rest") open[0].postMessage({ type: "open", url });
      return open[0].focus();
    }
    return self.clients.openWindow(url);
  })());
});
