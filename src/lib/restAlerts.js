import { supabase } from "../supabase-client.js";
import { phoneState, ensureSubscribed, savedEndpoint, allowNotifications, warmPush } from "./push.js";

/* Rest alerts: a push notification when rest is over, so it arrives with the phone locked.
   A web app can't set a notification on the phone for later, so each rest timer schedules one on
   the server (supabase/migrations/*_rest_alerts.sql), which sends it through api/rest-alert.js.
   The choice is per phone (localStorage), like the notification permission it rests on (push.js). */

const KEY = "gymbuddy-rest-alerts"; // "on" | "off"; unset until the lifter has been asked
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, v); } catch {} };

export { registerServiceWorker } from "./push.js";
export const warmRestAlerts = warmPush;

/**
 * This phone's state: "on" | "off" | "ask" (never decided) | "denied" (blocked in the phone's
 * settings) | "install" (an iPhone browser tab: alerts need the home screen app) | "unsupported".
 */
export function restAlertState() {
  const p = phoneState();
  if (p === "install" || p === "unsupported" || p === "denied") return p;
  const v = read();
  if (v === "on") return p === "on" ? "on" : "off";
  return v === "off" ? "off" : "ask";
}

/** Turns alerts on from a tap. Resolves the new state; throws when the phone couldn't be saved (offline). */
export async function enableRestAlerts() {
  const p = await allowNotifications();
  if (p !== "on") { write("off"); return p === "denied" ? "denied" : "off"; }
  write("on");
  return "on";
}

/** "Not now": off on this phone, and not asked again (Settings can still turn it on). */
export const declineRestAlerts = () => write("off");

/** Off on this phone. The phone stays subscribed: the week in review may still notify it. */
export async function disableRestAlerts() {
  write("off");
  await cancelRestAlert();
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
        const ep = await ensureSubscribed({ again: attempt > 0 });
        const { data, error } = await supabase.rpc("schedule_rest_alert", { p_endpoint: ep, p_seconds: Math.max(1, Math.round(seconds)), p_title: title, p_body: body, p_url: url });
        if (error) return false;
        if (data) return true;
        // This phone isn't saved for this account (signed in as someone else since): save it again.
      }
      return false;
    } catch { return false; }
  });
}

/** Cancels this phone's pending alert, if any. */
export function cancelRestAlert() {
  // Checked in turn, not now: a schedule still on its way may be what sets the address.
  return inOrder(async () => {
    const ep = savedEndpoint();
    if (ep) await supabase.rpc("cancel_rest_alert", { p_endpoint: ep }).then(() => {}, () => {});
  });
}
