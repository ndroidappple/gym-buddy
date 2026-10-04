import { supabase } from "../supabase-client.js";

/* Rest alerts: a push notification when rest is over, so it arrives with the phone locked.
   A web app can't set a notification on the phone for later, so each rest timer schedules one on
   the server (supabase/migrations/*_rest_alerts.sql), which sends it through api/rest-alert.js.
   The choice is per phone (localStorage), like the notification permission it rests on. */

const KEY = "gymbuddy-rest-alerts"; // "on" | "off"; unset until the lifter has been asked
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, v); } catch {} };

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installed = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/** Registers the service worker that shows the alerts. Called once at startup. */
export function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

/**
 * This phone's state: "on" | "off" | "ask" (never decided) | "denied" (blocked in the phone's
 * settings) | "install" (an iPhone browser tab: alerts need the home screen app) | "unsupported".
 */
export function restAlertState() {
  if (!supported()) return ios() && !installed() ? "install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const v = read();
  if (v === "on") return Notification.permission === "granted" ? "on" : "off";
  return v === "off" ? "off" : "ask";
}

let keyP = null;
/** The server's public push key (fetched once; call early so a tap doesn't wait on it). */
export function warmRestAlerts() {
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
/** Subscribes this phone (or reuses its subscription) and saves it to the account, once per app run. */
function ensure() {
  synced ||= (async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(await warmRestAlerts()) }));
    const { endpoint: ep, keys } = sub.toJSON();
    const { error } = await supabase.rpc("save_push_subscription", { p_endpoint: ep, p_p256dh: keys.p256dh, p_auth: keys.auth });
    if (error) throw error;
    endpoint = ep;
  })();
  synced.catch(() => { synced = null; });
  return synced;
}

/** Turns alerts on from a tap. Resolves the new state; throws when the phone couldn't be saved (offline). */
export async function enableRestAlerts() {
  // Ask first, while the tap still counts: iOS only shows the prompt in response to one.
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { write("off"); return perm === "denied" ? "denied" : "off"; }
  await ensure();
  write("on");
  return "on";
}

/** "Not now": off on this phone, and not asked again (Settings can still turn it on). */
export const declineRestAlerts = () => write("off");

export async function disableRestAlerts() {
  write("off");
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const ep = endpoint || sub?.endpoint;
  endpoint = null;
  synced = null;
  if (ep) await supabase.rpc("forget_push_subscription", { p_endpoint: ep });
  await sub?.unsubscribe().catch(() => {});
}

// Calls run in order, so a quick +15 then Skip can't land on the server the other way round.
let chain = Promise.resolve();
const inOrder = (fn) => (chain = chain.then(fn, fn));

/**
 * Schedules this phone's alert `seconds` from now, replacing any earlier one. Resolves true when
 * it's set, false when it couldn't be (offline), null when alerts are off on this phone.
 */
export function scheduleRestAlert({ seconds, title, body, url }) {
  if (restAlertState() !== "on") return Promise.resolve(null);
  return inOrder(async () => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await ensure();
        const { data, error } = await supabase.rpc("schedule_rest_alert", { p_endpoint: endpoint, p_seconds: Math.max(1, Math.round(seconds)), p_title: title, p_body: body, p_url: url });
        if (error) return false;
        if (data) return true;
        synced = null; // this phone isn't saved for this account (signed in as someone else since): save it again
      }
      return false;
    } catch { return false; }
  });
}

/** Cancels this phone's pending alert, if any. */
export function cancelRestAlert() {
  // Checked in turn, not now: a schedule still on its way may be what sets the address.
  return inOrder(async () => {
    if (endpoint) await supabase.rpc("cancel_rest_alert", { p_endpoint: endpoint }).then(() => {}, () => {});
  });
}
