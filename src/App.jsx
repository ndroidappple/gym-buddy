import React, { useState, useEffect, useCallback, useRef } from "react";
import { PROGRAM, DAYS } from "./data/program.js";
import { seedSessions } from "./lib/util.js";
import { useRoute, href } from "./lib/router.js";
import { Toast, TabBar, Boot, LoadError, SyncNote } from "./components/ui.jsx";
import { loadState, createSaver } from "./lib/store.js";
import Today from "./views/Today.jsx";
import Session from "./views/Session.jsx";
import Summary from "./views/Summary.jsx";
import History from "./views/History.jsx";
import Progress from "./views/Progress.jsx";
import Lift from "./views/Lift.jsx";
import Settings from "./views/Settings.jsx";
import ProgramEditor from "./views/ProgramEditor.jsx";
import Export from "./views/Export.jsx";

const TAB_VIEWS = ["today", "history", "progress", "settings", "lift"];

export default function App() {
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sync, setSync] = useState("synced"); // synced | pending | offline
  const [sessions, setSessions] = useState([]);
  const [program, setProgram] = useState(PROGRAM);
  const [drafts, setDrafts] = useState({});
  const [toast, setToast] = useState(null);
  const { route, go, back } = useRoute();

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const { data, offline } = await loadState();
      // Seed only when the account is confirmed empty — never after a failed read.
      setSessions(data ? data.sessions : seedSessions());
      setProgram(data?.program || PROGRAM);
      setDrafts(data?.drafts || {});
      if (offline) setSync("offline");
      setReady(true);
    } catch {
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saver = useRef(null);
  if (!saver.current) saver.current = createSaver(setSync);

  useEffect(() => {
    if (ready) saver.current.save({ sessions, program, drafts });
  }, [sessions, program, drafts, ready]);

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

  const common = { sessions, program, drafts, go, back, notify };
  let view;
  switch (route.name) {
    case "session": {
      if (!DAYS.includes(route.day)) { view = <Today {...common} />; break; }
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
    case "progress": view = <Progress {...common} />; break;
    case "lift": view = <Lift {...common} name={route.lift} />; break;
    case "settings": view = <Settings {...common} />; break;
    case "program": view = DAYS.includes(route.day) ? <ProgramEditor {...common} day={route.day} ops={programOps} /> : <Settings {...common} />; break;
    case "export": view = <Export {...common} />; break;
    default: view = <Today {...common} />;
  }

  const showTabs = TAB_VIEWS.includes(route.name);
  const activeTab = route.name === "lift" ? "progress" : route.name;
  return (
    <div className="app">
      {view}
      {showTabs && <TabBar active={activeTab} />}
      {sync === "offline" && <SyncNote raised={showTabs} />}
      <Toast toast={toast} onDismiss={() => setToast(null)} raised={route.name === "session"} />
    </div>
  );
}
