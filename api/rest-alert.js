import { PUBLIC_KEY, pushReady, sameSecret, sendPushes } from "./_push.js";

/* Rest alerts: sends the "Rest over" push notifications (see supabase/migrations/*_rest_alerts.sql).
   GET  /api/rest-alert  -> { publicKey }: the key the app subscribes to pushes with.
   POST /api/rest-alert  -> called by the database every 2 seconds with the alerts that are due:
        { alerts: [{ endpoint, p256dh, auth, title, body, url }] }, with the shared secret in
        x-rest-alert-secret. Nothing else can make it send.
   Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys) and REST_ALERT_SECRET.
   The week in review's scheduled runs (api/review.js) use the same keys and secret. */

const SECRET = process.env.REST_ALERT_SECRET;

export function GET() {
  if (!PUBLIC_KEY) return Response.json({ error: "Rest alerts aren't set up." }, { status: 503 });
  return Response.json({ publicKey: PUBLIC_KEY });
}

export async function POST(request) {
  if (!pushReady() || !SECRET) return Response.json({ error: "Rest alerts aren't set up." }, { status: 503 });
  if (!sameSecret(request.headers.get("x-rest-alert-secret"), SECRET)) return Response.json({ error: "Not allowed." }, { status: 401 });
  const { alerts } = await request.json().catch(() => ({}));
  if (!Array.isArray(alerts)) return Response.json({ error: "No alerts." }, { status: 400 });
  // Each alert has its own text, so one send each. An alert that can't be delivered within a
  // minute is no use: the push service drops it.
  const results = await Promise.all(alerts.slice(0, 500).map((a) =>
    sendPushes([a], { title: a.title, body: a.body, url: a.url, tag: "rest" }, { TTL: 60, urgency: "high" })));
  const sent = results.reduce((n, r) => n + r.sent, 0);
  return Response.json({ sent, failed: results.length - sent });
}
