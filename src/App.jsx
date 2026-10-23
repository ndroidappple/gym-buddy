import React, { useState, useEffect, useCallback, useRef } from "react";
import { PROGRAM, allDays, CUSTOM, normalizeProgram, warmupOf, baseOf } from "./data/program.js";
import { useRoute, href } from "./lib/router.js";
import { Toast, TabBar, Boot, LoadError, SyncNote } from "./components/ui.jsx";
import { loadState, createSaver } from "./lib/store.js";
import { merge3 } from "./lib/merge.js";
import { DEFAULT_PREFS } from "./lib/prefs.js";
import { today } from "./lib/util.js";
import { applyIcon } from "./lib/icons.js";
import { applyTheme } from "./lib/theme.js";
import { applyView } from "./lib/view.js";
import { setHaptics } from "./lib/util.js";
import { setSound } from "./lib/sound.js";
import Today from "./views/Today.jsx";
import Session from "./views/Session.jsx";
import Summary from "./views/Summary.jsx";
import Progress from "./views/Progress.jsx";
import Lift from "./views/Lift.jsx";
import Settings from "./views/Settings.jsx";
import ProgramEditor from "./views/ProgramEditor.jsx";
import ProgramList from "./views/ProgramList.jsx";
import Export from "./views/Export.jsx";
import Coaches from "./views/Coaches.jsx";
import Nutrition from "./views/Nutrition.jsx";
import NutritionSetup from "./components/NutritionSetup.jsx";
import { useFood } from "./lib/food.js";
import { useCoachThread } from "./lib/coachThread.js";
import { headContext } from "./lib/coachChat.js";
import { headCoach } from "./data/coaches.js";
import { coachFoodContext, totals } from "./lib/nutrition.js";
import NamePrompt from "./components/NamePrompt.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import Welcome from "./components/Welcome.jsx";
import WeekReview from "./components/WeekReview.jsx";
import WeekReviewIntro from "./components/WeekReviewIntro.jsx";
import { reviewState, reviewPrefs, fingerprint, latestReview } from "./lib/weekReview.js";
import { cachedReview, loadReview, requestReview, syncSchedule } from "./lib/reviews.js";
import { phoneState, ensureSubscribed } from "./lib/push.js";
import { useGoogleHealthSync, useHeartRate } from "./lib/googleHealth.js";
import { summarize, withHeart, maxHrFor, estimatedBounds, hasHeart, withoutHeart, clearCurves } from "./lib/heart.js";

const TAB_VIEWS = ["today", "nutrition", "progress", "settings", "lift"];

/** Saved account data as app state, with defaults filled in. */
const fromData = (data) => ({
  sessions: data?.sessions || [],
  program: data?.program ? normalizeProgram(data.program) : PROGRAM,
  drafts: data?.drafts || {},
  weighins: data?.weighins || [],
  prefs: { ...DEFAULT_PREFS, ...data?.prefs },
});

export default function App() {
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sync, setSync] = useState("synced"); // synced | pending | offline
  const [sessions, setSessions] = useState([]);
  const [program, setProgram] = useState(PROGRAM);
  const [drafts, setDrafts] = useState({});
  const [weighins, setWeighins] = useState([]);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [name, setName] = useState(null); // first name from the account, once known
  const [nameSettled, setNameSettled] = useState(false); // the name prompt is done, so the welcome can show
  const onNameSettled = useCallback(() => setNameSettled(true), []);
  const [toast, setToast] = useState(null);
  const { route, go, back } = useRoute();
  // Food log: its own tables, loaded only while tracking is on (see lib/food.js).
  const nutritionOn = !!prefs.nutrition?.on;
  const food = useFood(ready && nutritionOn);
  // The head coach conversation and memory: their own tables too (see lib/coachThread.js).
  const thread = useCoachThread(ready);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const { data, offline, base } = await loadState();
      // A confirmed-empty account is a new user: start with no history.
      const s = fromData(data);
      setSessions(s.sessions);
      setProgram(s.program);
      setDrafts(s.drafts);
      setWeighins(s.weighins);
      setPrefs(s.prefs);
      // In the same shape as app state, so a merge only sees real edits (not filled-in defaults).
      saver.current.start({ ...base, data: base.data && fromData(base.data) });
      if (offline) setSync("offline");
      setReady(true);
    } catch {
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  /* Another device saved since this one loaded. Take its changes, keeping anything changed here
     since `basis` (the state the merge was made against). */
  const onRemote = (data, basis) => {
    const next = fromData(data), was = fromData(basis);
    setSessions((cur) => merge3(was.sessions, cur, next.sessions));
    setProgram((cur) => merge3(was.program, cur, next.program));
    setDrafts((cur) => merge3(was.drafts, cur, next.drafts));
    setWeighins((cur) => merge3(was.weighins, cur, next.weighins));
    setPrefs((cur) => merge3(was.prefs, cur, next.prefs));
  };
  const saver = useRef(null);
  if (!saver.current) saver.current = createSaver(setSync, onRemote, fromData);

  useEffect(() => {
    if (ready) saver.current.save({ sessions, program, drafts, weighins, prefs });
  }, [sessions, program, drafts, weighins, prefs, ready]);

  /* The icon choice follows the account, so a fresh Safari sign-in offers the same icon to Add to Home Screen. */
  useEffect(() => { if (ready) applyIcon(prefs.icon); }, [ready, prefs.icon]);
  useEffect(() => { if (ready) applyTheme(prefs.theme); }, [ready, prefs.theme]);
  useEffect(() => { if (ready) applyView(prefs.view); }, [ready, prefs.view]);
  useEffect(() => { setHaptics(prefs.haptics); setSound(prefs.sound); }, [prefs.haptics, prefs.sound]);
  const setPref = useCallback((k, v) => setPrefs((p) => ({ ...p, [k]: v })), []);

  /* The home screen app can sleep in the background for days: on waking, catch up with any other device's saves. */
  useEffect(() => {
    if (!ready) return;
    const refresh = () => { if (document.visibilityState === "visible") saver.current.refresh(); };
    document.addEventListener("visibilitychange", refresh);
    addEventListener("focus", refresh);
    return () => { document.removeEventListener("visibilitychange", refresh); removeEventListener("focus", refresh); };
  }, [ready]);

  /* Retry unsynced changes when the connection comes back, the app returns to the foreground, or every 30 s. */
  useEffect(() => {
    if (sync !== "offline") return;
    const retry = () => saver.current.retry();
    const onVis = () => { if (document.visibilityState === "visible") retry(); };
    addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVis);
    const id = setInterval(retry, 30000);
    return () => { removeEventListener("online", retry); document.removeEventListener("visibilitychange", onVis); clearInterval(id); };
  }, [sync]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 5000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((msg, undo) => setToast({ msg, undo, at: Date.now() }), []);

  useEffect(() => { window.scrollTo(0, 0); }, [route.name, route.day, route.id, route.lift]);

  /* ── week in review ── */
  const foodLog = nutritionOn ? food.entries : null;
  const rp = reviewPrefs(prefs);
  // The review comes out at a set hour: look at the clock again when the app comes back to the
  // front, and every few minutes while it's open.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") setClock(Date.now()); };
    document.addEventListener("visibilitychange", tick);
    const id = setInterval(tick, 5 * 60_000);
    return () => { document.removeEventListener("visibilitychange", tick); clearInterval(id); };
  }, []);
  const review = ready ? reviewState({ prefs, now: new Date(clock), sessions, food: foodLog }) : null;
  const latest = latestReview(rp, new Date(clock));
  /* The schedule lives on the account too, so the server writes the review at its time (and sends
     the notification) with the app closed. */
  useEffect(() => { if (ready) syncSchedule(rp).catch(() => {}); }, [ready, rp.on, rp.day, rp.hour, rp.notify]); // eslint-disable-line react-hooks/exhaustive-deps
  // A phone that already allowed notifications gets the review's too, without asking again.
  useEffect(() => { if (ready && rp.on && rp.notify && phoneState() === "on") ensureSubscribed().catch(() => {}); }, [ready, rp.on, rp.notify]);
  /* Backup for the scheduled run: if 20 minutes after it's out there's still no review saved (the
     run failed, or it was turned on just now), the app asks for it, once everything has synced. */
  const prefetched = useRef(null);
  const reviewWeek = review?.weekEnd;
  const synced = sync === "synced" && (!nutritionOn || food.status === "synced");
  useEffect(() => {
    if (!reviewWeek || !synced || prefetched.current === reviewWeek) return;
    if (reviewWeek === latest.weekEnd && clock < latest.at + 20 * 60_000) return;
    prefetched.current = reviewWeek;
    (async () => {
      if (await cachedReview(reviewWeek).catch(() => null)) return;
      if (await loadReview(reviewWeek).catch(() => null)) return;
      requestReview(reviewWeek).catch(() => {});
    })();
  }, [reviewWeek, synced, clock, latest.weekEnd, latest.at]);
  /* Google Health: what's logged goes there once it's saved to the account (the server sends it from there). */
  const ghGone = () => { setPref("googleHealth", null); notify("Google Health disconnected. Connect again in Settings."); };
  useGoogleHealthSync({ on: ready && !!prefs.googleHealth?.on, synced, sessions, weighins, food: foodLog, onGone: ghGone });
  /* Not connected (disconnected here, on another phone, or access taken away in their Google
     account): heart rate comes off every workout and this phone's readings go. Reconnecting fills the
     last 30 days back in. */
  const ghOn = !!prefs.googleHealth?.on;
  useEffect(() => { if (ready && !ghOn) clearCurves(); }, [ready, ghOn]);
  // Whenever a workout with heart rate turns up while not connected (also one arriving later, from an
  // older copy of the account), not only at the moment of disconnecting.
  const stale = ready && !ghOn && sessions.some(hasHeart);
  useEffect(() => { if (stale) setSessions((prev) => prev.map(withoutHeart)); }, [stale, sessions]);
  // Heart rate from their watch: each recent workout's intensity, worked out against their age's max.
  const maxHr = maxHrFor(prefs.nutrition?.age);
  useHeartRate({ on: ready && !!prefs.googleHealth?.on && prefs.googleHealth.heart !== false, sessions, onGone: ghGone,
    onAllowed: () => setPrefs((p) => (p.googleHealth ? { ...p, googleHealth: { ...p.googleHealth, heart: false } } : p)),
    // Google's own zones for the lifter when it has them, else estimated from their age.
    // Never allowed to break the app: a workout it can't work out stays as it was (and is tried again).
    onReadings: (id, readings, zones) => setSessions((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      try {
        return withHeart(s, summarize(readings, s, { bounds: zones || estimatedBounds(maxHr), source: zones ? "google" : maxHr ? "age" : null, maxHr }));
      } catch (e) {
        console.error("heart rate not worked out for", id, e);
        return s;
      }
    })) });
  // Opening this week's review stops the glow; the button stays for the rest of the day.
  const opening = route.name === "review" && review?.glow && route.id === reviewWeek;
  useEffect(() => {
    if (opening) setPrefs((p) => ({ ...p, weekReview: { ...reviewPrefs(p), opened: reviewWeek, openedOn: today() } }));
  }, [opening, reviewWeek]);
  // Tapping the "ready" notification with the app open: the service worker hands over where to go.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e) => { if (e.data?.type === "open" && typeof e.data.url === "string") location.hash = new URL(e.data.url, location.origin).hash; };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);

  /* ── weigh-ins ── */
  const logWeighin = useCallback((date, bw) => {
    let before;
    setWeighins((ws) => { before = ws; return [...ws.filter((w) => w.date !== date), { date, bw }]; });
    notify(`${bw} lb logged`, () => setWeighins(before));
  }, [notify]);

  /* ── drafts ── */
  const saveDraft = useCallback((day, draft) => {
    setDrafts((d) => ({ ...d, [day]: { ...draft, updatedAt: Date.now() } }));
  }, []);
  const discardDraft = useCallback((day) => {
    let snapshot;
    setDrafts((d) => { snapshot = d[day]; const c = { ...d }; delete c[day]; return c; });
    notify("Session discarded", () => setDrafts((d) => ({ ...d, [day]: snapshot })));
  }, [notify]);

  /* ── sessions ── */
  const upsertSession = useCallback((s) => {
    setSessions((prev) => {
      const i = prev.findIndex((x) => x.id === s.id);
      if (i >= 0) { const c = [...prev]; c[i] = s; return c; }
      return [...prev, s];
    });
  }, []);

  const finishSession = useCallback((s) => {
    upsertSession(s);
    setDrafts((d) => { const c = { ...d }; delete c[s.day]; return c; });
    go(href("summary", s.id), { replace: true });
  }, [upsertSession, go]);

  const deleteSession = useCallback((s) => {
    setSessions((p) => p.filter((x) => x.id !== s.id));
    notify("Session deleted", () => upsertSession(s));
  }, [notify, upsertSession]);

  /* ── program ── */
  const patchDay = (day, fn) => setProgram((p) => ({ ...p, [day]: { ...p[day], exercises: fn(p[day].exercises) } }));
  const programOps = {
    add: (day, ex) => { patchDay(day, (xs) => [...xs, { ...ex, custom: true }]); notify(`${ex.n} added to ${program[day].name}`); },
    // A cardio warm-up goes first in the day, so it's the first card a session opens on.
    addWarmup: (day, cardioName) => {
      const w = warmupOf(cardioName);
      patchDay(day, (xs) => [w, ...xs.filter((e) => e.n !== w.n)]);
      notify(`${baseOf(w.n)} warm-up added to ${program[day].name}`);
    },
    remove: (day, name) => {
      const xs = program[day].exercises;
      const i = xs.findIndex((e) => e.n === name);
      const ex = xs[i];
      patchDay(day, (list) => list.filter((e) => e.n !== name));
      notify(`${name} removed`, () => patchDay(day, (list) => { const c = [...list]; c.splice(i, 0, ex); return c; }));
    },
    rename: (day, name) => {
      const n = name.trim().slice(0, 20);
      if (!n || n === program[day].name) return;
      setProgram((p) => ({ ...p, [day]: { ...p[day], name: n } }));
    },
    update: (day, name, patch) => patchDay(day, (xs) => xs.map((e) => (e.n === name ? { ...e, ...patch } : e))),
    move: (day, name, dir) => patchDay(day, (xs) => {
      const i = xs.findIndex((e) => e.n === name), j = i + dir;
      if (j < 0 || j >= xs.length) return xs;
      const c = [...xs]; [c[i], c[j]] = [c[j], c[i]]; return c;
    }),
    // Back to the lifts the day started with: the lifter's imported ones if they brought their own program.
    // The day keeps its name and whether it's in the rotation.
    restore: (day) => {
      const before = program[day];
      setProgram((p) => ({ ...p, [day]: before.orig ? { ...p[day], exercises: before.orig } : { ...PROGRAM[day], name: p[day].name, off: p[day].off } }));
      notify(`${before.name} restored`, () => setProgram((p) => ({ ...p, [day]: before })));
    },
  };

  if (loadFailed) return <LoadError onRetry={load} />;
  if (!ready) return <Boot />;

  // A coach's program edit the lifter confirmed in chat. Returns an undo that restores the program as it was.
  const applyCoachProgram = (next) => {
    const before = program;
    setProgram(next);
    return () => setProgram(before);
  };
  // A coach's first chat finished: their lifts (and, for Tank, goals, days and weight) are in.
  const finishSetup = ({ coach, program: next, profile, weight }) => {
    if (next) setProgram(next);
    setPrefs((p) => ({
      ...p,
      welcomed: true,
      profile: profile ? { ...p.profile, ...profile } : p.profile,
      coachSetup: { ...p.coachSetup, [coach]: Date.now() },
    }));
    if (weight) setWeighins((ws) => [...ws.filter((w) => w.date !== today()), { date: today(), bw: weight }]);
  };
  // Tank's answers as they're given, so closing setup part way keeps them. Tank stays unmet until the plan step.
  const saveSetupProgress = ({ profile, weight, program: next }) => {
    if (next) setProgram(next);
    if (profile) setPrefs((p) => ({ ...p, profile: { ...p.profile, ...profile } }));
    if (weight) setWeighins((ws) => [...ws.filter((w) => w.date !== today()), { date: today(), bw: weight }]);
  };
  // What the coaches see about food: targets, what's eaten today and each day of the past week.
  const nutrition = nutritionOn && prefs.nutrition.targets ? coachFoodContext(prefs.nutrition, food.entries) : null;
  const foodToday = nutrition ? { sum: totals(food.entries.filter((e) => e.date === today())), targets: prefs.nutrition.targets } : null;
  // The head coach reads 30 days of training and food in full, older history summarized, and their own notes, fresh for every message.
  const head = headCoach(prefs);
  // `day`: the date open on the Nutrition tab when the chat was opened there (today otherwise).
  const buildHead = (day) => headContext({ sessions, program, weighins, profile: prefs.profile, phase: prefs.phase,
    n: nutritionOn ? prefs.nutrition : null, entries: nutritionOn ? food.entries : [], foodDays: nutritionOn ? food.history : {}, notes: thread.notes, day });
  const coachChat = { thread, buildHead, foodLog: nutritionOn ? food : null };
  const common = { sessions, program, drafts, weighins, prefs, setPref, name, go, back, notify, onWeighin: logWeighin, onProgramChange: applyCoachProgram, nutrition, foodToday,
    head, coachNotes: thread.notes };
  let view;
  switch (route.name) {
    case "session": {
      if (!allDays(program).includes(route.day) && route.day !== CUSTOM) { view = <Today {...common} />; break; }
      const existing = route.id ? sessions.find((s) => s.id === route.id) : null;
      if (route.id && !existing) { view = <Today {...common} />; break; }
      view = (
        <Session key={route.day + (route.id || "new")} {...common} day={route.day} existing={existing}
          draft={existing ? null : drafts[route.day]}
          onSaveDraft={saveDraft} onDiscardDraft={discardDraft}
          onFinish={finishSession} onUpdate={upsertSession} onDelete={deleteSession} />
      );
      break;
    }
    case "review": {
      const current = route.id === latest.weekEnd;
      view = (
        <>
          <Today {...common} review={review} />
          <WeekReview key={route.id} weekEnd={route.id} current={current}
            fingerprint={fingerprint({ sessions, weighins, food: foodLog }, route.id)}
            head={head}
            onClose={() => back(href("today"))} />
        </>
      );
      break;
    }
    case "summary": {
      const s = sessions.find((x) => x.id === route.id);
      view = s ? <Summary key={s.id} {...common} session={s} past={route.past} onUpdate={upsertSession} /> : <Today {...common} />;
      break;
    }
    case "progress": view = <Progress key={route.open || "p"} {...common} open={route.open} />; break;
    case "lift": view = <Lift {...common} name={route.lift} />; break;
    case "settings": view = <Settings {...common} thread={thread} onRename={programOps.rename} />; break;
    case "program": view = allDays(program).includes(route.day) ? <ProgramEditor {...common} day={route.day} ops={programOps} /> : <ProgramList {...common} onRename={programOps.rename} />; break;
    case "export": view = <Export {...common} food={nutritionOn ? food : null} />; break;
    case "nutrition": {
      // Off: Settings is where it's turned on. Setup opens over the tab and returns to it.
      if (!nutritionOn && route.open !== "setup") { view = <Settings {...common} onRename={programOps.rename} />; break; }
      const closeSetup = () => go(href("nutrition"), { replace: true });
      view = (
        <>
          <Nutrition {...common} food={food} coachChat={coachChat} />
          {route.open === "setup" && (
            <NutritionSetup coach={head} prefs={prefs} program={program} sessions={sessions} weighins={weighins} name={name}
              onWeighin={(bw) => setWeighins((ws) => [...ws.filter((w) => w.date !== today()), { date: today(), bw }])}
              onSave={(n) => { setPref("nutrition", n); closeSetup(); notify("Targets saved"); }} onClose={closeSetup} />
          )}
        </>
      );
      break;
    }
    case "coaches": view = <Coaches key={(route.coach || "grid") + (route.mode || "")} {...common} coachChat={coachChat} openCoach={route.coach} openMode={route.mode} onSetupDone={finishSetup} onSetupProgress={saveSetupProgress} />; break;
    default: view = <Today {...common} review={review} />;
  }

  const showTabs = TAB_VIEWS.includes(route.name);
  const selectTab = (key) => go(href(key), { replace: true });
  const activeTab = route.name === "lift" ? "progress" : route.name;
  return (
    <div className="app">
      <ErrorBoundary resetKey={location.hash}>{view}</ErrorBoundary>
      {showTabs && <TabBar active={activeTab} onSelect={selectTab} nutrition={nutritionOn} />}
      <SyncNote show={sync === "offline" || food.status === "offline"} raised={showTabs} />
      <NamePrompt onName={setName} onSettled={onNameSettled} />
      {/* Meeting the week in review: once, on Today, after the welcome and a first workout or setup. */}
      {nameSettled && prefs.welcomed && !reviewPrefs(prefs).intro && route.name === "today" && (sessions.length > 0 || prefs.profile?.doneAt) && (
        <WeekReviewIntro settings={reviewPrefs(prefs)} onSave={(v) => { setPref("weekReview", v); if (!v.on) notify("Week in review off. Turn it on in Settings."); }} />
      )}
      {nameSettled && !prefs.welcomed && route.name !== "coaches" && (
        <Welcome name={name} onStart={(head) => { setPrefs((p) => ({ ...p, welcomed: true, headCoach: head })); go(href("coaches", head)); }} onLater={() => setPref("welcomed", true)} />
      )}
      <Toast toast={toast} onDismiss={() => setToast(null)} raised={route.name === "session"} />
    </div>
  );
}
