import React, { useEffect, useRef, useState } from "react";
import { ChevronRight, Download, LogOut, Moon, Gauge, Smartphone, Share, SquarePlus, EllipsisVertical, Check, Sparkles, Scale, Vibrate, Bell, BellRing, Pencil, ClipboardPaste, Users, Utensils, Target, Bookmark, Trash2, Rows3, CalendarClock, History, BellOff, BellPlus, Info } from "lucide-react";
import { Sheet, InfoButton, ConfirmSheet } from "../components/ui.jsx";
import { ICONS, iconSrc } from "../lib/icons.js";
import { VIEWS, applyView } from "../lib/view.js";
import { DAYS, allDays, activeDays, specLine, isCardio } from "../data/program.js";
import { href } from "../lib/router.js";
import { shortDate, canVibrate } from "../lib/util.js";
import { supabase } from "../supabase-client.js";
import { restAlertState, enableRestAlerts, disableRestAlerts } from "../lib/restAlerts.js";
import { phoneState, allowNotifications, forgetPhone, warmPush } from "../lib/push.js";
import { reviewPrefs, whenLabel, coversLabel } from "../lib/weekReview.js";
import { DayPicker, HourPicker, ReviewList } from "../components/WeekReviewIntro.jsx";
import { HeadPicker } from "../components/Welcome.jsx";
import Coach from "../components/Coach.jsx";
import { COACHES } from "../data/coaches.js";

export default function Settings({ program, sessions, prefs, setPref, onRename, go, notify, head = "tank", thread }) {
  const who = COACHES[head].name;
  const [email, setEmail] = useState("");
  const viewRow = useRef(null); // the detail level picker, held still on screen while the level switches
  const [sheet, setSheet] = useState(null); // "icon" | "install" | "rename" | "redo" | "review-time" | "reviews" | "view" | "head" | "memory" | "clear-chat"
  const review = reviewPrefs(prefs);
  const setReview = (patch) => setPref("weekReview", { ...review, intro: true, ...patch });
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
                <span className="name">{program[d].name}<span className="sub detail">{program[d].off ? "Not in your rotation" : `${program[d].detail} · ${program[d].exercises.length} lifts`}</span></span>
                <ChevronRight size={18} aria-hidden="true" className="muted" />
              </a>
            ))}
            <button className="list-row" data-help="rename" onClick={() => setSheet("rename")}>
              <Pencil size={18} aria-hidden="true" />
              <span className="name">Rename workouts<span className="sub detail">{activeDays(program).map((d) => program[d].name).join(", ")}</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
            {/* The head coach's paste-and-review steps on their own, for a lifter who's already set up. */}
            <a className="list-row" data-help="import" href={href("coaches", head, "import")}>
              <ClipboardPaste size={18} aria-hidden="true" />
              <span className="name">Bring in your own program<span className="sub detail">Paste a program you already run. {who} can review it.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </a>
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Coaches &amp; goals</h2>
          <div className="list">
            <a className="list-row" data-help="coaches" href={href("coaches")}>
              <Users size={18} aria-hidden="true" />
              <span className="name">Talk to {who}<span className="sub detail">Your head coach. Sees your training and food, and can change your plan.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </a>
            <button className="list-row" data-help="head" onClick={() => setSheet("head")}>
              <span className="row-coach" aria-hidden="true"><Coach id={head} size={22} still decorative /></span>
              <span className="name">Head coach<span className="sub">{who}. The rest of the crew coach their lifts in the gym.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
            {thread && (
              <button className="list-row" data-help="memory" onClick={() => setSheet("memory")}>
                <Bookmark size={18} aria-hidden="true" />
                <span className="name">What {who} remembers<span className="sub">{thread.notes.length ? `${thread.notes.length} note${thread.notes.length === 1 ? "" : "s"} from your chats` : "Nothing yet. Tell them about injuries, equipment or your schedule."}</span></span>
                <ChevronRight size={18} aria-hidden="true" className="muted" />
              </button>
            )}
            {/* Phases live on Progress; this is the side door. */}
            <a className="list-row" href={href("progress", "phase")}>
              <Scale size={18} aria-hidden="true" />
              <span className="name">Bulk or cut phase<span className="sub">{prefs.phase ? `${prefs.phase.type === "cut" ? "Cut" : "Bulk"} to ${prefs.phase.target} lb · ends ${shortDate(prefs.phase.end)}` : "Set a short-term bodyweight goal."}</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </a>
            <button className="list-row" data-help="redo" onClick={() => setSheet("redo")}>
              <Sparkles size={18} aria-hidden="true" />
              <span className="name">Redo setup with your coaches<span className="sub detail">Goals, training days and the lifts each coach runs.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
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
            <Toggle help="review" Icon={Sparkles} label="Week in review"
              sub={review.on ? "Your coaches look back at your week: goals, highs and lows, trends." : "A weekly look back with your coaches: goals, highs and lows, trends."}
              on={review.on} onChange={(v) => setReview({ on: v })} />
            {review.on && (
              <button className="list-row" onClick={() => setSheet("review-time")}>
                <CalendarClock size={18} aria-hidden="true" />
                <span className="name">Comes out<span className="sub">{whenLabel(review)}. Covers {coversLabel(review)}.</span></span>
                <ChevronRight size={18} aria-hidden="true" className="muted" />
              </button>
            )}
            <button className="list-row" onClick={() => setSheet("reviews")}>
              <History size={18} aria-hidden="true" />
              <span className="name">Past reviews<span className="sub detail">Every week in review is saved to your account.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Notifications</h2>
          <Notifications review={review} setReview={setReview} notify={notify} onInstall={() => setSheet("install")} />
        </section>

        <section className="section">
          <h2 className="lbl">Display</h2>
          <div className="list">
            <ViewPicker value={prefs.view === "focused" ? "focused" : "detailed"} row={viewRow} onChange={(v) => setPref("view", v)} onInfo={() => setSheet("view")} />
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
              <span className="name">Add GymBuddy to your home screen<span className="sub detail">Opens full screen, like an app.</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Data</h2>
          <div className="list">
            <a className="list-row" data-help="export" href="#/settings/export">
              <Download size={18} aria-hidden="true" />
              <span className="name">Export<span className="sub detail">{sessions.length} sessions as CSV or JSON</span></span>
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
              <span className="name">Sign out<span className="sub detail">Your data stays saved to your account.</span></span>
            </button>
          </div>
        </section>

        <p className="small muted detail">Weights are in pounds.</p>
      </div>

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
        <Sheet title="Head coach" sub="Who you talk to about your training and food. Your chat history and notes carry over." onClose={() => setSheet(null)} labelledBy="head-coach-title">
          <HeadPicker value={head} onChange={(id) => { if (id !== head) { setPref("headCoach", id); notify?.(`${COACHES[id].name} is your head coach`); } }} />
          <button type="button" className="btn btn-ink" onClick={() => setSheet(null)}>Done</button>
        </Sheet>
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
      {sheet === "rename" && <RenameSheet program={program} onRename={onRename} onClose={() => setSheet(null)} />}
      {sheet === "review-time" && (
        <Sheet title="When it comes out" sub="Your coaches write the review at this time, even with the app closed." onClose={() => setSheet(null)} labelledBy="review-time-title">
          <DayPicker value={review.day} onChange={(d) => setReview({ day: d })} />
          <HourPicker value={review.hour} onChange={(h) => setReview({ hour: h })} />
          <p className="note-box"><b>{whenLabel(review)}</b>, covering {coversLabel(review)}: the 7 full days before it comes out. It waits on Today until you open it.</p>
          <button type="button" className="btn btn-ink" onClick={() => setSheet(null)}>Done</button>
        </Sheet>
      )}
      {sheet === "reviews" && <ReviewsSheet onClose={() => setSheet(null)} />}
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

/* Rest alerts are per phone (they ride on its notification permission), so they live outside prefs. */
/**
 * Notifications: whether this phone can show them, rest alerts (this phone only) and the week in
 * review's "ready" notification (the account: every phone that allows notifications gets it).
 */
function Notifications({ review, setReview, notify, onInstall }) {
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

  const status = {
    on: { Icon: Bell, label: "On for this phone", sub: "To stop them all, use your phone's Settings › Notifications › GymBuddy." },
    ask: { Icon: BellPlus, label: "Allow notifications on this phone", sub: "Needed for rest alerts and the week in review.", onClick: allow },
    denied: { Icon: BellOff, label: "Blocked on this phone", sub: "Turn them on in your phone's Settings › Notifications › GymBuddy." },
    install: { Icon: BellOff, label: "Add GymBuddy to your home screen", sub: "iPhone only shows notifications for the home screen app.", onClick: onInstall },
    unsupported: { Icon: BellOff, label: "Not available in this browser", sub: "Open GymBuddy in Safari or Chrome on your phone." },
  }[phone];
  const Status = status.onClick ? "button" : "div";
  const restSub = { install: "Add GymBuddy to your home screen first.", denied: "Blocked in your phone's settings." }[rest] || "When rest is over, even with your phone locked. This phone only.";
  const reviewSub = !review.on ? "Turn on the week in review above first."
    : phone !== "on" && review.notify !== false ? `${whenLabel(review)}. Allow notifications on this phone to get it here.`
    : `${whenLabel(review)}, with the week's headline. Every phone that allows notifications.`;
  return (
    <div className="list" data-help="notifications">
      <Status className="list-row" {...(status.onClick ? { type: "button", onClick: status.onClick, disabled: busy } : {})}>
        <status.Icon size={18} aria-hidden="true" />
        <span className="name">{status.label}<span className="sub detail">{status.sub}</span></span>
        {status.onClick ? <ChevronRight size={18} aria-hidden="true" className="muted" /> : phone === "on" ? <Check size={18} strokeWidth={2.6} aria-hidden="true" /> : null}
      </Status>
      {phone !== "unsupported" && <Toggle Icon={BellRing} label="Rest alerts" sub={restSub} on={rest === "on"} onChange={toggleRest} />}
      {phone !== "unsupported" && review.on && (
        <Toggle Icon={Sparkles} label="Week in review is ready" sub={reviewSub} on={review.notify !== false} onChange={toggleReview} />
      )}
    </div>
  );
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

/** Every saved week in review; opening one closes the sheet first so back returns to Settings. */
function ReviewsSheet({ onClose }) {
  const [count, setCount] = useState(null);
  return (
    <Sheet title="Past reviews" sub="Every week in review, newest first." onClose={onClose} labelledBy="reviews-title">
      <ReviewList onLoaded={setCount} />
      {count === null && <p className="note-box">Loading…</p>}
      {count === 0 && <p className="note-box">No reviews yet. Your first one comes out on your review day, once you've logged a workout or some food that week.</p>}
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
