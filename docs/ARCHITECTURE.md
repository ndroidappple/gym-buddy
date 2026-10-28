# How GymBuddy works

A feature-by-feature tour of how each part works and which files hold it. The [README](../README.md)
has the overview; [SETUP.md](SETUP.md) covers running your own copy.

Throughout, "Tank" stands for the lifter's head coach: Tank is the default, and whichever coach the
lifter picks takes over the same jobs (see [Head coach](#head-coach)).

## How data is stored

**Sign-in.** `src/Auth.jsx` gates the app behind Supabase email sign-in: the lifter enters their email
and either types the one-time code from the email (the reliable path in the home screen app, which
can't receive the link) or taps the magic link. Supabase creates an account the first time it sees an email (unless sign-ups are turned off in the project). After the first sign-in,
`NamePrompt.jsx` asks for a first name and `Welcome.jsx` offers setup with a head coach.

**The account record.** Workouts, the program, settings and drafts live in one JSON document per
account: key `ironlog-v2` in `storage_kv`, a generic key/value table (`user_id`, `key`, `value`,
`updated_at`) with own-rows-only row-level security. The app reaches it through
`window.storage.get/set(...)`, the API the original Claude artifact used; `src/storage-polyfill.js`
provides the same interface backed by Supabase, which is why that API is still there.

**Phone first.** `src/lib/store.js` saves every change to the phone (localStorage, per user) before
syncing it, and marks a copy that hasn't reached the account yet, so a killed app or dead gym wifi never
loses a session. Each copy remembers the `updated_at` stamp of the account version it builds on. If
another device saved in between, `src/lib/merge.js` does a three-way merge: lists with stable ids
(sessions, foods) merge item by item, so a workout logged on the phone and a setting changed on a laptop
both survive.

Weekly reviews are saved in the same table (`week-review:<last day>`). Everything that grows fast
(food, coach chat, heart rate links) has its own tables, below. **Settings → Export** gives a CSV or
JSON copy any time.

## In the gym

**The set coach** (`src/lib/setCoach.js`): after every logged set, what the next one should be and why.
It runs on the phone, so it's instant and works on gym wifi, from the rules a hypertrophy coach uses:
double progression inside the lift's rep range (reps first, then weight), work sets ending 1 to 2 reps
short of failure, and the usual set-to-set rep drop learned from this lifter's own history on this
lift, so "7 after 8" isn't read as a failure. Today's best set is compared with the all-time best
estimated 1-rep max: a PR is only chased on a day it's on, and an off day is told to bank quality sets.
Each lift also carries a one-line mental cue for the set (`src/data/cues.js`, editable per lift), and
`src/components/Coach.jsx` draws the coaches (flat SVG layers that ease between moods). `npm run test:coach` stress-tests it.

**Fatigue** (`src/lib/fatigue.js`): a lift done after other work for the same muscle performs worse than
the same lift fresh. Each result gets the load done before it (1 per set for the same muscle, 0.5 for a
helper muscle) and a fresh-equivalent max, e1RM / (1 − k × load), where k is learned from the lifter's
own history once there's enough spread (about 1.2% a set until then, capped at 20%).

**Machine busy** (`src/lib/busy.js`, `components/BusySheet.jsx`): the day's first heavy compound is the
anchor, worth a short wait; other compounds are best kept in order; isolations go wherever a machine is
free. The suggestions, best first: a lift for a different muscle, then one that only shares helpers,
then the same muscle. Or a swap for a lift with the same movement pattern (cable fly for pec deck).

**Programs** (`src/data/program.js`): the default 4-day split, up to 7 days, a custom day, cardio
warm-ups that open a day and finishers that close it. `src/lib/importProgram.js` reads a program pasted
from the Notes app ("Lat Pulldown — 3 × 8–12, 90s rest"), and the head coach can review it before it's
saved. `src/lib/repRange.js` sorts each lift by name into heavy barbell, compound, isolation,
small-muscle or core, each with the band coaches broadly use (3–10, 5–12, 8–15, 12–20, 8–20). A range
that clearly misses its band gets a note in the program editor with a one-tap fix, and the coach
mentions it before the lift's first set. It never changes a range on its own.

**Rest timer**: a dock at the bottom of the workout (tap for a full-screen view) with a chime
(`src/lib/sound.js`) and, optionally, a lock-screen push (see [Rest alerts](#rest-alerts-optional)).

## Nutrition (optional)

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

**Describing a meal** (typed into Add food's box) looks up named products instead of estimating them: for "Ratio yogurt" or "Fairlife
Core Power" he searches USDA Branded Foods and Open Food Facts (`look_up_food` in `api/coach.js`,
`lookUpFood` in `api/food.js`), uses a match only if it's the same product, and the meal card marks
those items **Label: product (source)**. A product neither database has gets one Google search
(`search_web`, `api/_webFood.js`: its own small Gemini call with Google Search, free with Gemini on
AI Gateway), trusted only with complete numbers for one serving that add up and a source site; the
item then says **(web: site.com)**. Anything still not found is estimated and marked **~** as
before. Generic foods (eggs, rice) skip both.

**Ask** on the Nutrition tab can fix today's log: ask him to correct an entry's numbers, move
or rename it, add a food or remove one, and he proposes the change on a card (`edit_food_log` in
`api/coach.js`). Nothing is saved until you tap **Apply**, and **Undo** puts it back
(`src/lib/foodEdit.js`). He names entries by their number in today's list, and the app checks
every edit against the log before showing it. A meal's ingredients go with it, so "use ultrafiltered
milk in my smoothie" is one ingredient swapped: the coach sends the meal's whole new ingredient list
(looking the product up first, as when logging a meal), the app adds up the totals and keeps the
breakdown, and the card shows "2% Milk (1 cup) → Ultrafiltered Fat-Free Milk (6 oz)". With the
lifter's yes, the saved food it came from gets the same change. Typing new numbers over a portion (e.g. Tank's meal)
turns that entry into its own numbers, like a quick add. `npm run test:food` checks the edits too.

## Head coach

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

**Ask about a workout:** a workout's recap (the Summary, straight after finishing or opened from
Progress → Workouts) has an Ask button that opens the same head coach conversation with `workout` set.
`workoutFocus()` in `src/lib/coachChat.js` puts that workout in full ahead of the usual context: every
set in order with when it was done, the rest before it and its heart rate (peak, and what it came down
to), each lift against last time and its best, and the workout's heart rate. The starters ask about it
("How did this workout go?", "Which lift pushed me hardest?", "Were my rests long enough?").

**Walk me through it:** the same recap offers the head coach's walkthrough of the workout
(`src/components/Walkthrough.jsx`, `src/lib/walkthrough.js`, mode `walk` in `api/coach.js`). The coach
answers with 3 to 6 steps (overall, done well, improve, next time) through the `walk_through` tool, each
pointing at a place on the recap: `overview`, a lift's row (`lift:<name>`), cardio, and with heart rate
`heart`, `zones`, a lift's heart rate row (`hr:<name>`) or `chart` (with a lift and set, the chart's readout
jumps to that set's peak). The places are listed in the context from what this recap shows
(`walkPlaces`) and `cleanWalk` sends anything else to the overview. A card pinned to the bottom shows one
step at a time while the recap scrolls to and outlines its place (`data-walk` attributes); nothing is
dimmed. The walkthrough is kept on the workout (`session.walk`) and replays without asking again until
the sets or heart rate change (`walkBasis`); its points stay under each part of the recap. Disconnecting
Google Health deletes a walkthrough written with heart rate along with the rest. `npm run test:coach`
checks it.

A step that recommends a change the app can make (a lift's rest, sets or reps; the weight to start it at
next time; swapping, adding or removing a lift on that day) carries it as `change`. `cleanChange` keeps
it only if it applies to that workout's day of the plan (at most three per walkthrough), and the step
shows it under the coach's words as one quiet line with an Apply button: nothing changes unless the
lifter taps it, and Undo takes back just that change (`changeDiff`/`undoDiff`). A weight for next time is
a program change too (`action: "weight"` in `applyChanges`): it sits on the lift as `next` until a workout
logs it, and fills every set, the lift's badge and the coach's opening line in that workout.

## Sleep and recovery (Google Health)

With Google Health connected, GymBuddy reads each night's sleep (its own permission, `sleep.readonly`) and
each day's resting heart rate and HRV (the heart rate permission already covers them): `action: "recovery"`
in `api/google-health.js` (`sleepNights`, `dailyValues` in `api/_googleHealth.js`), asked by
`useRecovery` in `src/lib/googleHealth.js` the first time for the 30 days before connecting and since, then
the last few days every couple of hours. The account keeps a summary per morning (`recovery`, the last 120
days; `src/lib/recovery.js`), and every judgment is against the lifter's own usual (the median of the 4
weeks before): a **short** night is under 5 hours or an hour and 15% under their usual; **strained** is
resting heart rate 5+ above usual with HRV 20% below, together.

- **Explaining a workout:** the recap shows the night before (time asleep, resting heart rate, HRV, each
  against their usual, and the stages), the walkthrough can point at it (`sleep` place), and the coaches read
  it: the workout write-up, the head coach's last 14 mornings, last night for the coaches in the gym.
- **Adjusting the day:** after a short or strained night, Today shows one quiet line, and the workout aims to
  match last time's best instead of beating it (no weight bump, no +1 rep; the badge reads Match). A weight
  the lifter took from a walkthrough still wins.
- **Patterns:** the weekly review has a Sleep card (the week against their usual, short nights, resting heart
  rate and HRV) and `sleepPattern`: how their lifts compare with their recent level after short nights vs the
  rest, once there are 3 workouts of each.

Connected before sleep was added: Settings → Google Health → Add sleep goes back through Google's page
(keeping the original connect date). Disconnecting deletes every sleep summary. `npm run test:health`
checks it.

## Rest alerts (optional)

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

## Week in review (on by default)

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

## Google Health (optional)

**Settings → Connected apps → Google Health** connects the lifter's Google account through the Google
Health API, on the server, so it works from the home screen app with nothing to install. It does two
things:

- **Reads heart rate during workouts** (from their watch, e.g. a Fitbit) to show how hard each
  workout and set was. Each set now records when it was done (`set.t`, set in `views/Session.jsx`).
  `useHeartRate` (`src/lib/googleHealth.js`) asks the server (`action: "heart"`) for the readings
  during each recent workout (the last 30 days, then each new one), and `src/lib/heart.js` turns them
  into `session.hr` (average, peak, lowest, minutes in each of Google's four zones: light, moderate,
  vigorous, peak) and, per set, `set.hr` (its peak, from 45 s before it was marked done to 30 s
  after) and `set.hrRest` (the lowest heart rate before the next set). The zones are the lifter's
  own from Google Health (`daily-heart-rate-zones`, the latest on or before the workout's date), or
  estimated from max heart rate (208 − 0.7 × age, from Nutrition setup) when Google has none. The
  account keeps only those numbers; the readings, thinned to one per 5 s, stay on the phone that
  fetched them (localStorage, the last 40 workouts) for the chart, and another phone fetches its own.
  Watches sync on their own schedule, so a workout is asked again every 15 minutes until its readings
  reach the end, for up to a day. The Summary shows the numbers and `components/HeartChart.jsx`: the
  line colored by zone (steps of the workout day's color, deeper and bolder for harder),
  each zone's threshold named in the plot with a faint tint above it, a dot on each set's peak, a
  lift strip under the plot on the same timeline (a numbered segment per lift, a tick per set, named in
  a key below), and a readout row above the plot that touch, drag or the arrow keys fill with that
  moment's bpm, zone, time, and lift and set. Each layer has its own space, so nothing covers another. Workouts lists it, and the coaches get it in each workout
  line (`workoutLine` in `src/lib/coachChat.js`, read per `HEART` in `api/coach.js`). The Summary and
  Workouts show heart rate only while Google Health is connected (`prefs.googleHealth.on`). When it
  isn't (disconnected on any phone, or access taken away in the Google account), the app takes heart
  rate off every workout (`withoutHeart`: `session.hr`, `set.hr`, `set.hrRest`; set times stay) and
  clears the phone's readings; reconnecting fills the last 30 days back in.
- **Sends bodyweight and food** to Google Health from the day they connect: a few seconds after a
  change saves, `useGoogleHealthSync` asks the server to sync; it reads the account and food log from
  Supabase, and `plan()` (`api/_googleHealth.js`) works out what to send: one weight a day, each food
  entry as a nutrition log at a usual time for its meal. Every data point is named from its item and
  contents, so sending twice is harmless, an edit is a delete of the old version then the new one, and
  something deleted in GymBuddy is deleted there. Up to 30 a request, 2.5 a second (Google's limit for
  an app it hasn't reviewed). Workouts aren't sent: the lifter records them in Google Health from
  their watch, and a copy from GymBuddy would double them.

Connecting: `action: "connect"` returns Google's consent page; Google sends the lifter back to
`api/google-health-callback.js`, which trades the code for a refresh token, checks the account is set
up in Google Health (Google wants the app opened once first), and saves the link for the lifter named
in the signed `state`. On an iPhone that page opens outside the home screen app, so Settings checks
the server when the app comes back to the front.

Storage (migration `20261022000000_google_health.sql`): `google_health_links` holds the refresh token,
encrypted on the server (AES-GCM, key derived from the client secret), with no policies: only functions
that need `REST_ALERT_SECRET` reach it. `google_health_synced` records what was sent, own rows only.
Disconnecting revokes the token and clears both; what's in Google Health stays.

Setup: a Google Cloud project with the Google Health API on, an OAuth client (Web application) whose
redirect URI is `https://<your domain>/api/google-health-callback`, and the scopes
`googlehealth.health_metrics_and_measurements.readonly` (heart rate), `googlehealth.sleep.readonly`,
`googlehealth.health_metrics_and_measurements.writeonly` (weight) and `googlehealth.nutrition.writeonly`.
In Vercel (Production) set **`GOOGLE_HEALTH_CLIENT_ID`** and **`GOOGLE_HEALTH_CLIENT_SECRET`**;
`REST_ALERT_SECRET` from rest alerts is needed too. Optional: `GOOGLE_HEALTH_REDIRECT_URI` if the
callback isn't on the site's own address. Until Google reviews the app it's limited to 100 people;
publish the consent screen ("In production") or refresh tokens expire after 7 days. `npm run
test:health` checks the planning, the sealed token, the request order, reading heart rate and the
intensity numbers.

## When something breaks

`components/ErrorBoundary.jsx` keeps a drawing error from blanking the app. One sits around each screen
(`App.jsx`, keyed by the route, so the tab bar stays and moving to another tab clears it) and one around
the whole app (`main.jsx`). Either shows "Something went wrong" with the error's own message, Back to
Today and Reload: a screenshot of it says what broke. Smaller parts can have a quiet one that just
leaves that part out (the Summary's heart rate section). Background work that changes state (heart rate
arriving) catches its own errors and leaves the workout as it was.
