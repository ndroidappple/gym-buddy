# Running your own copy

GymBuddy runs on two free tiers: a Supabase project (database, sign-in, scheduled jobs) and a Vercel
project (the app and its `/api` functions). The training log needs only Supabase; every optional
feature below adds a key or two.

## 1. Supabase

1. Create a project. From **Project Settings → API**, note the project URL and the publishable (anon) key.
2. Create the account table. It predates the migrations folder, so it isn't in it. Run this in the SQL
   editor first:

   ```sql
   create table if not exists public.storage_kv (
     user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
     key text not null,
     value text not null,
     updated_at timestamptz not null default now(),
     primary key (user_id, key)
   );
   alter table public.storage_kv enable row level security;
   create policy "own rows" on public.storage_kv
     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
   ```

3. Run every file in `supabase/migrations/` in order (they're dated), in the SQL editor or with
   `supabase db push`. They turn on `pg_cron` and `pg_net` and schedule the background jobs.
4. **Authentication → URL Configuration:** set the Site URL to your Vercel address and add it to the
   Redirect URLs, or magic links won't come back to the app.
5. **Authentication → Email Templates → Magic Link:** include `{{ .Token }}` so the email carries the
   sign-in code. The home screen app can't open the link, so the code is how it signs in.

## 2. Vercel

Import the repo as a Vite project (no settings to change) and add environment variables:

| Variable | Needed for | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | everything | the server functions read these too |
| `FDC_API_KEY` | food search | free at https://fdc.nal.usda.gov/api-key-signup; falls back to the rate-limited `DEMO_KEY` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | rest alerts, review notifications | `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | push | optional contact `mailto:` or `https:` URL |
| `REST_ALERT_SECRET` | rest alerts, scheduled reviews, Google Health | any long random string |
| `GOOGLE_HEALTH_CLIENT_ID`, `GOOGLE_HEALTH_CLIENT_SECRET` | Google Health | see below |
| `GOOGLE_HEALTH_REDIRECT_URI` | Google Health | optional, only if the callback isn't on the site's own address |
| `AI_GATEWAY_MODEL`, `AI_REVIEW_MODEL` | coaches | optional model overrides |

The coaches use [Vercel AI Gateway](https://vercel.com/docs/ai-gateway). On Vercel it authenticates on
its own; to call it from `vercel dev` on your machine, set `AI_GATEWAY_API_KEY`. The models
(Gemini 2.5 Flash and Flash-Lite, with free fallbacks) are eligible for the gateway's free monthly
credit, which covers one lifter's use comfortably.

## 3. Background jobs (rest alerts and weekly reviews)

`pg_cron` posts due rest alerts to `/api/rest-alert` and due reviews to `/api/review`. Tell it where
your app is and the shared secret, in the Supabase SQL editor:

```sql
select vault.create_secret('https://<your app>/api/rest-alert', 'rest_alert_url');
select vault.create_secret('<REST_ALERT_SECRET>', 'rest_alert_secret');
```

The weekly review reuses both (it swaps `/api/rest-alert` for `/api/review` in the URL).

## 4. Google Health (optional)

1. In a Google Cloud project, turn on the Google Health API and create an OAuth client (Web application)
   with the redirect URI `https://<your domain>/api/google-health-callback`.
2. Add the scopes `googlehealth.health_metrics_and_measurements.readonly` (heart rate, resting heart rate,
   HRV), `googlehealth.sleep.readonly`, `googlehealth.health_metrics_and_measurements.writeonly` (weight) and
   `googlehealth.nutrition.writeonly`.
3. Set `GOOGLE_HEALTH_CLIENT_ID` and `GOOGLE_HEALTH_CLIENT_SECRET` in Vercel (Production), alongside
   `REST_ALERT_SECRET`.
4. Publish the consent screen ("In production"), or refresh tokens expire after 7 days. Until Google
   reviews the app it's limited to 100 people.

## Notes

- The camera (barcode scanning) and push notifications need HTTPS: test them on a Vercel preview, not
  `vite` over the LAN.
- Push on iPhone works only from the home screen app, on iOS 16.4 or later.
- `public/privacy.html` and `public/terms.html` describe the hosted app. Update them if you run your own.
