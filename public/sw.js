/* GymBuddy service worker. Only here for notifications: it shows the pushes the server sends (a
   rest timer ending, api/rest-alert.js; the week in review being ready, api/review.js) and opens
   the app when one is tapped. It doesn't cache anything, so the app always loads fresh. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
