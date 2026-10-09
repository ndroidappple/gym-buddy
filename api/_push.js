import webpush from "web-push";
import { timingSafeEqual } from "node:crypto";

/* Push sending shared by the server functions (rest alerts, week in review). Files starting with
   an underscore aren't served as functions. Needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY
   (npx web-push generate-vapid-keys). */

export const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
// Apple's push service wants a contact for the sender: a mailto: or https: URL.
const SUBJECT = process.env.VAPID_SUBJECT || "https://github.com/ndroidappple/ironlog";
export const pushReady = () => !!(PUBLIC_KEY && PRIVATE_KEY);

/** Whether a request carries the shared secret, compared in constant time. */
export function sameSecret(given, secret) {
  const a = Buffer.from(String(given || "")), b = Buffer.from(String(secret || ""));
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Sends one notification to each phone: subs are [{ endpoint, p256dh, auth }], payload is
 * { title, body, url, tag } (public/sw.js shows it). Resolves { sent, failed }; never throws.
 */
export async function sendPushes(subs, payload, { TTL = 60, urgency = "normal" } = {}) {
  if (!pushReady() || !subs?.length) return { sent: 0, failed: 0 };
  const vapidDetails = { subject: SUBJECT, publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY };
  const results = await Promise.allSettled(subs.slice(0, 500).map((s) => webpush.sendNotification(
    { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
    JSON.stringify(payload),
    { vapidDetails, TTL, urgency, timeout: 8000 },
  )));
  const failed = results.filter((r) => r.status === "rejected");
  for (const f of failed) console.warn(`${payload.tag || "push"} not sent:`, f.reason?.statusCode || "", f.reason?.body || f.reason?.message || "");
  return { sent: results.length - failed.length, failed: failed.length };
}
