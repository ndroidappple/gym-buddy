import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Copy, MessageCircle } from "lucide-react";
import Coach from "../components/Coach.jsx";
import CoachChat from "../components/CoachChat.jsx";
import { COACHES } from "../data/coaches.js";
import { InfoButton, Sheet, EmptyState } from "../components/ui.jsx";
import AddFood, { Portion, QuickAdd, amountLabel } from "../components/AddFood.jsx";
import { MEALS, totals, byDate, weekSummary, addDays } from "../lib/nutrition.js";
import { savedFoodFor } from "../lib/food.js";
import { href } from "../lib/router.js";
import { today, longDate, plural } from "../lib/util.js";
import Roll from "../components/Roll.jsx";

/* The Nutrition tab: one day at a time (today by default). Calories left and the three macros
   against target, then the day's meals with what's in them, then the week so far. */

const fmt = (n) => Math.round(n).toLocaleString();

export default function Nutrition({ food, prefs, notify, sessions, weighins, program, name, head, coachChat, nutrition, onProgramChange }) {
  const [asking, setAsking] = useState(false);
  const n = prefs.nutrition || {};
  const t = n.targets;
  // null follows today: the home screen app can sleep for days, and a day picked when it opened
  // would go stale, logging food to yesterday while the coach reads today.
  const [picked, setPicked] = useState(null);
  const date = picked || today();
  const setDate = (d) => setPicked(d === today() ? null : d);
  const [, wake] = useState(0);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") wake((x) => x + 1); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const [adding, setAdding] = useState(null); // meal id
  const [editing, setEditing] = useState(null); // entry id
  const days = useMemo(() => byDate(food.entries), [food.entries]);
  const dayEntries = days[date] || [];
  const sum = totals(dayEntries);
  const week = useMemo(() => weekSummary(food.entries, date), [food.entries, date]);
  const isToday = date === today();
  const yesterday = days[addDays(date, -1)] || [];

  if (!t) {
    return (
      <main className="screen has-tabs">
        <header className="top"><h1 className="page-title">Nutrition</h1><span className="spacer" /></header>
        <div className="body">
          <EmptyState coach={head} title="Set your targets first" action={`Set up with ${COACHES[head].name}`} href={href("nutrition", "setup")}>
            {COACHES[head].name} works out your daily calories and protein, carbs and fat from your body, training and goal. About a minute.
          </EmptyState>
        </div>
      </main>
    );
  }

  const copyMeal = (meal) => {
    const src = yesterday.filter((e) => e.meal === meal);
    const ids = src.map(({ id, created_at, updated_at, ...rest }) => food.addEntry({ ...rest, date })); // eslint-disable-line no-unused-vars
    notify(`Copied ${plural(src.length, "food")} from yesterday`, () => ids.forEach((id) => food.removeEntry(id)));
  };
  const remove = (e) => {
    food.removeEntry(e.id);
    setEditing(null);
    const { id, created_at, updated_at, ...rest } = e; // eslint-disable-line no-unused-vars
    notify(`${e.name} removed`, () => food.addEntry({ ...rest, id }));
  };
  const entry = editing && food.entries.find((e) => e.id === editing);

  return (
    <main className="screen has-tabs">
      <header className="top">
        <h1 className="page-title">Nutrition</h1><span className="spacer" />
        <InfoButton screen="nutrition" />
      </header>
      <div className="body">
        <div className="day-switch" data-help="day">
          <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><ChevronLeft size={20} /></button>
          <b>{isToday ? "Today" : date === addDays(today(), -1) ? "Yesterday" : longDate(date)}</b>
          <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} disabled={isToday} aria-label="Next day"><ChevronRight size={20} /></button>
        </div>

        <Summary sum={sum} t={t} />

        {/* The head coach answers food questions here, in the same conversation as the Coaches screen. */}
        <div className="ex-coach nut-ask" style={{ "--c": COACHES[head].color }} data-help="ask">
          <Coach id={head} size={48} mood="idle" />
          <button type="button" className="coach-bubble bubble-btn" onClick={() => setAsking(true)}>
            {isToday && sum.kcal < t.kcal && t.protein - sum.protein > 20
              ? `${Math.round(t.protein - sum.protein)} g protein to go today. Ask me what to eat.`
              : "Questions about food? Ask me."}
          </button>
          <button className="ask-btn compact" onClick={() => setAsking(true)} aria-label={`Ask ${COACHES[head].name}, your head coach`}><MessageCircle size={18} strokeWidth={2.6} aria-hidden="true" /><span>Ask</span></button>
        </div>

        {MEALS.map((m) => {
          const list = dayEntries.filter((e) => e.meal === m.id).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
          const kcal = totals(list).kcal;
          const canCopy = !list.length && yesterday.some((e) => e.meal === m.id);
          return (
            <section key={m.id} className="section meal" data-help={m.id === "breakfast" ? "meal" : undefined}>
              <div className="section-head">
                <h2 className="lbl">{m.label}{list.length > 0 && <span className="meal-kcal"> · {fmt(kcal)} kcal</span>}</h2>
                <button type="button" className="chip meal-add" onClick={() => setAdding(m.id)} aria-label={`Add food to ${m.label}`}><Plus size={15} strokeWidth={2.8} aria-hidden="true" /> Add</button>
              </div>
              {list.length > 0 && (
                <div className="list">
                  {list.map((e) => (
                    <button key={e.id} type="button" className="list-row food-row" onClick={() => setEditing(e.id)}>
                      <span className="name">{e.name}<span className="sub detail">{[e.brand, e.source === "quick" ? null : amountLabel(e), `P ${Math.round(e.protein)} · C ${Math.round(e.carbs)} · F ${Math.round(e.fat)}`].filter(Boolean).join(" · ")}</span></span>
                      <span className="food-kcal">{fmt(e.kcal)}</span>
                    </button>
                  ))}
                </div>
              )}
              {canCopy && <button type="button" className="btn-quiet meal-copy" onClick={() => copyMeal(m.id)}><Copy size={15} aria-hidden="true" /> Copy yesterday's {m.label.toLowerCase()}</button>}
            </section>
          );
        })}

        <Week week={week} t={t} />
        <p className="small muted detail">Targets: {fmt(t.kcal)} kcal · {t.protein} g protein · {t.carbs} g carbs · {t.fat} g fat. <a href={href("nutrition", "setup")}>Change</a></p>
      </div>

      {asking && (
        <CoachChat coach={head} head={head} name={name} topic="nutrition" day={date} {...coachChat} sessions={sessions} program={program} weighins={weighins} profile={prefs.profile} phase={prefs.phase}
          nutrition={nutrition} onProgramChange={onProgramChange} onClose={() => setAsking(false)} />
      )}
      {adding && <AddFood food={food} head={head} meal={adding} date={date} targets={t} notify={notify} onClose={() => setAdding(null)} />}
      {entry && (
        <Sheet title={entry.source === "quick" ? "Edit calories" : "Edit food"} onClose={() => setEditing(null)} labelledBy="edit-food-title" focusField={false}>
          {entry.basis
            ? <Portion item={entry} editName amount={entry.amount} unit={entry.unit} meal={entry.meal} onMeal={(meal) => food.updateEntry(entry.id, { meal })} action="Save"
                onSave={({ amount, unit, n: x, name }) => {
                  food.updateEntry(entry.id, { name, amount, unit, grams: x.grams, kcal: x.kcal, protein: x.protein, carbs: x.carbs, fat: x.fat });
                  // Logged from a saved food (e.g. one Tank made): keep the saved one's name in step.
                  const saved = savedFoodFor(food.foods, entry);
                  if (saved && name !== entry.name) food.updateFood(saved.id, { name });
                  setEditing(null);
                }}
                onDelete={() => remove(entry)} />
            : <QuickAdd entry={entry} meal={entry.meal} onMeal={(meal) => food.updateEntry(entry.id, { meal })} action="Save"
                onSave={(row) => { food.updateEntry(entry.id, row); setEditing(null); }} onDelete={() => remove(entry)} />}
        </Sheet>
      )}
    </main>
  );
}

/** Calories left (or over) with a ring, and a bar per macro against its target. */
function Summary({ sum, t }) {
  const left = t.kcal - sum.kcal;
  const pct = Math.min(1, sum.kcal / t.kcal);
  const R = 42, C = 2 * Math.PI * R;
  const macro = (key, label) => {
    const v = sum[key], target = t[key];
    return (
      <div className="macro" data-macro={key}>
        <div className="macro-top"><span>{label}</span><b><Roll value={Math.round(v)} /><small> / {target} g</small></b></div>
        <div className="macro-bar" role="progressbar" aria-label={`${label}: ${Math.round(v)} of ${target} grams`} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.round(v)}>
          <i style={{ width: `${Math.min(100, (v / target) * 100)}%` }} />
        </div>
      </div>
    );
  };
  return (
    <section className="nut-card" data-help="summary" aria-label={`${fmt(sum.kcal)} of ${fmt(t.kcal)} calories eaten`}>
      <div className="nut-top">
        <svg viewBox="0 0 100 100" className="nut-ring" aria-hidden="true">
          <circle cx="50" cy="50" r={R} className="ring-bg" />
          <circle cx="50" cy="50" r={R} className={"ring-fg" + (left < 0 ? " over" : "")} strokeDasharray={`${pct * C} ${C}`} transform="rotate(-90 50 50)" />
        </svg>
        <div className="nut-left">
          <span className="big"><Roll value={fmt(Math.abs(left))} /></span>
          <span className="lbl">{left >= 0 ? "kcal left" : "kcal over"}</span>
          <span className="small">{fmt(sum.kcal)} eaten of {fmt(t.kcal)}</span>
        </div>
      </div>
      <div className="macros">{macro("protein", "Protein")}{macro("carbs", "Carbs")}{macro("fat", "Fat")}</div>
    </section>
  );
}

/** Sunday to Saturday: a bar per day against the calorie target, and the averages over logged days. */
function Week({ week, t }) {
  const max = Math.max(t.kcal * 1.25, ...week.rows.map((r) => r.kcal));
  return (
    <section className="section" data-help="week">
      <div className="section-head"><h2 className="lbl">This week</h2>
        <span className="lbl">{week.loggedDays ? `avg ${fmt(week.avgKcal)} kcal · ${week.avgProtein} g protein` : "nothing logged yet"}</span></div>
      <div className="card nut-week" role="img" aria-label={week.rows.map((r) => `${new Date(r.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" })}: ${r.logged ? `${fmt(r.kcal)} kcal` : "nothing logged"}`).join(". ")}>
        <div className="nut-bars" aria-hidden="true">
          <span className="nut-target" style={{ bottom: `${(t.kcal / max) * 100}%` }} />
          {week.rows.map((r) => (
            <div key={r.date} className="nut-col"><i className={r.kcal > t.kcal * 1.05 ? "over" : ""} style={{ height: `${(r.kcal / max) * 100}%` }} /></div>
          ))}
        </div>
        <div className="nut-days" aria-hidden="true">
          {week.rows.map((r) => <span key={r.date} className={r.date === today() ? "now" : ""}>{new Date(r.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "narrow" })}</span>)}
        </div>
      </div>
    </section>
  );
}

