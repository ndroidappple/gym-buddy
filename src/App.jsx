import React, { useState, useEffect, useCallback, useRef } from "react";
import { PROGRAM, DAYS, CUSTOM, normalizeProgram } from "./data/program.js";
import { useRoute, href } from "./lib/router.js";
import { Toast, TabBar, Boot, LoadError, SyncNote } from "./components/ui.jsx";
import { loadState, createSaver } from "./lib/store.js";
import { merge3 } from "./lib/merge.js";
import { DEFAULT_PREFS } from "./lib/prefs.js";
import { today } from "./lib/util.js";
import { applyIcon } from "./lib/icons.js";
import { applyTheme } from "./lib/theme.js";
import Today from "./views/Today.jsx";
import Session from "./views/Session.jsx";
import Summary from "./views/Summary.jsx";
import History from "./views/History.jsx";
import Progress from "./views/Progress.jsx";
import Lift from "./views/Lift.jsx";
import Settings from "./views/Settings.jsx";
import ProgramEditor from "./views/ProgramEditor.jsx";
import Export from "./views/Export.jsx";
import Coaches from "./views/Coaches.jsx";
import NamePrompt from "./components/NamePrompt.jsx";
import Welcome from "./components/Welcome.jsx";

const TAB_VIEWS = ["today", "history", "progress", "settings", "lift"];

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
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((msg, undo) => setToast({ msg, undo, at: Date.now() }), []);

  useEffect(() => { window.scrollTo(0, 0); }, [route.name, route.day, route.id, route.lift]);

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
    remove: (day, name) => {
      const xs = program[day].exercises;
      const i = xs.findIndex((e) => e.n === name);
      const ex = xs[i];
      patchDay(day, (list) => list.filter((e) => e.n !== name));
      notify(`${name} removed`, () => patchDay(day, (list) => { const c = [...list]; c.splice(i, 0, ex); return c; }));
    },
    update: (day, name, patch) => patchDay(day, (xs) => xs.map((e) => (e.n === name ? { ...e, ...patch } : e))),
    move: (day, name, dir) => patchDay(day, (xs) => {
      const i = xs.findIndex((e) => e.n === name), j = i + dir;
      if (j < 0 || j >= xs.length) return xs;
      const c = [...xs]; [c[i], c[j]] = [c[j], c[i]]; return c;
    }),
    restore: (day) => {
      const before = program[day];
      setProgram((p) => ({ ...p, [day]: PROGRAM[day] }));
      notify(`${PROGRAM[day].name} restored to defaults`, () => setProgram((p) => ({ ...p, [day]: before })));
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
  const common = { sessions, program, drafts, weighins, prefs, setPref, name, go, back, notify, onWeighin: logWeighin, onProgramChange: applyCoachProgram };
  let view;
  switch (route.name) {
    case "session": {
      if (!DAYS.includes(route.day) && route.day !== CUSTOM) { view = <Today {...common} />; break; }
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
    case "summary": {
      const s = sessions.find((x) => x.id === route.id);
      view = s ? <Summary {...common} session={s} onUpdate={upsertSession} /> : <Today {...common} />;
      break;
    }
    case "history": view = <History {...common} />; break;
    case "progress": view = <Progress key={route.open || "p"} {...common} openPhase={route.open === "phase"} />; break;
    case "lift": view = <Lift {...common} name={route.lift} />; break;
    case "settings": view = <Settings {...common} />; break;
    case "program": view = DAYS.includes(route.day) ? <ProgramEditor {...common} day={route.day} ops={programOps} /> : <Settings {...common} />; break;
    case "export": view = <Export {...common} />; break;
    case "coaches": view = <Coaches key={route.coach || "grid"} {...common} openCoach={route.coach} onSetupDone={finishSetup} />; break;
    default: view = <Today {...common} />;
  }

  const showTabs = TAB_VIEWS.includes(route.name);
  const selectTab = (key) => go(href(key), { replace: true });
  const activeTab = route.name === "lift" ? "progress" : route.name;
  return (
    <div className="app">
      {view}
      {showTabs && <TabBar active={activeTab} onSelect={selectTab} />}
      {sync === "offline" && <SyncNote raised={showTabs} />}
      <NamePrompt onName={setName} onSettled={onNameSettled} />
      {nameSettled && !prefs.welcomed && route.name !== "coaches" && (
        <Welcome name={name} onStart={() => { setPref("welcomed", true); go(href("coaches", "tank")); }} onLater={() => setPref("welcomed", true)} />
      )}
      <Toast toast={toast} onDismiss={() => setToast(null)} raised={route.name === "session"} />
    </div>
  );
}
