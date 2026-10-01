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
