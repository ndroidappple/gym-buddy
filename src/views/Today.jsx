import React, { useMemo, useRef, useState } from "react";
import { InfoButton, Sheet } from "../components/ui.jsx";
import { Scale, ArrowLeftRight, Check, X, Moon } from "lucide-react";
import { readiness, lowLine } from "../lib/recovery.js";
import { DAYS, CUSTOM, activeDays } from "../data/program.js";
import { href } from "../lib/router.js";
import { COACHES, coachesFor } from "../data/coaches.js";
import SetupCard from "../components/SetupCard.jsx";
import { nextCoachToMeet } from "../lib/setup.js";
import { weighInEvery, phaseStatus, statusLine, PHASE_TYPES } from "../lib/phase.js";
import Coach from "../components/Coach.jsx";
import { ReviewChip } from "../components/WeekReviewIntro.jsx";
import { collapse } from "../lib/motion.js";
import { byDateDesc, bestSet, fmtW, num, shortDate, weekDates, today, nextDayAfter, bodyweightSeries, daysBetween, plural, readyToIncrease, nextGoal, fmtGoal } from "../lib/util.js";

export default function Today({ name, sessions, program, drafts, weighins, prefs, onWeighin, foodToday, review, head, recovery }) {
  const sorted = useMemo(() => [...sessions].sort(byDateDesc), [sessions]);
  const draftDay = [...activeDays(program), CUSTOM].find((d) => drafts[d]);
  const t = today();
  const [pick, setPick] = useState(loadPick);
  const [choosing, setChoosing] = useState(false);
  // A swapped day holds for today only, until the next session is logged.
  const picked = pick && pick.date === t && pick.after === sessions.length && program[pick.day] ? pick.day : null;
  const suggested = nextDayAfter(sessions, program);
  // A workout in progress leads unless the lifter picked another day; that draft stays saved.
  const fallback = draftDay || suggested;
  const day = picked || fallback;
  const p = program[day];
  const draft = drafts[day];
  const lastOfDay = sorted.find((s) => s.day === day);
  // Last night was short or under-recovered for this lifter (Google Health): said once, before training today.
  const nightNote = prefs.googleHealth?.on && !sessions.some((s) => s.date === t) ? lowLine(readiness(recovery, t)) : null;
  const choose = (d) => {
    const next = d === fallback ? null : { date: t, day: d, after: sessions.length };
    setPick(next);
    try { next ? localStorage.setItem(PICK_KEY, JSON.stringify(next)) : localStorage.removeItem(PICK_KEY); } catch {}
    setChoosing(false);
  };

  const weigh = useWeighIn(sessions, weighins, prefs?.phase);
  const lastDone = (d) => { const last = sorted.find((s) => s.day === d); return last ? `last done ${shortDate(last.date)}` : "not done yet"; };

  const setsLogged = draft ? Object.values(draft.grid || {}).reduce((a, rows) => a + rows.filter((r) => r.done).length, 0) : 0;
  const plannedSets = p.exercises.reduce((a, e) => a + e.sets, 0);
  const crew = useMemo(() => coachesFor(p.exercises.map((e) => e.n)), [p]);
  const daysOff = sorted[0] ? daysBetween(sorted[0].date, t) : null;
  // The coach up top is the head coach: tapping them opens your conversation.
  const lead = head || crew[0];

  /* Typical length of this day, from sessions with both start and finish times. */
  const usualMins = useMemo(() => {
    const mins = sessions.filter((s) => s.day === day && s.startedAt && s.finishedAt)
      .map((s) => (s.finishedAt - s.startedAt) / 60000).filter((m) => m >= 5 && m <= 240);
    return mins.length ? Math.round(mins.reduce((a, m) => a + m, 0) / mins.length) : null;
  }, [sessions, day]);

  // Lifts that earned more weight lead the list; the rest show the set that beats last time's best.
  // After a short or under-recovered night the targets are last time's best, as the workout will be.
  const easy = !!nightNote;
  const targets = useMemo(() => p.exercises.map((ex) => {
    const prior = sorted.find((s) => s.sets[ex.n]?.length);
    const best = prior && bestSet(prior.sets[ex.n]);
    if (!best) return null;
    return easy
      ? { n: ex.n, best, next: ex.next, bump: null, goal: { w: best.w, r: best.r, sets: 1 } }
      : { n: ex.n, best, next: ex.next, bump: readyToIncrease(ex, prior.sets[ex.n]), goal: nextGoal(ex, prior.sets[ex.n]) };
  }).filter(Boolean).sort((a, b) => !!(b.next || b.bump) - !!(a.next || a.bump)).slice(0, 3), [p, sorted, easy]);

  const week = weekDates();
  const byDate = useMemo(() => {
    const m = {};
    sessions.forEach((s) => { m[s.date] ||= s.day; });
    return m;
  }, [sessions]);
  const doneThisWeek = week.filter((d) => byDate[d]).length;

  const names = crew.map((id) => COACHES[id].name);
  const onDeck = names.length <= 2 ? names.join(" & ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  // The name appears once: in the headline on odd days, in the coach's hello on even days (and
  // always in the hello when a workout's in progress, since that headline has no name).
  const nameInTitle = !draft && Math.floor(new Date(t + "T12:00:00").getTime() / 864e5) % 2 === 1;
  const to = name && nameInTitle ? `, ${name}` : "";
  const headline = draft ? "Pick up where you left off." : daysOff != null && daysOff >= 5 ? `${daysOff} days off${to}. Back to it.` : `${p.name} day${to}. Let's lift.`;

  return (
    <main className="screen has-tabs">
      <header className="top today-top">
        <div className="today-row">
          <span className="lbl">{new Date(t + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
          {/* The coach and their hello read as one unit; the hello also shows the coach is tappable.
              When the week in review is out, the coach hands it over instead of saying hello. */}
          <div className="today-coach" style={{ "--c": COACHES[lead]?.color }}>
            {review
              ? <ReviewChip weekEnd={review.weekEnd} glow={review.glow} />
              : <a className="coach-hello" href="#/coaches" aria-hidden="true" tabIndex={-1}>{greeting(nameInTitle ? null : name, daysOff)}</a>}
            <a className="coach-link" href="#/coaches" aria-label={nextCoachToMeet(prefs) ? "Meet your coaches" : "Talk to your head coach"}>
              {/* 5+ days away and the lead coach misses you. */}
              <Coach id={lead} mood={daysOff != null && daysOff >= 5 ? "sleepy" : "idle"} size={34} badge decorative />
            </a>
          </div>
          <InfoButton screen="today" />
        </div>
        <h1>{headline}</h1>
      </header>

      <div className="body" data-day={day}>
        {sessions.length === 0 && <SetupCard prefs={prefs} glow />}
        <section className="hero-card" aria-label={draft ? `${p.name} in progress` : `Up next: ${p.name}`}>
          <div className="hero-top">
            <span className="pill day-lbl">{draft ? `In progress · ${plural(setsLogged, "set")} logged` : day === CUSTOM ? "Today · Custom workout" : `${picked ? "Today" : "Up next"} · Day ${activeDays(program).indexOf(day) + 1}`}</span>
            <button type="button" className="pill hero-switch" data-help="change" onClick={() => setChoosing(true)} aria-haspopup="dialog">
              <ArrowLeftRight size={14} strokeWidth={2.6} aria-hidden="true" />Change
            </button>
          </div>
          <div className="hero-text">
            <span className={"hero-day" + (p.name.length > 6 ? " long" : "")}>{p.name}</span>
            <span className="hero-meta">{p.detail}{lastOfDay ? ` · last done ${shortDate(lastOfDay.date)}` : ""}</span>
          </div>
          {p.exercises.length > 0 && (
            <>
              <div className="hero-pills">
                <span className="pill">{plural(p.exercises.length, "lift")}</span>
                <span className="pill">{plannedSets} sets</span>
                {usualMins && <span className="pill">~{usualMins} min</span>}
              </div>
              <div className="hero-coaches">
                <span className="coach-stack">{crew.slice(0, 3).map((id) => <span key={id} className="coach-chip"><Coach id={id} size={32} still badge decorative /></span>)}</span>
                <span>{onDeck} {crew.length === 1 ? "is" : "are"} on deck</span>
              </div>
            </>
          )}
          <a className="btn hero-cta" data-help="start" href={href("session", day)}>{draft ? `Resume ${p.name}` : "Start lifting"}</a>
        </section>

        {choosing && (
          <Sheet title="Train something else" sub={draftDay ? `Your ${program[draftDay].name} workout in progress stays saved. Tap it to pick back up.` : "Swap today's workout. Your rotation picks back up after you log it."} onClose={() => setChoosing(false)} labelledBy="swap-title">
            <div className="list">
              {[...activeDays(program), CUSTOM].map((d) => (
                <button key={d} type="button" className="list-row" data-day={d} aria-pressed={d === day} onClick={() => choose(d)}>
                  <span className="dot" aria-hidden="true" />
                  <span className="name">{d === CUSTOM ? "Custom workout" : program[d].name}{drafts[d] ? " · in progress" : d === suggested ? " · up next" : ""}
                    <span className="sub detail">{d === CUSTOM ? "Start empty and add any lifts or cardio." : `${program[d].detail} · ${lastDone(d)}`}</span></span>
                  {d === day && <Check size={18} strokeWidth={2.6} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </Sheet>
        )}

        {/* After a short or under-recovered night only: one quiet line, never a warning. */}
        {nightNote && <p className="night-note"><Moon size={15} aria-hidden="true" /><span>{nightNote} Match last time today; save the PR for a better night.</span></p>}

        {/* One nudge at a time under the hero: a due weigh-in, then coach setup, then the bulk/cut line. */}
        {weigh.due ? <WeighIn {...weigh} onSave={onWeighin} />
          : sessions.length > 0 && nextCoachToMeet(prefs) ? <SetupCard prefs={prefs} />
          : prefs?.phase ? <PhaseLine phase={prefs.phase} sessions={sessions} weighins={weighins} />
          : null}

        {targets.length > 0 && (
          <section className="section">
            <h2 className="lbl">Today's targets</h2>
            <div className="card-list">
              {targets.map((x) => (
                <a key={x.n} className="card-row" href={href("lift", x.n)}>
                  <span className="name">{x.n}</span>
                  {/* A weight taken from the coach's walkthrough comes first. */}
                  {x.next
                    ? <span className={x.next.w > x.best.w ? "v up" : "v"} aria-label={`Start at ${fmtW(x.next.w)} pounds`}>{x.next.w > x.best.w ? "↑ " : x.next.w < x.best.w ? "↓ " : ""}{fmtW(x.next.w)} lb</span>
                    : x.bump
                    ? <span className="v up" aria-label={`Go up to ${fmtW(x.bump.to)} pounds`}>↑ {fmtW(x.bump.to)} lb</span>
                    : <span className="v">{fmtGoal(x.goal)}</span>}
                </a>
              ))}
            </div>
          </section>
        )}

        <section className="section">
          <div className="section-head"><h2 className="lbl">This week</h2><span className="lbl">{doneThisWeek} done · aim ~{prefs?.profile?.days || activeDays(program).length}</span></div>
          <div className="week" data-help="week">
            {week.map((d) => {
              const dd = byDate[d];
              const label = new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "narrow" });
              return (
                <div key={d} className={"wd" + (d === t ? " now" : "")} data-day={dd || undefined}
                  aria-label={`${new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" })}: ${dd ? program[dd].name : "rest"}`}>
                  <i className={dd ? "on" : ""} />{label}
                </div>
              );
            })}
          </div>
        </section>

        {/* Food tracking on: one glance at the day, the detail is on Nutrition. */}
        {foodToday && (
          <a className="card phase-line food-line" href={href("nutrition")}>
            <b>Food today</b>
            <span>{Math.round(foodToday.sum.kcal).toLocaleString()} of {foodToday.targets.kcal.toLocaleString()} kcal · {Math.round(foodToday.sum.protein)} of {foodToday.targets.protein} g protein</span>
          </a>
        )}
      </div>
    </main>
  );
}

/** Weekly nudge: shows when the last bodyweight (weigh-in or session) is 7+ days old, or there is none. */
const PICK_KEY = "ironlog-today-pick";
/** The top-right coach's hello: by time of day, or "missed you" after 5+ days off (the sleepy face). */
function greeting(name, daysOff) {
  const who = name ? `, ${name}` : "";
  if (daysOff != null && daysOff >= 5) return name ? `Missed you${who}` : "Missed you!";
  const h = new Date().getHours();
  return h < 12 ? `Morning${who}!` : h < 17 ? (name ? `Hey ${name}!` : "Hey there!") : `Evening${who}!`;
}

const SKIP_KEY = "ironlog-weigh-skip"; // the Sunday of the skipped week, or "d:<date>" for a skip during a phase
function loadPick() {
  try { return JSON.parse(localStorage.getItem(PICK_KEY)) || null; } catch { return null; }
}

/** Whether the weigh-in nudge is due, and what it needs. Today uses `due` to pick the one nudge it shows. */
function useWeighIn(sessions, weighins, phase) {
  const series = useMemo(() => bodyweightSeries(sessions, weighins), [sessions, weighins]);
  const last = series[series.length - 1];
  const t = today();
  // Weekly normally; every few days during a bulk or cut (never daily, though daily logging works).
  const every = weighInEvery(phase);
  // ✕ skips until next Sunday, or for a couple of days during a phase.
  const week = weekDates()[0];
  const skipMark = phase ? `d:${t}` : week;
  const [skipped, setSkipped] = useState(() => {
    try {
      const v = localStorage.getItem(SKIP_KEY);
      return v === week || (!!phase && !!v?.startsWith("d:") && daysBetween(v.slice(2), t) < 2);
    } catch { return false; }
  });
  const skip = () => {
    try { localStorage.setItem(SKIP_KEY, skipMark); } catch {}
    setSkipped(true);
  };
  return { due: !skipped && !(last && daysBetween(last.date, t) < every), last, skip };
}

function WeighIn({ last, skip, onSave }) {
  const t = today();
  const [bw, setBw] = useState("");
  const ago = last ? daysBetween(last.date, t) : null;
  const value = parseFloat(bw);
  const valid = value > 0 && value < 1000;
  // Saved or skipped, the card folds away so what's below slides up, then it's gone.
  const card = useRef(null);
  const [closing, setClosing] = useState(false);
  const fold = async (then) => { setClosing(true); await collapse(card.current); then(); };
  const save = (e) => {
    e.preventDefault();
    if (!valid || closing) return;
    const w = Math.round(value * 10) / 10;
    fold(() => { onSave(t, w); setBw(""); });
  };
  return (
    <form ref={card} className="weigh" data-help="weigh" onSubmit={save} aria-label="Weekly weigh-in" inert={closing ? "" : undefined}>
      <span className="weigh-icon" aria-hidden="true"><Scale size={22} /></span>
      <div className="weigh-text">
        <b>Weigh-in due</b>
        <span className="small muted">{last ? `Last: ${num(last.bw)} lb · ${plural(ago, "day")} ago` : "Log your bodyweight to start the chart"}</span>
      </div>
      <label className="weigh-field">
        <span className="sr-only">Bodyweight in pounds</span>
        <input id="weigh-bw" type="number" inputMode="decimal" step="0.1" placeholder={last ? num(last.bw) : "—"} value={bw} onChange={(e) => setBw(e.target.value)} />
        <span className="u">lb</span>
      </label>
      <button type="submit" className="btn weigh-save" disabled={!valid}>Save</button>
      <button type="button" className="weigh-skip" onClick={() => !closing && fold(skip)} aria-label="Skip this week's weigh-in"><X size={14} strokeWidth={3} aria-hidden="true" /></button>
    </form>
  );
}

/** One quiet line about the bulk or cut; the detail lives on Progress. */
function PhaseLine({ phase, sessions, weighins }) {
  const s = phaseStatus(phase, sessions, weighins);
  return (
    <a className="card phase-line" href={href("progress", "trends")}>
      <b>{PHASE_TYPES[phase.type].label} · week {s.week} of {s.weeks}</b>
      <span>{statusLine(phase, s)}</span>
    </a>
  );
}
