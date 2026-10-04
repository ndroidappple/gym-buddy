import webpush from "web-push";
import { timingSafeEqual } from "node:crypto";

/* Rest alerts: sends the "Rest over" push notifications (see supabase/migrations/*_rest_alerts.sql).
   GET  /api/rest-alert  -> { publicKey }: the key the app subscribes to pushes with.
   POST /api/rest-alert  -> called by the database every 2 seconds with the alerts that are due:
        { alerts: [{ endpoint, p256dh, auth, title, body, url }] }, with the shared secret in
        x-rest-alert-secret. Nothing else can make it send.
   Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys) and REST_ALERT_SECRET. */

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SECRET = process.env.REST_ALERT_SECRET;
// Apple's push service wants a contact for the sender: a mailto: or https: URL.
const SUBJECT = process.env.VAPID_SUBJECT || "https://github.com/ndroidappple/ironlog";

const sameSecret = (given) => {
  const a = Buffer.from(String(given || "")), b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function GET() {
  if (!PUBLIC_KEY) return Response.json({ error: "Rest alerts aren't set up." }, { status: 503 });
  return Response.json({ publicKey: PUBLIC_KEY });
}

export async function POST(request) {
  if (!PUBLIC_KEY || !PRIVATE_KEY || !SECRET) return Response.json({ error: "Rest alerts aren't set up." }, { status: 503 });
  if (!sameSecret(request.headers.get("x-rest-alert-secret"))) return Response.json({ error: "Not allowed." }, { status: 401 });
  const { alerts } = await request.json().catch(() => ({}));
  if (!Array.isArray(alerts)) return Response.json({ error: "No alerts." }, { status: 400 });

  const vapidDetails = { subject: SUBJECT, publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY };
  const results = await Promise.allSettled(alerts.slice(0, 500).map((a) => webpush.sendNotification(
    { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
    JSON.stringify({ title: a.title, body: a.body, url: a.url, tag: "rest" }),
    // An alert that can't be delivered within a minute is no use: let the push service drop it.
    { vapidDetails, TTL: 60, urgency: "high", timeout: 8000 },
  )));
  const failed = results.filter((r) => r.status === "rejected");
  for (const f of failed) console.warn("rest alert not sent:", f.reason?.statusCode || "", f.reason?.body || f.reason?.message || "");
  return Response.json({ sent: results.length - failed.length, failed: failed.length });
}
