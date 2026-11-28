import React, { useMemo, useState } from "react";
import { EmptyState } from "../components/ui.jsx";
import { Pencil, ChevronLeft, ChevronRight, ChevronDown, Wine, Cannabis, CircleDot } from "lucide-react";
import { sumDays, dayLine, drinksLabel, alcoholOf, drinksFor, drinkKey, drinkName, drinkUnits, trackedPhrase } from "../lib/wellness.js";
import WellnessSheet, { logWhat } from "../components/WellnessSheet.jsx";
import { WINDOW_DAYS } from "../lib/food.js";
import { allDays, CUSTOM } from "../data/program.js";
import { href } from "../lib/router.js";
import { outsideStats, effortWord } from "../lib/outside.js";
import { fmtSet, bestSet, byDateDesc, longDate, shortDate, weekDates, compact, sessionVolume, sessionSetCount, plural, priorSessions, allTimeBest, bestE1rm, e1rm, num, today, iso, daysBetween } from "../lib/util.js";

/** Progress → Workouts: every logged workout as a list or a month calendar, filterable by day.
    The list/calendar switch lives in the Progress header (`calendar`). */
export default function Workouts({ sessions, program, calendar, heart = false, well = null, calendarToggle = null }) {
  const [filter, setFilter] = useState(null);
  const sorted = useMemo(() => [...sessions].sort(byDateDesc), [sessions]);
  const shown = filter ? sorted.filter((s) => s.day === filter) : sorted;

  // Per session, the lifts that set a record: which set did it, the new best est. max and the old one.
  const prs = useMemo(() => {
    const m = {};
    sessions.forEach((s) => {
      const prior = priorSessions(sessions, s);
      const hits = {};
      Object.entries(s.sets).forEach(([n, sets]) => {
        const was = allTimeBest(prior, n);
        const now = bestE1rm(sets);
        if (!was || now <= was + 0.05) return;
        const idx = sets.findIndex((x) => x.w != null && x.r != null && Math.abs(e1rm(x.w, x.r) - now) < 0.01);
        hits[n] = { idx, now, was };
      });
      m[s.id] = hits;
    });
    return m;
  }, [sessions]);

  return (
    <>
      {sessions.length === 0 ? (
        <EmptyState title="No workouts yet" action="Start your first workout" href="#/today">
          Every workout you log shows up here: sets, total weight lifted and any PRs. Tap the pencil on one to fix a mistake.
        </EmptyState>
      ) : (<>
      {/* The day filter scrolls; the list/calendar switch stays at its end. */}
      <div className="filters-row">
      <div className="filters" role="group" aria-label="Filter by day">
        <button className="chip" aria-pressed={!filter} onClick={() => setFilter(null)}>All</button>
        {[...allDays(program), CUSTOM].filter((d) => !program[d].off || sessions.some((x) => x.day === d)).filter((d) => d !== CUSTOM || sessions.some((x) => x.day === d)).map((d) => (
          <button key={d} className="chip" data-day={d} aria-pressed={filter === d} onClick={() => setFilter(filter === d ? null : d)}>
            <span className="dot" aria-hidden="true" />{program[d].name}
          </button>
        ))}
      </div>
      {calendarToggle}
      </div>

      {calendar
        ? <MonthCalendar sessions={shown} program={program} prs={prs} heart={heart} well={well} />
        : (
          <>
            {shown.length === 0 && <p className="muted">No {filter ? program[filter].name : ""} sessions logged yet.</p>}
            {byWeek(shown).map((w, wi) => (
              <section key={w.start} className="hist-week" aria-label={w.label}>
                <h2 className="lbl hist-week-head"><span>{w.label}</span><span className="hist-week-n">{plural(w.sessions.length, "workout")}</span></h2>
                {w.sessions.map((s, i) => <HistCard key={s.id} s={s} program={program} prs={prs} heart={heart} defaultOpen={wi === 0 && i === 0} />)}
              </section>
            ))}
          </>
        )}
      </>)}
    </>
  );
}

/* A month grid (Sunday first, like Today's week) with a dot per workout in that day's colour.
   Tapping a day shows its workouts below, as the same cards the list uses. With wellness on, a row
   under the dots marks alcohol (with the drink count) and cannabis; chips above the grid hide any layer. */
const LAYERS_KEY = "ironlog-cal-layers";
const readLayers = () => { try { return { workouts: true, drinks: true, cannabis: true, other: true, ...JSON.parse(localStorage.getItem(LAYERS_KEY)) }; } catch { return { workouts: true, drinks: true, cannabis: true, other: true }; } };
function MonthCalendar({ sessions, program, prs, heart, well }) {
  const [layers, setLayers] = useState(readLayers);
  const [logging, setLogging] = useState(false); // the log sheet, for the picked day
  const flip = (k) => { const next = { ...layers, [k]: !layers[k] }; setLayers(next); try { localStorage.setItem(LAYERS_KEY, JSON.stringify(next)); } catch {} };
  const wd = well?.days || {};
  const tr = well?.track;
  const show = { workouts: !well || layers.workouts, drinks: !!tr?.alcohol && layers.drinks, cannabis: !!tr?.cannabis && layers.cannabis, other: !!tr?.custom.length && layers.other };
  const byDate = useMemo(() => {
    const m = {};
    sessions.forEach((s) => { (m[s.date] ||= []).push(s); });
    return m;
  }, [sessions]);
  const latest = sessions[0]?.date; // sessions arrive newest first
  const [picked, setPicked] = useState(latest || today());
  const [month, setMonth] = useState(() => (latest || today()).slice(0, 7)); // "YYYY-MM"

  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1, 12);
  const lead = first.getDay(); // blanks before the 1st, Sunday-first
  const daysIn = new Date(y, m, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => iso(new Date(y, m - 1, i + 1, 12)))];
  const shift = (n) => { const d = new Date(y, m - 1 + n, 1, 12); setMonth(iso(d).slice(0, 7)); };
  const t = today();
  const count = cells.filter((d) => d && byDate[d]).length;
  const monthWell = well ? sumDays(Object.fromEntries(cells.filter((d) => d && wd[d]).map((d) => [d, wd[d]]))) : null;
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2023, 11, 31 + i).toLocaleDateString(undefined, { weekday: "narrow" }));

  return (
    <>
      <section className="card cal" aria-label="Workout calendar">
        <div className="cal-head">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={20} /></button>
          <div className="cal-title">
            <b>{first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b>
            <span>{plural(count, "workout day")}</span>
            {monthWell && <span className="cal-well">{[
              tr.alcohol && <React.Fragment key="a">{plural(monthWell.drinkDays, "drinking day")}{monthWell.drinks ? <> <span className="nowrap">({drinksLabel(monthWell.drinks)})</span></> : ""}</React.Fragment>,
              tr.cannabis && <span key="c" className="nowrap">{plural(monthWell.cannabisDays, "cannabis day")}</span>,
              ...tr.custom.map((c) => <span key={c.id} className="nowrap">{c.name.toLowerCase()} {plural(monthWell.other[c.name]?.days || 0, "day")}</span>),
            ].filter(Boolean).map((x, i) => <React.Fragment key={i}>{i > 0 && " · "}{x}</React.Fragment>)}</span>}
          </div>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month" disabled={month >= t.slice(0, 7)}><ChevronRight size={20} /></button>
        </div>
        {well && (
          <div className="cal-layers" role="group" aria-label="Show on the calendar">
            <button type="button" className="chip" aria-pressed={layers.workouts} onClick={() => flip("workouts")}><span className="dot" aria-hidden="true" />Workouts</button>
            {tr.alcohol && <button type="button" className="chip cal-chip-drinks" aria-pressed={layers.drinks} onClick={() => flip("drinks")}><Wine size={14} strokeWidth={2.6} aria-hidden="true" />Alcohol</button>}
            {tr.cannabis && <button type="button" className="chip cal-chip-weed" aria-pressed={layers.cannabis} onClick={() => flip("cannabis")}><Cannabis size={14} strokeWidth={2.6} aria-hidden="true" />Cannabis</button>}
            {tr.custom.length > 0 && <button type="button" className="chip cal-chip-own" aria-pressed={layers.other} onClick={() => flip("other")}><CircleDot size={14} strokeWidth={2.6} aria-hidden="true" />{tr.custom.length === 1 ? tr.custom[0].name : "Your own"}</button>}
          </div>
        )}
        <div className={"cal-grid" + (well ? " with-well" : "")} role="grid">
          {weekdays.map((w, i) => <span key={i} className="cal-wd" aria-hidden="true">{w}</span>)}
          {cells.map((d, i) => {
            if (!d) return <span key={`b${i}`} />;
            const day = byDate[d] || [];
            const w = wd[d];
            const label = `${longDate(d)}${day.length ? `: ${day.map((s) => program[s.day].name).join(", ")}` : ", no workout"}${w ? `, ${dayLine(w)}` : ""}`;
            return (
              <button key={d} type="button" className={"cal-day" + (d === t ? " is-today" : "") + (d === picked ? " is-picked" : "") + (day.length ? " has" : "")}
                aria-label={label} aria-pressed={d === picked} disabled={d > t} onClick={() => setPicked(d)}>
                <span className="cal-num">{Number(d.slice(8))}</span>
                <span className="cal-dots" aria-hidden="true">
                  {show.workouts && day.slice(0, 3).map((s) => <i key={s.id} data-day={s.day} />)}
                </span>
                {well && (
                  <span className="cal-marks" aria-hidden="true">
                    {show.drinks && w?.drinks > 0 && <span className="cal-mark drinks"><Wine size={11} strokeWidth={2.8} />{w.drinks}</span>}
                    {show.cannabis && w?.cannabis && <span className="cal-mark weed"><Cannabis size={11} strokeWidth={2.8} /></span>}
                    {show.other && w?.other.length > 0 && <span className="cal-mark own"><CircleDot size={11} strokeWidth={2.8} />{w.other.length > 1 ? w.other.length : ""}</span>}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {well && (
          <p className="cal-legend" aria-hidden="true">
            <span><i className="dot" />Workout</span>
            {tr.alcohol && <span className="drinks"><Wine size={13} strokeWidth={2.6} />Alcohol, with drink count</span>}
            {tr.cannabis && <span className="weed"><Cannabis size={13} strokeWidth={2.6} />Cannabis</span>}
            {tr.custom.length > 0 && <span className="own"><CircleDot size={13} strokeWidth={2.6} />{tr.custom.length === 1 ? tr.custom[0].name : "Your own (how many that day)"}</span>}
          </p>
        )}
      </section>

      {well && wd[picked] && <WellDay day={wd[picked]} foodOn={well.foodOn} track={tr} />}
      {/* Any day can be logged or fixed from here, however far back: Today's sheet offers only the last week. */}
      {/* With food tracking on, only within the days of food the app has loaded (lib/food.js): further back
          it can't show what's there, and a drink added would drop out at the next sync. */}
      {well && picked <= t && (!well.foodOn || daysBetween(picked, t) < WINDOW_DAYS) && (
        <button type="button" className="btn btn-ghost cal-log" onClick={() => setLogging(true)} aria-haspopup="dialog">
          {tr.alcohol ? <Wine size={16} strokeWidth={2.6} aria-hidden="true" /> : <CircleDot size={16} strokeWidth={2.6} aria-hidden="true" />}{wd[picked] ? "Edit" : "Log"} {logWhat(tr)} for {longDate(picked)}
        </button>
      )}
      {logging && <WellnessSheet well={well} start={picked} onClose={() => setLogging(false)} />}
      {(byDate[picked] || []).length
        ? byDate[picked].map((s) => <HistCard key={s.id} s={s} program={program} prs={prs} heart={heart} defaultOpen />)
        : <p className="muted cal-none">No workout logged on {longDate(picked)}.</p>}
    </>
  );
}

/** What was drunk, the same drink grouped however it was written: "Vodka Soda × 3, Hazy IPA 16 oz (1.5 drinks)". */
function itemsLine(items) {
  const m = new Map();
  for (const e of items) {
    const k = drinkKey(e.name);
    const x = m.get(k) || { name: drinkName(e.name), n: 0, g: 0 };
    x.n += drinkUnits(e); x.g += alcoholOf(e);
    m.set(k, x);
  }
  return [...m.values()].map((x) => {
    const drinks = drinksFor(x.g);
    return `${x.name}${x.n > 1 ? ` × ${x.n}` : ""}${drinks !== x.n ? ` (${drinksLabel(drinks)})` : ""}`;
  }).join(", ");
}

/** The picked day's substances, under the calendar. */
function WellDay({ day, foodOn, track }) {
  return (
    <section className="card well-day" aria-label={trackedPhrase(track, " and ") || "Substances"}>
      {day.drinks > 0 && (
        <div className="well-day-row drinks">
          <span className="well-badge" aria-hidden="true"><Wine size={18} strokeWidth={2.4} /></span>
          <span className="name">{drinksLabel(day.drinks)}{foodOn && <> · {day.alcoholKcal.toLocaleString()} kcal from alcohol</>}
            {day.items.length > 0 && <span className="sub detail">{itemsLine(day.items)}</span>}</span>
        </div>
      )}
      {day.cannabis && (
        <div className="well-day-row weed">
          <span className="well-badge" aria-hidden="true"><Cannabis size={18} strokeWidth={2.4} /></span>
          <span className="name">Cannabis</span>
        </div>
      )}
      {day.other.map((o) => (
        <div key={o.id} className="well-day-row own">
          <span className="well-badge" aria-hidden="true"><CircleDot size={18} strokeWidth={2.4} /></span>
          <span className="name">{o.name}{o.n > 1 ? ` × ${o.n}` : ""}</span>
        </div>
      ))}
    </section>
  );
}

/** One logged workout: sets, volume, PRs (with the record set and what it beat) and an edit link. */
/* Workouts grouped by week (Sunday first, like Today's week), newest first: "This week", "Last week",
   then the dates. */
function byWeek(list) {
  const thisWeek = weekDates()[0];
  const out = [];
  for (const s of list) {
    const start = weekDates(new Date(s.date + "T12:00:00"))[0];
    let w = out[out.length - 1];
    if (!w || w.start !== start) {
      const ago = Math.round(daysBetween(start, thisWeek) / 7);
      const end = weekDates(new Date(s.date + "T12:00:00"))[6];
      w = { start, sessions: [], label: ago === 0 ? "This week" : ago === 1 ? "Last week" : `${shortDate(start)} – ${shortDate(end)}` };
      out.push(w);
    }
    w.sessions.push(s);
  }
  return out;
}

/* One workout: a row (date, day, sets, PRs) that opens in place to every lift's top set. Collapsed by
   default so a long history scrolls as a list, not page after page of sets (audit 2026-11-28, P-03). */
function HistCard({ s, program, prs, heart, defaultOpen = false }) {
  const hits = prs[s.id] || {};
  const n = Object.keys(hits).length;
  const [open, setOpen] = useState(defaultOpen);
  // Each lift shows its top set (the record set on a PR); every set is one tap away.
  const [all, setAll] = useState(false);
  if (s.ext) return <OutsideHistCard s={s} program={program} heart={heart} />;
  const name = program[s.day].name;
  return (
    <article className={"hist" + (open ? " open" : "")} data-help="workout" data-day={s.day}>
      <div className="hist-head">
        <h3 className="hist-h">
          <button type="button" className="hist-toggle" aria-expanded={open} onClick={() => setOpen(!open)}
            aria-label={`${name} workout on ${longDate(s.date)}${n ? `, ${plural(n, "PR")}` : ""}`}>
            <span className="hist-date">{longDate(s.date)}</span>
            <span className="hist-meta hist-sum">
              <span className="dot" aria-hidden="true" />{name} · {plural(sessionSetCount(s), "set")}{sessionVolume(s) > 0 && ` · ${compact(sessionVolume(s))} lb`}{s.bw != null && open && ` · ${s.bw} lb bodyweight`}
            </span>
            {open && heart && s.hr && !s.hr.none && <span className="hist-meta">Heart rate avg {s.hr.avg} · peak {s.hr.max} bpm{s.hr.hard != null && ` · ${num(s.hr.hard)} min vigorous+`}</span>}
          </button>
        </h3>
        {n > 0 && <span className="stamp">PR{n > 1 ? ` ×${n}` : ""}</span>}
        <ChevronDown size={20} strokeWidth={2.6} aria-hidden="true" className="hist-chev" />
      </div>
      {open && <>
      {s.note && <p className="hist-note">{s.note}</p>}
      <div>
        {Object.entries(s.sets).map(([name, sets]) => {
          const pr = hits[name];
          return (
            <a key={name} className={"hist-line" + (pr ? " is-pr" : "")} href={href("lift", name)} style={{ color: "inherit", textDecoration: "none" }}>
              <span className="name">
                {pr && <span className="stamp pr-stamp">PR</span>}{name}
                {pr && <span className="pr-note">New best est. max {num(pr.now)} lb · was {num(pr.was)}</span>}
              </span>
              <span className="sets">
                {all ? sets.map((x, i) => (
                  <React.Fragment key={i}>{i > 0 && "  "}<span className={i === pr?.idx ? "pr-set" : undefined}>{fmtSet(x)}</span>{heart && x.hr && <span className="set-hr" title="Peak heart rate"> ♥{x.hr}</span>}</React.Fragment>
                )) : <TopSet sets={sets} pr={pr} />}
              </span>
            </a>
          );
        })}
      </div>
      <div className="hist-foot">
        <button className="btn-quiet hist-more" onClick={() => setAll(!all)} aria-expanded={all}>{all ? "Show top sets" : "Show all sets"}</button>
        <span className="spacer" />
        <a className="btn-quiet hist-more" data-help="edit" href={href("session", s.day, s.id)} aria-label={`Edit ${name} session on ${longDate(s.date)}`}><Pencil size={15} aria-hidden="true" />Edit</a>
        <a className="btn-quiet hist-more" href={href("summary", s.id, "view")} aria-label={`Open the ${name} recap for ${longDate(s.date)}`}>Recap<ChevronRight size={16} strokeWidth={2.6} aria-hidden="true" /></a>
      </div>
      </>}
    </article>
  );
}

/** A workout done outside GymBuddy and counted from Google Health: what the watch recorded, no sets. */
function OutsideHistCard({ s, program, heart }) {
  const day = program[s.day]?.name || "Workout";
  return (
    <article className="hist" data-day={s.day}>
      <div className="hist-head">
        <a className="hist-open" href={href("summary", s.id, "view")} aria-label={`Open ${s.ext.name} on ${longDate(s.date)}`}>
          <h2 className="hist-date">{longDate(s.date)}<ChevronRight size={18} strokeWidth={2.6} aria-hidden="true" className="hist-chev" /></h2>
          <div className="hist-meta">{s.day === CUSTOM ? s.ext.name : `${day} · ${s.ext.name}`} · from Google Health</div>
          <div className="hist-meta">{outsideStats({ ...s.ext, hrAvg: (heart && s.hr && !s.hr.none && s.hr.avg) || s.ext.hrAvg })}{s.effort ? ` · effort ${s.effort}/10, ${effortWord(s.effort).toLowerCase()}` : ""}</div>
        </a>
      </div>
      {s.note && <p className="hist-note">{s.note}</p>}
    </article>
  );
}

function TopSet({ sets, pr }) {
  const top = (pr && sets[pr.idx]) || bestSet(sets) || sets[0];
  return (
    <>
      <span className={"top-set" + (pr && sets[pr.idx] ? " pr-set" : "")}>{fmtSet(top)}</span>
      {sets.length > 1 && <span className="set-count">{plural(sets.length, "set")}</span>}
    </>
  );
}
