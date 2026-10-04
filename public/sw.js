/* GymBuddy service worker. Only here for rest alerts: it shows the push the server sends when a
   rest timer ends (see api/rest-alert.js), and opens the app when the notification is tapped.
   It doesn't cache anything, so the app always loads fresh from the network. */

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
    // The app is usually still open in the background, on the workout: bring it forward as is.
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (open[0]) return open[0].focus();
    return self.clients.openWindow(e.notification.data?.url || "/");
  })());
});
