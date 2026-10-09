import { supabase } from "../supabase-client.js";

/* Notifications on this phone: the permission, and the push address the server sends to. Rest
   alerts (restAlerts.js) and the week in review's "ready" notification (api/review.js) both use
   it. The address is saved to the account (push_subscriptions); the server sends a rest alert
   only when one was scheduled, and a review notification only when that's turned on. */

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installed = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/** Registers the service worker that shows notifications. Called once at startup. */
export function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

/**
 * Whether this phone can show notifications: "on" (allowed) | "ask" (never decided) | "denied"
 * (blocked in the phone's settings) | "install" (an iPhone browser tab: they need the home screen
 * app) | "unsupported".
 */
export function phoneState() {
  if (!pushSupported()) return ios() && !installed() ? "install" : "unsupported";
  return Notification.permission === "granted" ? "on" : Notification.permission === "denied" ? "denied" : "ask";
}

let keyP = null;
/** The server's public push key (fetched once; call early so a tap doesn't wait on it). */
export function warmPush() {
  keyP ||= fetch("/api/rest-alert").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))).then((j) => j.publicKey);
  keyP.catch(() => { keyP = null; });
  return keyP;
}
const toBytes = (b64) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

let endpoint = null; // this phone's push address, once saved for the signed-in lifter
let synced = null;
/** Subscribes this phone (or reuses its subscription) and saves it to the account, once per app run. Resolves the address. */
export function ensureSubscribed({ again = false } = {}) {
  if (again) synced = null;
  synced ||= (async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(await warmPush()) }));
    const { endpoint: ep, keys } = sub.toJSON();
    const { error } = await supabase.rpc("save_push_subscription", { p_endpoint: ep, p_p256dh: keys.p256dh, p_auth: keys.auth });
    if (error) throw error;
    endpoint = ep;
    return ep;
  })();
  synced.catch(() => { synced = null; });
  return synced;
}
export const savedEndpoint = () => endpoint;

/**
 * Asks to allow notifications (call straight from a tap: iOS only shows the prompt in response to
 * one), then saves this phone. Resolves the new phoneState(); throws when the phone couldn't be saved.
 */
export async function allowNotifications() {
  if (!pushSupported()) return phoneState();
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "ask";
  await ensureSubscribed();
  return "on";
}

/** Stops pushes to this phone: forgets its address on the account and unsubscribes it. */
export async function forgetPhone() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const ep = endpoint || sub?.endpoint;
  endpoint = null;
  synced = null;
  if (ep) await supabase.rpc("forget_push_subscription", { p_endpoint: ep });
  await sub?.unsubscribe().catch(() => {});
}
