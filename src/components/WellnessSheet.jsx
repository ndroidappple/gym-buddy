import React, { useMemo, useState } from "react";
import { Plus, Minus } from "lucide-react";
import { Sheet } from "./ui.jsx";
import AddFood from "./AddFood.jsx";
import { COACHES } from "../data/coaches.js";
import WellBuddy from "./WellBuddy.jsx";
import { addDays, MEALS, nutritionFor } from "../lib/nutrition.js";
import { today, vibrate, shortDate } from "../lib/util.js";
import { DRINK_PRESETS, alcoholOf, drinksFor, drinksLabel, defaultLogDay, dayLine, recentDays, isDrinkLike, drinkKey, drinkName, yourDrinks, drinkMeal, againEntry, drinkUnits, scaledEntry, sheetTitle, trackedPhrase } from "../lib/wellness.js";

/* Substances for a day: whichever of alcohol, cannabis and the lifter's own the lifter tracks (well.track).
   Every tap saves at once (there's no Save to forget); Done just closes. With food tracking on, a drink is
   a food log entry with its calories, so it shows on Nutrition and counts toward the day; with it off,
   the sheet keeps a plain count. The lifter's own substances are one tap to log, then − / + for more.
   `well` is App's wellness bundle: { days, foodOn, log, track, food, head, notify, targets, setCannabis,
   setDrinks, setOther, addDrink, addAgain, removeDrink }. */

/** "alcohol or cannabis", "nicotine", "substances": what Today's line and the calendar offer to log. */
export const logWhat = (track) => {
  const p = trackedPhrase(track, " or ");
  return p ? (/^[A-Z][a-z]/.test(p) ? p.charAt(0).toLowerCase() + p.slice(1) : p) : "substances";
};

/**
 * The line on Today. It asks about the day you'd most likely be logging (before noon, last night;
 * after, today) and, once that day has something, says what. `inCard`: drawn as the food card's
 * second row; otherwise (food tracking off) it stands on its own.
 */
export function WellnessLine({ well, inCard = false }) {
  const [open, setOpen] = useState(false);
  // Last night before noon, unless that's empty and today already has something (a mimosa at brunch).
  const guess = defaultLogDay(), t = today();
  const day = !well.days[guess] && well.days[t] ? t : guess;
  const when = day === t ? "today" : "last night";
  const x = well.days[day];
  return (
    <>
      <div className={"well-line" + (inCard ? " in-card" : " card")} data-help="wellness">
        {x
          ? <span className="well-status">{dayLine(x)} {when}</span>
          : <span>{trackedPhrase(well.track, " or ") || "Anything to log"} {when}?</span>}
        <button type="button" className="btn-quiet well-open" onClick={() => setOpen(true)} aria-haspopup="dialog">{x ? "Edit" : "Log it"}</button>
      </div>
      {open && <WellnessSheet well={well} start={day} guessed={day !== t} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A chip's name for a day: Today, Yesterday, then "Wed 25", or "Nov 12" past a week. */
function dayName(d, t) {
  if (d === t) return "Today";
  if (d === addDays(t, -1)) return "Yesterday";
  const dt = new Date(d + "T12:00:00");
  return d >= addDays(t, -6) ? `${dt.toLocaleDateString(undefined, { weekday: "short" })} ${dt.getDate()}` : shortDate(d);
}

/**
 * `start`: the day it opens on (the calendar's picked day, or Today's guess). `guessed`: Today picked
 * last night for you, so the sheet says so.
 */
export default function WellnessSheet({ well, start = null, guessed = false, onClose }) {
  const t = today();
  const [date, setDate] = useState(start || defaultLogDay());
  const [adding, setAdding] = useState(false); // Add food, over this sheet
  // The last week, today first; a day further back (opened from the calendar) is added at the end.
  const days = useMemo(() => { const r = recentDays(7, t); return start && !r.includes(start) ? [...r, start] : r; }, [t, start]);
  const x = well.days[date];
  const count = well.log[date]?.drinks || 0; // food tracking off
  const cannabis = !!well.log[date]?.cannabis;
  // The last change, for the mascots to react to: { kind, type: "add" | "remove" | "on" | "off", n }.
  const [beat, setBeat] = useState({ kind: null, type: null, n: 0 });
  const react = (kind, type) => setBeat((b) => ({ kind, type, n: b.n + 1 }));
  const dayWord = date === t ? "today" : date === addDays(t, -1) ? "yesterday" : dayName(date, t);

  return (
    <>
      <Sheet title={sheetTitle(well.track)} sub={guessed && date === start ? "It's morning, so this is for last night." : null}
        onClose={onClose} labelledBy="wellness-title" focusField={false}>
        <div className="well-days" role="group" aria-label="Day">
          {days.map((d) => (
            <button key={d} type="button" className="chip" aria-pressed={d === date} onClick={() => setDate(d)}>
              {dayName(d, t)}{well.days[d] && <><i className="well-dot" aria-hidden="true" /><span className="sr-only">: {dayLine(well.days[d])}</span></>}
            </button>
          ))}
        </div>

        {/* Cannabis first: one switch, so it stays in reach however long a busy day's drink list gets. */}
        {well.track.cannabis && <section className="section" aria-labelledby="well-cannabis">
          <div className="well-head">
            <WellBuddy kind="cannabis" react={beat.kind === "cannabis" ? beat.type : null} nonce={beat.kind === "cannabis" ? beat.n : 0} />
            <div className="well-bubble">
              <h3 id="well-cannabis">Cannabis</h3>
              <span>{cannabis ? "Logged" : "Not logged"} for {dayWord}</span>
            </div>
          </div>
          <div className="list">
            <button className="list-row" role="switch" aria-checked={cannabis} onClick={() => { well.setCannabis(date, !cannabis); react("cannabis", cannabis ? "off" : "on"); }}>
              <span className="name">Used cannabis<span className="sub detail">{dayName(date, t)}, any amount</span></span>
              <span className="switch" aria-hidden="true" />
            </button>
          </div>
        </section>}

        {/* The lifter's own: one tap logs it, then − / + for more (most days "yes" is all that matters). */}
        {well.track.custom.length > 0 && (
          <section className="section" aria-labelledby="well-own">
            {(well.track.alcohol || well.track.cannabis) && <h3 id="well-own" className="lbl">Your own</h3>}
            {!(well.track.alcohol || well.track.cannabis) && <h3 id="well-own" className="sr-only">Your substances</h3>}
            <div className="list">
              {well.track.custom.map((c) => {
                const n = well.log[date]?.other?.[c.id] || 0;
                return (
                  <div key={c.id} className={"list-row well-step" + (n ? " has" : "")}>
                    <span className="name">{c.name}<span className="sub detail">{n ? `Logged for ${dayWord}` : `Not logged for ${dayWord}`}</span></span>
                    {n ? (
                      <span className="well-stepper" role="group" aria-label={c.name}>
                        <button type="button" className="icon-btn" onClick={() => well.setOther(date, c.id, n - 1)} aria-label={`One fewer ${c.name}`}><Minus size={18} /></button>
                        <b aria-live="polite">{n}</b>
                        <button type="button" className="icon-btn" onClick={() => { well.setOther(date, c.id, n + 1); vibrate(10); }} aria-label={`One more ${c.name}`}><Plus size={18} /></button>
                      </span>
                    ) : (
                      <button type="button" className="pill well-log" onClick={() => { well.setOther(date, c.id, 1); vibrate(10); }} aria-label={`Log ${c.name} for ${dayWord}`}>Log</button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {well.track.alcohol && <section className="section" aria-labelledby="well-drinks">
          <div className="well-head">
            <WellBuddy kind="alcohol" react={beat.kind === "alcohol" ? beat.type : null} nonce={beat.kind === "alcohol" ? beat.n : 0} />
            <div className="well-bubble">
              <h3 id="well-drinks">Alcohol</h3>
              <span>{x?.drinks ? `${drinksLabel(x.drinks)}${well.foodOn ? ` · ${x.alcoholKcal.toLocaleString()} kcal from alcohol` : ""}` : `None logged for ${dayWord}`}</span>
            </div>
          </div>
          {well.foodOn
            ? <DrinkSteps well={well} date={date} onOther={() => setAdding(true)} onStep={(type) => react("alcohol", type)} />
            : (
              <div className="well-count">
                <button type="button" className="icon-btn" onClick={() => { well.setDrinks(date, count - 1); react("alcohol", "remove"); }} disabled={!count} aria-label="One fewer drink"><Minus size={20} /></button>
                <b aria-live="polite">{drinksLabel(count)}</b>
                <button type="button" className="icon-btn" onClick={() => { well.setDrinks(date, count + 1); react("alcohol", "add"); }} aria-label="One more drink"><Plus size={20} /></button>
              </div>
            )}
        </section>}

        <button type="button" className="btn btn-ink" onClick={onClose}>Done</button>
      </Sheet>
      {/* Something that isn't a standard drink: Add food, where Tank works out its alcohol. Closing it comes back here. */}
      {adding && <AddFood food={well.food} head={well.head} meal={drinkMeal(date)} date={date} targets={well.targets} notify={well.notify} pickMeal onClose={() => setAdding(false)} />}
    </>
  );
}

/*
 * One stepper per drink: − count +, where the count is that drink's standard drinks on the day. In a fixed
 * order so nothing moves under the next tap: your own drinks first (your three most logged, with the
 * numbers you logged them with), then the standard ones, then anything else that day had. A meal with
 * a drink in it ("Steak & two beers") is listed as it is, without a stepper: edit it on Nutrition.
 */
function DrinkSteps({ well, date, onOther, onStep }) {
  const entries = well.food.entries;
  // Taken once, when the sheet opens: the rows don't reshuffle under the next tap, and the whole log
  // isn't re-read on every one.
  const [mine] = useState(() => yourDrinks(entries, 3));
  const onDay = entries.filter((e) => e.date === date && alcoholOf(e) > 0)
    .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  const byKey = new Map();
  onDay.filter(isDrinkLike).forEach((e) => { const k = drinkKey(e.name); byKey.set(k, [...(byKey.get(k) || []), e]); });
  const meals = onDay.filter((e) => !isDrinkLike(e));

  const rows = [];
  const seen = new Set();
  const push = (r) => { if (!seen.has(r.key)) { seen.add(r.key); rows.push(r); } };
  mine.forEach((d) => push({ key: d.key, name: d.name, template: d.template }));
  DRINK_PRESETS.forEach((p) => push({ key: drinkKey(p.name), name: p.name, preset: p }));
  [...byKey.entries()].forEach(([k, es]) => push({ key: k, name: drinkName(es[es.length - 1].name), template: es[es.length - 1] }));

  // What one more adds: a single drink, even when the one copied was logged as several ("2 vodka sodas").
  const one = (r) => againEntry(r.template, date, nutritionFor);
  const sub = (r) => {
    if (r.preset) return `${r.preset.sub} · ${r.preset.per.kcal} kcal`;
    const e = one(r), n = drinksFor(alcoholOf(e));
    return `${Math.round(e.kcal)} kcal${n !== 1 ? ` · ${drinksLabel(n)}` : ""}`;
  };
  const add = (r) => { r.preset ? well.addDrink(r.preset, date) : well.addAgain(r.template, date); vibrate(10); onStep?.("add"); };
  /* The count is drinks, however they were logged: "2 vodka sodas" as one entry is 2. − takes one drink
     off the latest entry (scaling its calories with it), or removes it when it was one. */
  const countOf = (k) => drinksFor((byKey.get(k) || []).reduce((a, e) => a + alcoholOf(e), 0));
  const less = (r) => {
    const es = byKey.get(r.key);
    if (!es?.length) return;
    const e = es[es.length - 1], units = drinkUnits(e);
    if (units > 1) well.updateDrink(e.id, scaledEntry(e, (units - 1) / units, nutritionFor));
    else well.removeDrink(e.id);
    onStep?.("remove");
  };

  return (
    <>
      <div className="list well-steps">
        {rows.map((r) => {
          const n = countOf(r.key);
          return (
            <div key={r.key} className={"list-row well-step" + (n ? " has" : "")}>
              <span className="name">{r.name}<span className="sub detail">{sub(r)}</span></span>
              <span className="well-stepper" role="group" aria-label={r.name}>
                <button type="button" className="icon-btn" onClick={() => less(r)} disabled={!n} aria-label={`One fewer ${r.name}`}><Minus size={18} /></button>
                <b aria-live="polite">{n}</b>
                <button type="button" className="icon-btn" onClick={() => add(r)} aria-label={`One more ${r.name}`}><Plus size={18} /></button>
              </span>
            </div>
          );
        })}
        {meals.map((e) => (
          <div key={e.id} className="list-row well-step">
            <span className="name">{e.name}<span className="sub detail">{drinksLabel(drinksFor(alcoholOf(e)))} · in {MEALS.find((m) => m.id === e.meal)?.label || "a meal"}. Edit on Nutrition.</span></span>
          </div>
        ))}
      </div>
      <button type="button" className="btn-quiet well-other" onClick={onOther}><Plus size={16} strokeWidth={2.8} aria-hidden="true" /> Something else</button>
      <p className="small muted">Beer, wine, a shot and a cocktail are one standard drink each. For anything else, describe it and {COACHES[well.head]?.name || "your coach"} works out the alcohol.</p>
    </>
  );
}
