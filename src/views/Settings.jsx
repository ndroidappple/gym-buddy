import React, { useEffect, useRef, useState } from "react";
import { ChevronRight, Download, LogOut, Moon, Gauge, Smartphone, Share, SquarePlus, EllipsisVertical, Check, Sparkles, Scale, Vibrate, Bell, BellRing, Users, Utensils, Target, Bookmark, Trash2, Rows3, CalendarClock, History, BellOff, BellPlus, Info, Dumbbell, HeartPulse, RefreshCw, Unlink } from "lucide-react";
import { Sheet, InfoButton, ConfirmSheet } from "../components/ui.jsx";
import { ICONS, iconSrc } from "../lib/icons.js";
import { VIEWS, applyView } from "../lib/view.js";
import { activeDays, specLine, isCardio } from "../data/program.js";
import { href } from "../lib/router.js";
import { shortDate, canVibrate } from "../lib/util.js";
import { supabase } from "../supabase-client.js";
import { restAlertState, enableRestAlerts, disableRestAlerts } from "../lib/restAlerts.js";
import { phoneState, allowNotifications, forgetPhone, warmPush } from "../lib/push.js";
import { reviewPrefs, whenLabel, coversLabel } from "../lib/weekReview.js";
import { DayPicker, HourPicker, PastReviewsSheet } from "../components/WeekReviewIntro.jsx";
import { HeadPicker } from "../components/Welcome.jsx";
import Coach from "../components/Coach.jsx";
import { COACHES } from "../data/coaches.js";
import { connectGoogleHealth, googleHealthStatus, disconnectGoogleHealth, syncGoogleHealth, connecting, doneConnecting } from "../lib/googleHealth.js";

/**
 * Grouped by what you're doing: your coach, your training, the rest timer, food, the week in review,
 * then how the app looks. Each feature keeps its own switches and notification together; the phone's
 * notification permission only shows, up top, when something you turned on can't reach you.
 */
export default function Settings({ program, sessions, prefs, setPref, go, notify, head = "tank", thread }) {
  const who = COACHES[head].name;
  const [email, setEmail] = useState("");
  const viewRow = useRef(null); // the detail level picker, held still on screen while the level switches
  const [sheet, setSheet] = useState(null); // "account" | "icon" | "install" | "redo" | "review-time" | "reviews" | "view" | "head" | "memory" | "clear-chat" | "google-health" | "google-health-off"
  const review = reviewPrefs(prefs);
  const setReview = (patch) => setPref("weekReview", { ...review, intro: true, ...patch });
  const alerts = useAlerts({ review, setReview, notify, onInstall: () => setSheet("install") });
  const gh = useGoogleHealth({ prefs, setPref, notify });
  const icon = ICONS.find((i) => i.id === prefs.icon) || ICONS[0];
  const days = activeDays(program);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || "")); }, []);

  return (
    <main className="screen has-tabs">
      <header className="top"><h1 className="page-title">Settings</h1><span className="spacer" /><InfoButton screen="settings" /></header>
      <div className="body">
        <div className="list">
          <button className="list-row account-row" data-help="account" onClick={() => setSheet("account")}>
            <span className="account-avatar" aria-hidden="true">{(email[0] || "?").toUpperCase()}</span>
            <span className="name">{email || "Your account"}<span className="sub detail">{sessions.length} session{sessions.length === 1 ? "" : "s"} logged · Export, sign out</span></span>
            <ChevronRight size={18} aria-hidden="true" className="muted" />
          </button>
        </div>

        {alerts.banner && (() => {
          const B = alerts.banner;
          const Tag = B.onClick ? "button" : "div";
          return (
            <div className="list alert-banner" role="status">
              <Tag className="list-row" {...(B.onClick ? { type: "button", onClick: B.onClick, disabled: alerts.busy } : {})}>
                <B.Icon size={18} aria-hidden="true" />
                <span className="name">{B.label}<span className="sub">{B.sub}</span></span>
                {B.onClick && <ChevronRight size={18} aria-hidden="true" className="muted" />}
              </Tag>
            </div>
          );
        })()}

        <section className="section">
          <h2 className="lbl">Coach</h2>
          <div className="list">
            <a className="list-row" data-help="coaches" href={href("coaches")}>
              <span className="row-coach" aria-hidden="true"><Coach id={head} size={22} still decorative /></span>
              <span className="name">Talk to {who}<span className="sub detail">Your head coach. Sees your training and food, and can change your plan.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </a>
            {thread && (
              <button className="list-row" data-help="memory" onClick={() => setSheet("memory")}>
                <Bookmark size={18} aria-hidden="true" />
                <span className="name">What {who} remembers<span className="sub">{thread.notes.length ? `${thread.notes.length} note${thread.notes.length === 1 ? "" : "s"} from your chats` : "Nothing yet. Tell them about injuries, equipment or your schedule."}</span></span>
                <ChevronRight size={18} aria-hidden="true" className="muted" />
              </button>
            )}
            <button className="list-row" data-help="head" onClick={() => setSheet("head")}>
              <Users size={18} aria-hidden="true" />
              <span className="name">Change head coach<span className="sub detail">The rest of the crew coach their lifts in the gym.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
            <button className="list-row" data-help="redo" onClick={() => setSheet("redo")}>
              <Sparkles size={18} aria-hidden="true" />
              <span className="name">Redo setup with your coaches<span className="sub detail">Goals, training days and the lifts each coach runs.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Training</h2>
          <div className="list">
            <a className="list-row" data-help="program" href={href("settings", "program")}>
              <Dumbbell size={18} aria-hidden="true" />
              <span className="name">Program<span className="sub">{days.length} day{days.length === 1 ? "" : "s"} · {days.map((d) => program[d].name).join(", ")}</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </a>
            {/* Phases live on Progress; this is the side door. */}
            <a className="list-row" href={href("progress", "phase")}>
              <Scale size={18} aria-hidden="true" />
              <span className="name">Bulk or cut phase<span className="sub">{prefs.phase ? `${prefs.phase.type === "cut" ? "Cut" : "Bulk"} to ${prefs.phase.target} lb · ends ${shortDate(prefs.phase.end)}` : "Set a short-term bodyweight goal."}</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </a>
            <Toggle help="rir" Icon={Gauge} label="Reps in reserve (RIR)" sub="Rate how many reps you had left on each set." on={prefs.rir}
              onChange={(v) => setPref("rir", v)} />
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Rest timer</h2>
          <div className="list" data-help="rest">
            <Toggle Icon={Bell} label="Sound" sub="A short chime when rest is over." on={prefs.sound !== false}
              onChange={(v) => setPref("sound", v)} />
            {/* iPhone browsers can't vibrate, so the switch only shows where it does something. */}
            {canVibrate() && (
              <Toggle Icon={Vibrate} label="Vibration" sub="A buzz on logged sets, PRs and when rest ends." on={prefs.haptics !== false}
                onChange={(v) => setPref("haptics", v)} />
            )}
            {alerts.phone !== "unsupported" && <Toggle Icon={BellRing} label="Lock screen alert" sub={alerts.restSub} on={alerts.rest === "on"} onChange={alerts.toggleRest} />}
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Nutrition</h2>
          <div className="list">
            {/* Turning it off only hides it: the food log and targets stay saved. */}
            <Toggle help="nutrition" Icon={Utensils} label="Track food & macros"
              sub={prefs.nutrition?.on ? "Nutrition tab is on. Turning it off keeps your log." : `Adds a Nutrition tab. ${who} sets your daily targets.`}
              on={!!prefs.nutrition?.on}
              onChange={(v) => { setPref("nutrition", { ...prefs.nutrition, on: v }); if (v && !prefs.nutrition?.targets) go(href("nutrition", "setup")); }} />
            {prefs.nutrition?.on && prefs.nutrition.targets && (
              <a className="list-row" href={href("nutrition", "setup")}>
                <Target size={18} aria-hidden="true" />
                <span className="name">Daily targets<span className="sub">{prefs.nutrition.targets.kcal.toLocaleString()} kcal · {prefs.nutrition.targets.protein} g protein. Redo with {who}.</span></span>
                <ChevronRight size={18} aria-hidden="true" className="muted" />
              </a>
            )}
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Week in review</h2>
          <div className="list">
            <Toggle help="review" Icon={Sparkles} label="Weekly look back"
              sub="Your coaches review your goals, highs and lows, and trends."
              on={review.on} onChange={(v) => setReview({ on: v })} />
            {review.on && (
              <button className="list-row" onClick={() => setSheet("review-time")}>
                <CalendarClock size={18} aria-hidden="true" />
                <span className="name">Release day<span className="sub">{whenLabel(review)}. Covers {coversLabel(review)}.</span></span>
                <ChevronRight size={18} aria-hidden="true" className="muted" />
              </button>
            )}
            {review.on && alerts.phone !== "unsupported" && (
              <Toggle Icon={BellRing} label="Notify me when it's ready" sub={alerts.reviewSub} on={review.notify !== false} onChange={alerts.toggleReview} />
            )}
            <button className="list-row" onClick={() => setSheet("reviews")}>
              <History size={18} aria-hidden="true" />
              <span className="name">Past reviews<span className="sub detail">Every week in review is saved to your account.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Connected apps</h2>
          <div className="list">
            <button className="list-row" onClick={() => setSheet("google-health")}>
              <HeartPulse size={18} aria-hidden="true" />
              <span className="name">Google Health<span className="sub">{gh.sub}</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Appearance</h2>
          <div className="list">
            <ViewPicker value={prefs.view === "focused" ? "focused" : "detailed"} row={viewRow} onChange={(v) => setPref("view", v)} onInfo={() => setSheet("view")} />
            <Toggle Icon={Moon} label="Dark mode" sub="Easier on the eyes between sets." on={prefs.theme === "dark"}
              onChange={(v) => setPref("theme", v ? "dark" : "light")} />
            <button className="list-row" onClick={() => setSheet("icon")}>
              <img className="app-icon sm" src={iconSrc(icon.id)} alt="" />
              <span className="name">App icon<span className="sub">{icon.label}</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
            <button className="list-row" onClick={() => setSheet("install")}>
              <Smartphone size={18} aria-hidden="true" />
              <span className="name">Add GymBuddy to your home screen<span className="sub detail">Opens full screen, like an app.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
          </div>
        </section>
      </div>

      {sheet === "account" && (
        <Sheet title="Account" sub={email || undefined} onClose={() => setSheet(null)} labelledBy="account-title">
          <div className="list">
            <a className="list-row" href="#/settings/export">
              <Download size={18} aria-hidden="true" />
              <span className="name">Export your data<span className="sub">{sessions.length} sessions as CSV or JSON</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </a>
            <div className="list-row">
              <Scale size={18} aria-hidden="true" />
              <span className="name">Units<span className="sub">Weights are in pounds.</span></span>
            </div>
            <button className="list-row" onClick={() => supabase.auth.signOut()}>
              <LogOut size={18} aria-hidden="true" />
              <span className="name">Sign out<span className="sub">Your data stays saved to your account.</span></span>
            </button>
          </div>
        </Sheet>
      )}
      {sheet === "view" && (
        <ViewSheet value={prefs.view === "focused" ? "focused" : "detailed"} program={program} onPick={(v) => switchView(v, viewRow.current, (x) => setPref("view", x))} onClose={() => setSheet(null)} />
      )}
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
          onConfirm={() => { setPref("profile", { ...prefs.profile, doneAt: null }); setPref("coachSetup", {}); go(href("coaches", head)); }} />
      )}
      {sheet === "head" && (
        <HeadSheet head={head} onClose={() => setSheet(null)}
          onPick={(id) => { setPref("headCoach", id); notify?.(`${COACHES[id].name} is your head coach`); setSheet(null); }} />
      )}
      {sheet === "memory" && thread && (
        <Sheet title={`What ${who} remembers`} sub="Notes your head coach keeps from your chats and reads before every answer. Delete any you don't want kept." onClose={() => setSheet(null)} labelledBy="memory-title">
          {thread.notes.length ? (
            <div className="list">
              {thread.notes.map((n) => (
                <div key={n} className="list-row memory-row">
                  <span className="name">{n}</span>
                  <button type="button" className="icon-btn" aria-label={`Forget: ${n}`} onClick={() => thread.setNotes(thread.notes.filter((x) => x !== n))}><Trash2 size={18} /></button>
                </div>
              ))}
            </div>
          ) : <p className="note-box">Nothing saved yet. When you tell {who} something worth keeping, like a sore knee, your equipment or when you train, it shows up here.</p>}
          <p className="small muted">Your chat with {who} is kept for 30 days.</p>
          <button type="button" className="btn btn-ghost" onClick={() => setSheet("clear-chat")} disabled={!thread.messages.length}>Clear chat history</button>
        </Sheet>
      )}
      {sheet === "clear-chat" && thread && (
        <ConfirmSheet title="Clear chat history?" body={`Every message with ${who} is deleted from this phone and your account. What ${who} remembers stays until you delete it.`}
          confirm="Clear history" onClose={() => setSheet("memory")}
          onConfirm={() => { thread.clearMessages(); notify?.("Chat history cleared"); }} />
      )}
      {sheet === "review-time" && (
        <Sheet title="Release day" sub="Your coaches write the review at this time, even with the app closed." onClose={() => setSheet(null)} labelledBy="review-time-title">
          <DayPicker value={review.day} onChange={(d) => setReview({ day: d })} />
          <HourPicker value={review.hour} onChange={(h) => setReview({ hour: h })} />
          <p className="note-box"><b>{whenLabel(review)}</b>, covering {coversLabel(review)}: the 7 full days before it's released. It waits on Today until you open it.</p>
          <button type="button" className="btn btn-ink" onClick={() => setSheet(null)}>Done</button>
        </Sheet>
      )}
      {sheet === "reviews" && <PastReviewsSheet onClose={() => setSheet(null)} />}
      {sheet === "google-health" && <GoogleHealthSheet gh={gh} onDisconnect={() => setSheet("google-health-off")} onClose={() => setSheet(null)} />}
      {sheet === "google-health-off" && (
        <ConfirmSheet title="Disconnect Google Health?" body="GymBuddy stops sending to Google Health. What's already there stays until you delete it in the Google Health app."
          confirm="Disconnect" onClose={() => setSheet(null)} onConfirm={gh.disconnect} />
      )}
    </main>
  );
}

/**
 * Notifications: rest alerts (this phone only: they ride on its notification permission, so they live
 * outside prefs) and the week in review's "ready" notification (the account: every phone that allows
 * notifications gets it). `banner` is the phone's permission, only while something turned on can't arrive.
 */
function useAlerts({ review, setReview, notify, onInstall }) {
  const [phone, setPhone] = useState(phoneState);
  const [rest, setRest] = useState(restAlertState);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (phone === "ask" || rest === "off") warmPush().catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { setPhone(phoneState()); setRest(restAlertState()); };
  const reviewOn = review.on && review.notify !== false;
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch { notify?.("Couldn't change notifications. Check your connection and try again."); } finally { refresh(); setBusy(false); }
  };
  // Nothing on this phone wants notifications any more: stop the server sending to it.
  const tidy = (restOn, reviewWants) => { if (!restOn && !reviewWants) forgetPhone().catch(() => {}); };
  const blocked = () => {
    if (phone === "install") { onInstall(); return true; }
    if (phone === "denied") { notify?.("Notifications are blocked. Turn them on in your phone's Settings › Notifications › GymBuddy."); return true; }
    return phone === "unsupported";
  };

  const allow = () => run(async () => {
    const p = await allowNotifications();
    if (p === "denied") notify?.("Notifications are blocked. Turn them on in your phone's Settings › Notifications › GymBuddy.");
  });
  const toggleRest = (v) => {
    if (v && blocked()) return;
    run(async () => {
      if (v) {
        const s = await enableRestAlerts();
        if (s === "on") notify?.("Rest alerts on. Using a Focus? Allow GymBuddy in it.");
      } else {
        await disableRestAlerts();
        tidy(false, reviewOn);
      }
    });
  };
  const toggleReview = (v) => {
    setReview({ notify: v });
    if (!v) { tidy(rest === "on", false); return; }
    if (phone === "ask") allow(); // asked from this tap: iOS only shows the prompt in response to one
  };

  const banner = !reviewOn ? null : {
    ask: { Icon: BellPlus, label: "Allow notifications on this phone", sub: "So your week in review reaches you here.", onClick: allow },
    denied: { Icon: BellOff, label: "Notifications are blocked", sub: "Turn them on in your phone's Settings › Notifications › GymBuddy." },
    install: { Icon: BellOff, label: "Add GymBuddy to your home screen", sub: "iPhone only shows notifications for the home screen app.", onClick: onInstall },
  }[phone] || null;
  const restSub = { install: "Add GymBuddy to your home screen first.", denied: "Blocked in your phone's settings." }[rest] || "A notification when rest is over, even with your phone locked. This phone only.";
  const reviewSub = phone !== "on" && review.notify !== false ? `${whenLabel(review)}. Allow notifications on this phone to get it here.`
    : `${whenLabel(review)}, with the week's headline. Every phone that allows notifications.`;
  return { phone, rest, busy, banner, restSub, reviewSub, toggleRest, toggleReview };
}

/* Switching the detail level adds or removes the grey lines on the rows above the picker, which
   would shove the picker (and the page behind the examples sheet) up or down under the finger. So the new level goes on right away, before
   the next paint, and the page scrolls by however far the anchor moved: it stays put on screen. */
function switchView(v, anchor, onChange) {
  const before = anchor?.getBoundingClientRect().top;
  applyView(v);
  if (anchor) window.scrollBy({ top: anchor.getBoundingClientRect().top - before, behavior: "instant" });
  onChange(v);
}

/** Detailed or Focused: how much each screen explains. One row, two choices, shown live; (i) shows examples. */
function ViewPicker({ row, value, onChange, onInfo }) {
  const cur = VIEWS.find((v) => v.id === value) || VIEWS[0];
  return (
    <div className="list-row view-row" ref={row}>
      <Rows3 size={18} aria-hidden="true" />
      <span className="name">Detail level<span className="sub">{cur.sub}</span></span>
      <button type="button" className="icon-btn view-info" onClick={onInfo} aria-label="See what each detail level changes"><Info size={20} aria-hidden="true" /></button>
      <div className="segctl view-seg" role="group" aria-label="Detail level">
        {VIEWS.map((v) => <button key={v.id} aria-pressed={v.id === value} onClick={() => v.id !== value && switchView(v.id, row.current, onChange)}>{v.label}</button>)}
      </div>
    </div>
  );
}

/* The same things shown both ways, using the lifter's own first workout and lift. The examples
   are drawn without `.detail` (which Focused hides) so both versions show whichever level is on. */
function ViewSheet({ value, program, onPick, onClose }) {
  const d = activeDays(program)[0];
  const day = program[d];
  const ex = day?.exercises.find((e) => !isCardio(e.n)) || { n: "Incline Barbell / Smith Press", sets: 4, reps: [6, 10], rest: 120 };
  const examples = [
    {
      title: "Lists",
      shows: (more) => (
        <div className="list view-ex-list">
          <div className="list-row"><span className="name">{day?.name || "Push"}{more && <span className="sub">{day?.detail || "Chest + Triceps"} · {day?.exercises.length ?? 6} lifts</span>}</span><ChevronRight size={18} aria-hidden="true" className="muted" /></div>
          <div className="list-row"><span className="name">Your coaches{more && <span className="sub">Ask a question or change your plan.</span>}</span><ChevronRight size={18} aria-hidden="true" className="muted" /></div>
        </div>
      ),
    },
    {
      title: "During a workout",
      shows: (more) => (
        <div className="card view-ex-card">
          <div className="ex-name">{ex.n}</div>
          <div className="ex-spec">{specLine(ex)}</div>
          {more && <p className="view-ex-note">First time logging this one. Today sets the baseline.</p>}
        </div>
      ),
    },
    {
      title: "Cards",
      shows: (more) => (
        <div className="card phase-card phase-empty view-ex-card">
          <span className="weigh-icon" aria-hidden="true"><Scale size={22} /></span>
          <span className="phase-text"><b>Bulk or cut?</b>{more && <span>Set a short-term bodyweight goal and your coaches track the pace.</span>}</span>
          <span className="pill">Start</span>
        </div>
      ),
    },
  ];
  return (
    <Sheet title="Detail level" sub="The same screens, with or without the grey lines that explain them." onClose={onClose} labelledBy="view-title" className="keep-sub">
      <div className="view-examples">
        {examples.map(({ title, shows }) => (
          <section key={title} className="view-ex">
            <h3 className="lbl">{title}</h3>
            {VIEWS.map((v) => (
              <div key={v.id} className="view-ex-side">
                <span className={"view-tag" + (v.id === value ? " on" : "")}>{v.label}{v.id === value ? " · on" : ""}</span>
                {shows(v.id === "detailed")}
              </div>
            ))}
          </section>
        ))}
        <p className="note-box">Either way, everything you act on stays: <b>numbers, targets, buttons and errors</b>. Focused also tightens rows a little, so more fits on screen mid-workout.</p>
      </div>
      <div className="segctl" role="group" aria-label="Detail level">
        {VIEWS.map((v) => <button key={v.id} aria-pressed={v.id === value} onClick={() => v.id !== value && onPick(v.id)}>{v.label}</button>)}
      </div>
    </Sheet>
  );
}

/**
 * Google Health: whether it's connected (prefs.googleHealth, on the account) and the server's word on
 * it. Coming back from Google's page (or opening Settings while connected) asks the server, so a
 * connection made on Google's page, or taken away in the Google account, shows up here.
 */
function useGoogleHealth({ prefs, setPref, notify }) {
  const on = !!prefs.googleHealth?.on;
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    try {
      const s = await googleHealthStatus();
      setStatus(s);
      if (s.connected && (!on || prefs.googleHealth.heart !== !!s.allowed?.heart)) {
        setPref("googleHealth", { on: true, since: s.since, heart: !!s.allowed?.heart });
        if (!on && connecting()) notify?.("Google Health connected");
      }
      if (!s.connected && on) setPref("googleHealth", null);
      if (s.connected) doneConnecting();
    } catch {}
  };
  useEffect(() => {
    if (on || connecting()) check();
    const onVis = () => { if (document.visibilityState === "visible" && connecting()) check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { notify?.(e.message); } finally { setBusy(false); }
  };
  const since = status?.since || prefs.googleHealth?.since;
  const last = status?.syncedAt ? new Date(status.syncedAt) : null;
  const lastLabel = last && (last.toDateString() === new Date().toDateString()
    ? last.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : shortDate(last.toISOString().slice(0, 10)));
  return {
    on, status, busy,
    since,
    lastLabel,
    sub: !on ? "Heart rate in, for how hard you worked. Weight and food out."
      : status?.error ? "Some items didn't go through. They'll be tried again."
      : `On since ${since ? shortDate(since) : "today"}${lastLabel ? ` · last synced ${lastLabel}` : ""}`,
    connect: () => run(connectGoogleHealth),
    sendNow: () => run(async () => {
      const r = await syncGoogleHealth();
      if (!r.connected) { setPref("googleHealth", null); notify?.("Google Health disconnected. Connect again to keep sending."); return; }
      notify?.(r.error || (r.sent || r.removed ? `Sent to Google Health` : "Google Health is up to date"));
      check();
    }),
    disconnect: () => run(async () => {
      await disconnectGoogleHealth();
      setPref("googleHealth", null);
      setStatus({ connected: false });
      notify?.("Google Health disconnected");
    }),
  };
}

/* What connecting shares, said before Google's page asks (Google requires it in the app, not only
   in the privacy policy), or the connection's state once it's on. */
function GoogleHealthSheet({ gh, onDisconnect, onClose }) {
  const allowed = gh.status?.allowed;
  const missing = allowed ? [["heart", "heart rate"], ["weight", "weight"], ["food", "food"]].filter(([k]) => !allowed[k]).map(([, l]) => l) : [];
  if (!gh.on) {
    return (
      <Sheet title="Google Health" sub="Bring your watch's heart rate into your workouts, and keep your weight and food in Google Health." onClose={onClose} labelledBy="google-health-title">
        <div className="list">
          <div className="list-row"><HeartPulse size={18} aria-hidden="true" /><span className="name">Heart rate, read<span className="sub">Only during your workouts in the last 30 days and from now on, to show how hard each workout and set was. Your coaches see the summary.</span></span></div>
          <div className="list-row"><Scale size={18} aria-hidden="true" /><span className="name">Bodyweight, sent<span className="sub">Your weigh-ins, from the day you connect.</span></span></div>
          <div className="list-row"><Utensils size={18} aria-hidden="true" /><span className="name">Food, sent<span className="sub">Each entry's calories, protein, carbs and fat, from the day you connect.</span></span></div>
        </div>
        <p className="note-box">GymBuddy doesn't send workouts: record them in Google Health from your watch as you do now. It reads nothing else there. Open the Google Health app and sign in before you connect. <a href="/privacy.html" target="_blank" rel="noopener">Privacy policy</a></p>
        <button type="button" className="btn btn-ink" disabled={gh.busy} onClick={gh.connect}>{gh.busy ? "Opening Google…" : "Connect Google Health"}</button>
        <p className="small muted">Google's page opens over GymBuddy. Once it says connected, close it and come back here.</p>
      </Sheet>
    );
  }
  return (
    <Sheet title="Google Health" sub={`Connected since ${gh.since ? shortDate(gh.since) : "today"}.`} onClose={onClose} labelledBy="google-health-title">
      <div className="list">
        {allowed?.heart !== false && (
          <div className="list-row"><HeartPulse size={18} aria-hidden="true" /><span className="name">Heart rate<span className="sub">Each workout's heart rate shows on it once your watch has synced to Google Health, usually within the hour.</span></span></div>
        )}
        <div className="list-row"><Check size={18} aria-hidden="true" /><span className="name">{gh.lastLabel ? `Weight and food last sent ${gh.lastLabel}` : "No weight or food sent yet"}<span className="sub">New weigh-ins and food go a few seconds after they're saved. Edits and deletes follow.</span></span></div>
        {missing.length > 0 && (
          <div className="list-row"><Info size={18} aria-hidden="true" /><span className="name">Not allowed: {missing.join(", ")}<span className="sub">To turn it on, disconnect, connect again and tick it on Google's page.</span></span></div>
        )}
        {gh.status?.error && (
          <div className="list-row"><Info size={18} aria-hidden="true" /><span className="name">Some items didn't go through<span className="sub">They'll be tried again with the next change, or tap Send now.</span></span></div>
        )}
        <button type="button" className="list-row" disabled={gh.busy} onClick={gh.sendNow}>
          <RefreshCw size={18} aria-hidden="true" />
          <span className="name">{gh.busy ? "Sending…" : "Send now"}<span className="sub">Catch up right away.</span></span>
        </button>
        <button type="button" className="list-row" disabled={gh.busy} onClick={onDisconnect}>
          <Unlink size={18} aria-hidden="true" />
          <span className="name">Disconnect<span className="sub">Stop sending. What's in Google Health stays there.</span></span>
        </button>
      </div>
    </Sheet>
  );
}

function Toggle({ Icon, label, sub, on, onChange, help }) {
  return (
    <button className="list-row" data-help={help} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <Icon size={18} aria-hidden="true" />
      <span className="name">{label}<span className="sub detail">{sub}</span></span>
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
    <Sheet title="Add to your home screen" sub={ios || !android ? "On iPhone, in Safari" : "On Android, in Chrome"} onClose={onClose} labelledBy="install-title" className="keep-sub">
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

/** Switching head coach: swipe to one, then confirm, so passing coaches on the way doesn't switch. */
function HeadSheet({ head, onPick, onClose }) {
  const [pick, setPick] = useState(head);
  return (
    <Sheet title="Head coach" sub="Who you talk to about training and food. Your chat and their notes carry over." onClose={onClose} labelledBy="head-coach-title">
      <HeadPicker value={pick} onChange={setPick} />
      {pick === head
        ? <button type="button" className="btn btn-ghost" onClick={onClose}>Keep {COACHES[head].name}</button>
        : <button type="button" className="btn btn-ink" onClick={() => onPick(pick)}>Make {COACHES[pick].name} head coach</button>}
    </Sheet>
  );
}
