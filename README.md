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

**Add with Tank** looks up named products instead of estimating them: for "Ratio yogurt" or "Fairlife
Core Power" he searches USDA Branded Foods and Open Food Facts (`look_up_food` in `api/coach.js`,
`lookUpFood` in `api/food.js`), uses a match only if it's the same product, and the meal card marks
those items **Label: product (source)**. A product neither database has gets one Google search
(`search_web`, `api/_webFood.js`: its own small Gemini call with Google Search, free with Gemini on
AI Gateway), trusted only with complete numbers for one serving that add up and a source site; the
item then says **(web: site.com)**. Anything still not found is estimated and marked **~** as
before. Generic foods (eggs, rice) skip both.

**Ask Tank** on the Nutrition tab can fix today's log: ask him to correct an entry's numbers, move
or rename it, add a food or remove one, and he proposes the change on a card (`edit_food_log` in
`api/coach.js`). Nothing is saved until you tap **Apply**, and **Undo** puts it back
(`src/lib/foodEdit.js`). He names entries by their number in today's list, and the app checks
every edit against the log before showing it. A meal's ingredients go with it, so "use ultrafiltered
milk in my smoothie" is one ingredient swapped: the coach sends the meal's whole new ingredient list
(looking the product up first, as when logging a meal), the app adds up the totals and keeps the
breakdown, and the card shows "2% Milk (1 cup) → Ultrafiltered Fat-Free Milk (6 oz)". With the
lifter's yes, the saved food it came from gets the same change. Typing new numbers over a portion (e.g. Tank's meal)
turns that entry into its own numbers, like a quick add. `npm run test:food` checks the edits too.

### Head coach

At sign-up the lifter picks a **head coach** from the six (`prefs.headCoach`, Tank when unset;
changeable in **Settings → Head coach**). The head coach runs setup (goals, weight, days), nutrition
(targets, describing a meal, food questions) and leads the week in review. The other five are the
crew: each still coaches their own lifts in the gym (cues, set reactions, the mid-workout chat).

After setup, the Coaches screen and the Nutrition tab's **Ask** open one ongoing conversation with
the head coach (`mode: "head"` in `api/coach.js`). Every message sends the last 30 days of training
and food side by side (`headContext()` in `src/lib/coachChat.js`): every workout, week-by-week sets
and volume, each lift's trend, bodyweight, and food by day and by week against the targets, so the
coach can tie the two together. Lift trends are long-term (`longTrend()` in `src/lib/util.js`): each
lift's change since it was first logged, and every lift ranked by progress per month, so "which lift
have I improved least on?" has a real answer. The last-few-sessions comparison is still sent, labeled
"lately", for spotting a stall. `npm run test:coach` checks it.

Beyond the 30 days in full, the head coach gets the whole history at less detail the further back it
goes (`olderHistory()` in `src/lib/coachChat.js`): a line per week back to about 6 months, then a line
per month back to the first workout (up to 3 years), each with workouts, sets, volume, food averages
and bodyweight, plus each lift's best e1RM by month. Two years of daily training comes to about
14,000 characters. Food older than the app's 120-day window comes from `food_daily_totals()`
(migration `20261015000000_food_daily_totals.sql`), daily totals only, cached on the phone. It can propose program changes and edits to today's food log, both
applied only from the card.

The conversation and the coach's memory have their own tables (migration
`20261014000000_head_coach_chat.sql`), own-rows-only like the food tables, written through the same
phone-first outbox (`src/lib/coachThread.js`):

- `coach_messages`: one row per message. A nightly pg_cron job deletes anything older than 30 days.
- `coach_memory`: one row per lifter, up to 20 short notes. The coach updates them with the
  `remember` tool when the lifter says something lasting (an injury, equipment, schedule), and reads
  them before every answer. The crew sees them too. **Settings → What … remembers** lists them, deletes
  any, and clears the chat history.

### Sounds (on by default)

Five short sounds, all behind **Settings → Rest timer → Sound**: a click when a set is logged (iPhone web
apps can't vibrate, so this is the only feedback there), four dings up C major for a PR, a tick on each of
the last 3 seconds of rest, a small bell struck twice when rest is over, and a kalimba arpeggio on
finishing a workout.

They're made in code with [earshot](https://github.com/Leonxlnx/earshot)'s sound bank: no recordings, and
nothing synthesized in the browser. `scripts/render-sounds.py` names each one (bank ids, seeds, pitches,
timing, level), renders it, checks it with earshot's audit (clicks, clipping, cut tails, metallic ring) and
writes `src/assets/sounds/*.mp3` (about 100 KB in all; MP3 because every browser decodes it, and open-source
Chromium can't decode AAC). Levels follow earshot's calm kit (bell −3 dB, click −4.5, tick −5). To change
one, edit the script and run `npm run sounds` (it needs Python, ffmpeg and earshot; the script's header says
how to install them). `npm run sounds -- --listen` also scores each one with earshot's listening models
(about 1.1 GB, downloaded once). How they score now (z against earshot's 322 descriptions; ≥ 3 is a strong
match):

| sound | asked for | z | sounds like |
|---|---|---|---|
| set | a short solid click of a button locking in place | +3.4 | a mechanical key press, a soft key release click |
| pr | a bright happy celebratory chime, a reward sound | +3.8 | a success chime, a magic sparkle chime |
| done | a warm resolving chime, a success sound | +3.1 | a success chime, a magic sparkle chime |
| rest | a timer bell going off | +3.0 | a triangle hit, a bicycle bell, a small bell |
| tick | a soft quiet wooden tick | +1.8 | a wooden block hit, lego bricks clicking |

In a forced choice, all five win over "a cheap synthesizer laser zap / a video game blip / an 8-bit chiptune
sound / an annoying electronic beep" (100%). The old rest chime (two sine tones) scored z +1.8 on "a timer
bell going off" and won that choice only 5% of the time.

`src/lib/sound.js` decodes them once into the Web Audio context when a workout opens, and plays them from
memory. The countdown and the bell are booked a moment ahead on the audio clock, so they land exactly a
second apart even though the screen only updates every 250 ms; +15, −15 and Skip call off one that hasn't
played. If the audio is asleep (on iOS, after switching to a music app or a call, until the next tap), the
timer sounds are skipped rather than played late. If the bell's file hasn't loaded, the old two tones play
instead. Like the old chime, they play through Web Audio, which an iPhone mutes with its silent switch.

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
  lib/sound.js             # sounds (set, PR, rest countdown + bell, finish); scripts/render-sounds.py
  lib/push.js              # notification permission + this phone's push address (shared)
  lib/restAlerts.js        # lock-screen rest alerts (push; see public/sw.js, api/rest-alert.js)
  lib/weekReview.js        # week in review: facts, timing, agent tools, code-written fallback
  lib/coachThread.js       # head coach conversation + memory (coach_messages, coach_memory)
  lib/coachChat.js         # what each coach reads (crew: buildContext, head: headContext), streaming
  lib/repRange.js          # is a lift's rep range sane for its kind? (npm run test:range)
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
- A rep-range check (`src/lib/repRange.js`): each lift is sorted by name into heavy barbell,
  compound, isolation, small-muscle or core, each with the band coaches broadly use (3–10, 5–12,
  8–15, 12–20, 8–20). A range that clearly misses its band (top more than 2 under, or bottom more
  than 5 over) gets a note in the program editor with a one-tap fix, and the coach mentions it
  before the lift's first set. It never changes a range on its own, and the set-by-set coaching
  still works inside the program's range.

## Known gaps / next things worth asking Claude Code for

- Not deployed yet — see "Deploying" below
- No auth rate-limit/lockout beyond what Supabase does by default

## Deploying

Not yet deployed. Plan: Vercel (free Hobby tier), same repo, with
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` set as Vercel env vars. Once
deployed, add the Vercel URL to the Supabase project's Auth → URL
Configuration → Redirect URLs allow list, or magic links won't redirect
back correctly.
