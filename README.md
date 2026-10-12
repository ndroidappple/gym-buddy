# IRONLOG

A hypertrophy training tracker — 4-day PPL split, pre-filled set entry, autosave,
progress charts, and CSV/JSON export. Originally built as a Claude artifact;
this is the standalone version for local development in Claude Code.

## Run it

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Edit `src/App.jsx` and it hot-reloads.

You'll need a `.env.local` (gitignored) with:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>
```

## How data is stored

The app talks to `window.storage.get/set(...)` for everything — sessions,
program edits, in-progress drafts. Inside a Claude artifact that's a hosted
API. Here, `src/storage-polyfill.js` gives it the same interface backed by a
Supabase Postgres table (`storage_kv`), so `App.jsx` didn't need to change
at all.

`storage_kv` is a generic key/value table (`user_id`, `key`, `value`),
row-level-security scoped so each signed-in user only ever sees their own
rows. There's just one user (you), authenticated via Supabase's magic-link
email flow — `src/Auth.jsx` gates the whole app behind that until a session
exists, since there's no signup flow, just the one account.

Practically: your data now lives in Supabase and follows you across
devices/browsers as long as you're signed in with the same email. It's
separate from the Claude artifact version's storage — those never synced.

Use **Settings → Export** in the app to
get a CSV or JSON copy any time — that part works identically everywhere.

### Nutrition (optional)

Turned on in **Settings → Nutrition → Track food & macros**. Food is not in the
`storage_kv` blob: it grows by thousands of rows a year, so it has its own tables,
`food_entries` and `foods` (migration in `supabase/migrations/`), with the same
own-rows-only row-level security. The app keeps a copy on the phone and an outbox
that retries until each change reaches Supabase (`src/lib/food.js`).

Food search goes through `api/food.js` (a Vercel Function): USDA FoodData Central
for everyday foods and Open Food Facts for packaged ones. Set **`FDC_API_KEY`** in
the Vercel project (free key: https://fdc.nal.usda.gov/api-key-signup); without it
the shared, heavily rate-limited `DEMO_KEY` is used.

**Scan barcode** (in Add food) reads a packaged food's barcode with the back camera
(`src/lib/barcode.js`, `src/components/ScanFood.jsx`). iPhone Safari has no built-in
`BarcodeDetector`, so the `barcode-detector` package (zxing compiled to WASM) fills in. It
loads only when the scanner opens, and its `.wasm` is bundled with the app instead of coming from
a CDN. A scan checks the phone first (your saved foods, then foods you've logged), then
`/api/food?barcode=`: Open Food Facts, then USDA Branded Foods. The barcode is stored in the
food's `basis` JSON (no extra column), so a rescan finds it, offline too. A barcode neither
database knows can be entered from the label once, and it's found from then on. The camera needs
HTTPS, so test scanning on a Vercel preview, not on `vite` over the LAN. `npm run test:barcode`
checks the barcode logic.

**Add food** lists **Your foods** once each: saved foods and everything logged in the last 120 days
(`src/lib/yourFoods.js`), ranked by how often and how lately you've had them, with a boost for the
meal being added to, so the latte you have most mornings leads at breakfast. Each row says why it's
there ("4× · usually breakfast · yesterday"), and picking one starts from last time's amount. While
searching, your matching foods come first, then the **Food database** results, best matches first
(`relevance()` in `api/food.js`), shown per serving where the label gives one. Meals from Tank aren't
saved by default: they show in Your foods anyway, and saving keeps one for good. `npm run test:food`
checks the ranking.

### Rest alerts (optional)

A push notification when a rest timer ends, so it arrives with the phone locked (**Settings →
Rest alerts**, or the card that appears during the first rest). iPhone only allows this for the
home screen app (iOS 16.4+). A web app can't set a notification on the phone for later, so the
server sends it:

- `src/lib/restAlerts.js` asks for permission, subscribes the phone, and schedules one alert per
  rest timer; +15/−15 moves it, Skip/Finish/Discard cancel it. If the app is on screen in the
  last 4 seconds, it cancels the alert and the in-app chime plays instead.
- `supabase/migrations/20261004000000_rest_alerts.sql`: `push_subscriptions` and `rest_alerts`
  (reached only through functions that act for the signed-in user), and a `pg_cron` job that
  every 2 seconds posts the alerts that are due to `api/rest-alert.js`.
- `api/rest-alert.js` (a Vercel Function) signs and sends them; `public/sw.js` shows them.

Setup: in Vercel set **`VAPID_PUBLIC_KEY`** and **`VAPID_PRIVATE_KEY`** (`npx web-push
generate-vapid-keys`) and **`REST_ALERT_SECRET`** (any long random string). In Supabase, store
where to send and the same secret in Vault:

```sql
select vault.create_secret('https://<your app>/api/rest-alert', 'rest_alert_url');
select vault.create_secret('<REST_ALERT_SECRET>', 'rest_alert_secret');
```

Apple doesn't allow a live countdown on the lock screen (Live Activities) or buttons on the
notification for web apps, and delivery needs a connection when rest starts and ends.

### Week in review (on by default)

Once a week (Sunday at 10 AM unless changed in **Settings → Week in review**) the coaches look back
at the 7 full days before it comes out: a Sunday review covers Sunday to Saturday, so every day in
it is complete. Today shows a glowing **Week in review** button in place of the coach's hello until
it's opened; it opens as tap-through story cards (✕, Escape or a swipe down closes it at any card).
The first time, a sheet introduces it with its day, time, a notification and a way to turn it off.
Every review is saved to the account: the latest show on **Progress**, all in **Settings → Past reviews**.

- `src/lib/weekReview.js` works out every number in code (shared by the app and the server):
  workouts against plan, sets per coach's area against the 4-week average, records, stalled and
  rising lifts, skipped lifts, food against targets (training vs rest days, weekdays vs weekends,
  top foods, drinks), bodyweight and bulk/cut pace, 8 weeks of trends, and candidate highs/lows.
- `api/review.js` (a Vercel Function) runs a coach **agent**: Gemini 2.5 Flash through Vercel AI
  Gateway, with read-only tools to dig further (a lift's history, food by day or item, an earlier
  week) before it hands in the review. It's saved to `storage_kv` as `week-review:<last day>`, so
  it's written once and opens instantly after that (up to 3 runs a week, with updates when more is
  logged for that week later). `npm run test:review` checks the facts, the agent loop (with a
  scripted model) and the requests.
- **On a schedule** (`supabase/migrations/20261009000000_week_review_schedule.sql`): the app keeps
  each lifter's day, hour, time zone and notification choice in `week_review_schedule`. Every 5
  minutes `pg_cron` posts the lifters who are due to `/api/review`, which writes the review with the
  app closed and sends a **"Your week in review is ready"** push (with the headline) to every phone
  that allows notifications. It reuses the rest alerts' Vault URL and secret (`rest_alert_url`, with
  `/api/rest-alert` swapped for `/api/review`, and `rest_alert_secret` = `REST_ALERT_SECRET`), so
  there's nothing new to set up. With no sign-in, the function reads and saves that one lifter's
  data through `review_job_input` / `review_job_save`, which refuse anything without the secret. If
  the scheduled run fails, the app asks for the review itself 20 minutes later, or when it's tapped;
  a "being written" marker stops the two from paying for the same review twice.
- Cost: about $0.02 a review, paid from AI Gateway's free $5 a month (as long as no gateway credits
  are bought). Only some models are eligible for the free credit, and no Claude model is: the
  gateway skips an ineligible model without trying it (the routing record shows 0 attempts for it)
  and goes straight to the fallbacks. If Gemini 2.5 Flash fails or the credit runs out, the gateway
  falls back to Gemini 2.5 Flash-Lite, then a free model; if no model answers, the review is
  written by code from the same facts. `AI_REVIEW_MODEL` switches the first model.
- Coach chat and Tank's food logging (`api/coach.js`) use the same credit: Gemini 2.5 Flash for
  logging a meal and reviewing a program (about $0.004 a meal), Gemini 2.5 Flash-Lite for chat
  (well under $0.001 a reply). Each falls back to the other Gemini, then to free models.
  `AI_GATEWAY_MODEL` forces one model for everything.
  The fallback is silent, so every reply logs a `coach answered` line in the function logs with
  the model asked for, the one that answered, and the gateway's routing record of what it tried.

**Settings → Notifications** shows whether this phone allows notifications (and how to fix it if
not), **Rest alerts** (this phone only) and **Week in review is ready** (every phone). The push
plumbing is shared in `src/lib/push.js` (phone side) and `api/_push.js` (server side).

## Project structure

```
src/
  main.jsx                 # entry: storage polyfill, styles, AuthGate → App
  App.jsx                  # state, persistence (ironlog-v2), routing, undo toasts
  styles.css               # "Plate Room" design tokens + all component styles
  Auth.jsx                 # magic-link sign-in gate (single user)
  data/program.js          # default program, lift library, seed history, plate map
  lib/util.js              # e1RM, trends, PRs, dates, formatting
  lib/router.js            # hash routing (#/today, #/session/push, #/lift/…)
  lib/sound.js             # rest-timer chime
  lib/push.js              # notification permission + this phone's push address (shared)
  lib/restAlerts.js        # lock-screen rest alerts (push; see public/sw.js, api/rest-alert.js)
  lib/weekReview.js        # week in review: facts, timing, agent tools, code-written fallback
  components/ui.jsx        # sheet, toast, tab bar, charts, exercise picker
  views/                   # Today, Session, Summary, Progress (+ Workouts), Lift,
                           # Settings, ProgramEditor, Export
```

Design: each day wears an IWF plate color (Push red, Pull blue, Legs yellow,
Shoulders green). Color only identifies the day; ▲/▼ and the "PR" stamp show
performance. Light/dark follow the phone's setting. Pounds only.

## What's seeded in

- The 4-day Push/Pull/Legs/Shoulders&Arms split, with sets/reps/rest per lift
- Two weeks of historical sessions imported from the original spreadsheet
- A ~60-lift library (grouped by muscle) for the in-app "Add exercise" picker

## Known gaps / next things worth asking Claude Code for

- Not deployed yet — see "Deploying" below
- No auth rate-limit/lockout beyond what Supabase does by default

## Deploying

Not yet deployed. Plan: Vercel (free Hobby tier), same repo, with
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` set as Vercel env vars. Once
deployed, add the Vercel URL to the Supabase project's Auth → URL
Configuration → Redirect URLs allow list, or magic links won't redirect
back correctly.
