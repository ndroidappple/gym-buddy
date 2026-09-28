import React, { useEffect, useState } from "react";
import { ChevronRight, Download, LogOut, Moon, Gauge, Smartphone, Share, SquarePlus, EllipsisVertical, Check, Sparkles, Scale, Vibrate, Bell, Pencil, ClipboardPaste, Users, Utensils, Target } from "lucide-react";
import { Sheet, InfoButton, ConfirmSheet } from "../components/ui.jsx";
import { ICONS, iconSrc } from "../lib/icons.js";
import { DAYS, allDays, activeDays } from "../data/program.js";
import { href } from "../lib/router.js";
import { shortDate, canVibrate } from "../lib/util.js";
import { supabase } from "../supabase-client.js";

export default function Settings({ program, sessions, prefs, setPref, onRename, go }) {
  const [email, setEmail] = useState("");
  const [sheet, setSheet] = useState(null); // "icon" | "install" | "rename" | "redo"
  const icon = ICONS.find((i) => i.id === prefs.icon) || ICONS[0];
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || "")); }, []);

  return (
    <main className="screen has-tabs">
      <header className="top"><h1 className="page-title">Settings</h1><span className="spacer" /><InfoButton screen="settings" /></header>
      <div className="body">
        <section className="section">
          <h2 className="lbl">Program</h2>
          <div className="list" data-help="program">
            {/* Built-in days show even when switched off; extra days only while in the rotation. */}
            {allDays(program).filter((d) => DAYS.includes(d) || !program[d].off).map((d) => (
              <a key={d} className="list-row" href={href("settings", "program", d)} data-day={d}>
                <span className="dot" aria-hidden="true" />
                <span className="name">{program[d].name}<span className="sub">{program[d].off ? "Not in your rotation" : `${program[d].detail} · ${program[d].exercises.length} lifts`}</span></span>
                <ChevronRight size={18} aria-hidden="true" className="muted" />
              </a>
            ))}
            <button className="list-row" data-help="rename" onClick={() => setSheet("rename")}>
              <Pencil size={18} aria-hidden="true" />
              <span className="name">Rename workouts<span className="sub">{activeDays(program).map((d) => program[d].name).join(", ")}</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
            {/* Tank's paste-and-review steps on their own, for a lifter who's already set up. */}
            <a className="list-row" data-help="import" href={href("coaches", "tank", "import")}>
              <ClipboardPaste size={18} aria-hidden="true" />
              <span className="name">Bring in your own program<span className="sub">Paste a program you already run. Tank can review it.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </a>
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Coaches &amp; goals</h2>
          <div className="list">
            <a className="list-row" data-help="coaches" href={href("coaches")}>
              <Users size={18} aria-hidden="true" />
              <span className="name">Your coaches<span className="sub">Ask a question or change your plan.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </a>
            {/* Phases live on Progress; this is the side door. */}
            <a className="list-row" href={href("progress", "phase")}>
              <Scale size={18} aria-hidden="true" />
              <span className="name">Bulk or cut phase<span className="sub">{prefs.phase ? `${prefs.phase.type === "cut" ? "Cut" : "Bulk"} to ${prefs.phase.target} lb · ends ${shortDate(prefs.phase.end)}` : "Set a short-term bodyweight goal."}</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </a>
            <button className="list-row" data-help="redo" onClick={() => setSheet("redo")}>
              <Sparkles size={18} aria-hidden="true" />
              <span className="name">Redo setup with your coaches<span className="sub">Goals, training days and the lifts each coach runs.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Nutrition</h2>
          <div className="list">
            {/* Turning it off only hides it: the food log and targets stay saved. */}
            <Toggle help="nutrition" Icon={Utensils} label="Track food & macros"
              sub={prefs.nutrition?.on ? "Nutrition tab is on. Turning it off keeps your log." : "Adds a Nutrition tab. Tank sets your daily targets."}
              on={!!prefs.nutrition?.on}
              onChange={(v) => { setPref("nutrition", { ...prefs.nutrition, on: v }); if (v && !prefs.nutrition?.targets) go(href("nutrition", "setup")); }} />
            {prefs.nutrition?.on && prefs.nutrition.targets && (
              <a className="list-row" href={href("nutrition", "setup")}>
                <Target size={18} aria-hidden="true" />
                <span className="name">Daily targets<span className="sub">{prefs.nutrition.targets.kcal.toLocaleString()} kcal · {prefs.nutrition.targets.protein} g protein. Redo with Tank.</span></span>
                <ChevronRight size={18} aria-hidden="true" className="muted" />
              </a>
            )}
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Display</h2>
          <div className="list">
            <Toggle Icon={Moon} label="Dark mode" sub="Easier on the eyes between sets." on={prefs.theme === "dark"}
              onChange={(v) => setPref("theme", v ? "dark" : "light")} />
            <Toggle help="rir" Icon={Gauge} label="Reps in reserve (RIR)" sub="Rate how many reps you had left on each set." on={prefs.rir}
              onChange={(v) => setPref("rir", v)} />
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Feedback</h2>
          <div className="list">
            <Toggle Icon={Bell} label="Rest timer sound" sub="A short chime when rest is over." on={prefs.sound !== false}
              onChange={(v) => setPref("sound", v)} />
            {/* iPhone browsers can't vibrate, so the switch only shows where it does something. */}
            {canVibrate() && (
              <Toggle Icon={Vibrate} label="Vibration" sub="A buzz on logged sets, PRs and when rest ends." on={prefs.haptics !== false}
                onChange={(v) => setPref("haptics", v)} />
            )}
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Home screen</h2>
          <div className="list">
            <button className="list-row" onClick={() => setSheet("icon")}>
              <img className="app-icon sm" src={iconSrc(icon.id)} alt="" />
              <span className="name">App icon<span className="sub">{icon.label}</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
            <button className="list-row" onClick={() => setSheet("install")}>
              <Smartphone size={18} aria-hidden="true" />
              <span className="name">Add GymBuddy to your home screen<span className="sub">Opens full screen, like an app.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Data</h2>
          <div className="list">
            <a className="list-row" data-help="export" href="#/settings/export">
              <Download size={18} aria-hidden="true" />
              <span className="name">Export<span className="sub">{sessions.length} sessions as CSV or JSON</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </a>
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Account</h2>
          <div className="list">
            <div className="list-row"><span className="name">Signed in<span className="sub">{email || "—"}</span></span></div>
            <button className="list-row" onClick={() => supabase.auth.signOut()}>
              <LogOut size={18} aria-hidden="true" />
              <span className="name">Sign out<span className="sub">Your data stays saved to your account.</span></span>
            </button>
          </div>
        </section>

        <p className="small muted">Weights are in pounds.</p>
      </div>

      {sheet === "icon" && (
        <Sheet title="App icon" sub="Pick the icon GymBuddy gets on your home screen." onClose={() => setSheet(null)} labelledBy="icon-title">
          <div className="icon-grid" role="radiogroup" aria-label="App icon">
            {ICONS.map((i) => (
              <button key={i.id} role="radio" aria-checked={prefs.icon === i.id} className="icon-choice" onClick={() => setPref("icon", i.id)}>
                <span className="app-icon-wrap"><img className="app-icon" src={iconSrc(i.id)} alt="" />{prefs.icon === i.id && <span className="icon-check"><Check size={14} strokeWidth={3.4} /></span>}</span>
                <span>{i.label}</span>
              </button>
            ))}
          </div>
          <p className="note-box">Your phone keeps the icon GymBuddy was added with. To switch it, remove GymBuddy from your home screen, then add it again.</p>
          <button className="btn btn-ghost" onClick={() => setSheet("install")}>How to add it again</button>
        </Sheet>
      )}
      {sheet === "install" && <InstallSheet onClose={() => setSheet(null)} />}
      {/* Clears setup progress only; the program changes again only if the lifter confirms in the chats. */}
      {sheet === "redo" && (
        <ConfirmSheet title="Redo setup?" body="You'll meet each coach again. Your program and history stay as they are unless you change them in the chats."
          confirm="Start setup" danger={false} onClose={() => setSheet(null)}
          onConfirm={() => { setPref("profile", { ...prefs.profile, doneAt: null }); setPref("coachSetup", {}); go(href("coaches", "tank")); }} />
      )}
      {sheet === "rename" && <RenameSheet program={program} onRename={onRename} onClose={() => setSheet(null)} />}
    </main>
  );
}

/* Every workout's name in one place. Names are saved together on Save; a blank field keeps the old name. */
function RenameSheet({ program, onRename, onClose }) {
  const days = activeDays(program);
  const [names, setNames] = useState(() => Object.fromEntries(days.map((d) => [d, program[d].name])));
  const save = (e) => {
    e.preventDefault();
    for (const d of days) onRename(d, names[d] || "");
    onClose();
  };
  return (
    <Sheet title="Rename workouts" sub="Past sessions show the new name too." onClose={onClose} labelledBy="rename-title">
      <form className="rename-form" onSubmit={save}>
        {days.map((d, i) => (
          <label key={d} className="field rename-field" data-day={d}>
            <span className="lbl"><span className="dot" aria-hidden="true" />Day {i + 1} · {program[d].detail}</span>
            <input className="input" value={names[d]} maxLength={20} enterKeyHint="done" placeholder={program[d].name}
              onChange={(e) => setNames((n) => ({ ...n, [d]: e.target.value }))} />
          </label>
        ))}
        <button type="submit" className="btn btn-ink">Save names</button>
      </form>
    </Sheet>
  );
}

function Toggle({ Icon, label, sub, on, onChange, help }) {
  return (
    <button className="list-row" data-help={help} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <Icon size={18} aria-hidden="true" />
      <span className="name">{label}<span className="sub">{sub}</span></span>
      <span className="switch" aria-hidden="true" />
    </button>
  );
}

/* Step-by-step for the phone in hand. iOS only allows Add to Home Screen from Safari's share sheet. */
function InstallSheet({ onClose }) {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const steps = android
    ? [
        [null, <>Open <b>{location.host}</b> in Chrome.</>],
        [EllipsisVertical, <>Tap the <b>⋮</b> menu at the top right.</>],
        [SquarePlus, <>Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Install</b>.</>],
      ]
    : [
        [null, <>Open <b>{location.host}</b> in <b>Safari</b> and sign in with the same email.</>],
        [Share, <>Tap the <b>Share</b> button in the toolbar.</>],
        [SquarePlus, <>Scroll down and tap <b>Add to Home Screen</b>.</>],
        [null, <>Tap <b>Add</b>. GymBuddy now opens full screen, like an app.</>],
      ];
  return (
    <Sheet title="Add to your home screen" sub={ios || !android ? "On iPhone, in Safari" : "On Android, in Chrome"} onClose={onClose} labelledBy="install-title">
      {installed && <p className="note-box">You're in the home screen app now. To add it again, open GymBuddy in {android ? "Chrome" : "Safari"} first.</p>}
      <ol className="steps">
        {steps.map(([I, text], n) => (
          <li key={n}><span className="step-n">{n + 1}</span><span className="step-text">{text}</span>{I && <I size={20} aria-hidden="true" className="muted" />}</li>
        ))}
      </ol>
      <p className="note-box">Changing the icon? First press and hold GymBuddy on your home screen, tap <b>Remove App</b>, then <b>Delete from Home Screen</b>. Your sessions stay saved to your account.</p>
      <button className="btn btn-ink" onClick={onClose}>Got it</button>
    </Sheet>
  );
}
