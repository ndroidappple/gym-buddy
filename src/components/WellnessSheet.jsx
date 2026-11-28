import React, { useMemo, useState } from "react";
import { Plus, Minus, Wine, Cannabis, CircleDot, ChevronDown, Check } from "lucide-react";
import { Sheet } from "./ui.jsx";
import AddFood from "./AddFood.jsx";
import { COACHES } from "../data/coaches.js";
import { addDays, MEALS, nutritionFor } from "../lib/nutrition.js";
import { today, vibrate, shortDate, longDate } from "../lib/util.js";
import { DRINK_PRESETS, alcoholOf, drinksFor, drinksLabel, defaultLogDay, dayLine, isDrinkLike, drinkKey, drinkName, yourDrinks, drinkMeal, drinkUnits, scaledEntry, sheetTitle, trackedPhrase } from "../lib/wellness.js";

/* Substances for a day: whichever of alcohol, cannabis and the lifter's own the lifter tracks (well.track).
   Built around what the lifter is doing (audit 2026-11-28):
   1. Answering Today's question: usually "nothing", so the line takes None as an answer, not just Log.
   2. The day: almost always last night, already guessed. The sheet says which in words, with a quiet Change
      that opens a week strip like Today's, rather than a row of date chips to read through.
   3. Adding: you think "two vodka sodas and a joint", not "set Vodka Soda to 2". One-tap buttons for your
      usuals, in a fixed place so nothing moves under the next tap.
   4. Checking: under them, what the day has (only what's there, no rows of zeros), each with − / +.
   Every tap saves at once (there's no Save to forget); Done just closes. With food tracking on, a drink is
   a food log entry with its calories, so it shows on Nutrition and counts toward the day; with it off,
   the sheet keeps a plain count.
   `well` is App's wellness bundle: { days, foodOn, log, track, food, head, notify, targets, setCannabis,
   setDrinks, setOther, addDrink, addAgain, removeDrink }. */

/** "alcohol or cannabis", "nicotine", "substances": what Today's line and the calendar offer to log. */
export const logWhat = (track) => {
  const p = trackedPhrase(track, " or ");
  return p ? (/^[A-Z][a-z]/.test(p) ? p.charAt(0).toLowerCase() + p.slice(1) : p) : "substances";
};

/**
 * The line on Today. It asks about the day you'd most likely be logging (before noon, last night;
 * after, today) and takes either answer: None, or Log. Once the day has something (or a None), it says
 * what. `inCard`: drawn as the food card's second row; otherwise (food tracking off) it stands on its own.
 */
export function WellnessLine({ well, inCard = false }) {
  const [open, setOpen] = useState(false);
  // Last night before noon, unless that's empty and today already has something (a mimosa at brunch).
  const guess = defaultLogDay(), t = today();
  const day = !well.days[guess] && well.days[t] ? t : guess;
  const when = day === t ? "today" : "last night";
  const x = well.days[day];
  const none = !x && !!well.log[day]?.none;
  return (
    <>
      <div className={"well-line" + (inCard ? " in-card" : " card")} data-help="wellness">
        {x ? <span className="well-status">{dayLine(x)} {when}</span>
          : none ? <span className="well-status">Nothing {when}</span>
          : <span>{trackedPhrase(well.track, " or ") || "Anything to log"} {when}?</span>}
        {!x && !none && <button type="button" className="well-none" onClick={() => { well.setNone(day, true); vibrate(10); }}>None</button>}
        <button type="button" className="well-open" onClick={() => setOpen(true)} aria-haspopup="dialog">{x || none ? "Edit" : "Log it"}</button>
      </div>
      {open && <WellnessSheet well={well} start={day} guessed={day !== t} onClose={() => setOpen(false)} />}
    </>
  );
}

/** What the day is called at the top of the sheet: "Last night" (in the morning), "Today", "Yesterday", "Wednesday". */
function dayTitle(d, t, morning) {
  if (d === t) return "Today";
  if (d === addDays(t, -1)) return morning ? "Last night" : "Yesterday";
  if (d >= addDays(t, -6)) return new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" });
  return shortDate(d);
}

/** Seven days to pick from, oldest first like Today's week: the last week, or the week around an older day. */
function stripDays(date, t) {
  const end = date >= addDays(t, -6) ? t : (addDays(date, 3) > t ? t : addDays(date, 3));
  return Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
}

/**
 * `start`: the day it opens on (the calendar's picked day, or Today's guess). `guessed`: Today picked
 * last night for you, so the top says "Last night".
 */
export default function WellnessSheet({ well, start = null, guessed = false, onClose }) {
  const t = today();
  const [date, setDate] = useState(start || defaultLogDay());
  const [picking, setPicking] = useState(false); // the week strip, open
  const [adding, setAdding] = useState(false); // Add food, over this sheet
  const tr = well.track;
  const x = well.days[date];
  const log = well.log[date] || {};
  const count = log.drinks || 0; // food tracking off
  const cannabis = !!log.cannabis;
  const morning = guessed && date === start;
  const title = dayTitle(date, t, morning);
  const strip = useMemo(() => stripDays(date, t), [date, t]);
  const dayWord = title === "Last night" || title === "Today" || title === "Yesterday" ? title.toLowerCase() : `on ${title}`;

  // Drinks (food tracking on): your three most logged first, then the standard ones. Taken once, when the
  // sheet opens, so the buttons don't reshuffle under the next tap.
  const entries = well.food?.entries || [];
  const [mine] = useState(() => (well.foodOn ? yourDrinks(entries, 3) : []));
  const drinkButtons = useMemo(() => {
    const out = [], seen = new Set();
    const push = (r) => { if (!seen.has(r.key)) { seen.add(r.key); out.push(r); } };
    mine.forEach((d) => push({ key: d.key, name: d.name, template: d.template }));
    DRINK_PRESETS.forEach((p) => push({ key: drinkKey(p.name), name: p.name, preset: p }));
    return out;
  }, [mine]);
  const addDrink = (r) => { r.preset ? well.addDrink(r.preset, date) : well.addAgain(r.template, date); vibrate(10); };

  // What the day has, from the food log: drinks grouped however they were written, and meals with alcohol in them.
  const onDay = well.foodOn ? entries.filter((e) => e.date === date && alcoholOf(e) > 0).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")) : [];
  const byKey = new Map();
  onDay.filter(isDrinkLike).forEach((e) => { const k = drinkKey(e.name); byKey.set(k, [...(byKey.get(k) || []), e]); });
  const meals = onDay.filter((e) => !isDrinkLike(e));
  const drinkRows = [...byKey.entries()].map(([k, es]) => {
    const last = es[es.length - 1];
    return { key: k, name: drinkName(last.name), n: drinksFor(es.reduce((a, e) => a + alcoholOf(e), 0)), kcal: Math.round(es.reduce((a, e) => a + (+e.kcal || 0), 0)), template: last };
  });
  /* − takes one drink off the latest entry (scaling its calories with it), or removes it when it was one. */
  const lessDrink = (k) => {
    const es = byKey.get(k);
    if (!es?.length) return;
    const e = es[es.length - 1], units = drinkUnits(e);
    if (units > 1) well.updateDrink(e.id, scaledEntry(e, (units - 1) / units, nutritionFor));
    else well.removeDrink(e.id);
  };
  const own = tr.custom.map((c) => ({ ...c, n: log.other?.[c.id] || 0 }));
  const anything = drinkRows.length || meals.length || count || cannabis || own.some((c) => c.n);

  return (
    <>
      <Sheet title={sheetTitle(tr)} onClose={onClose} labelledBy="wellness-title" focusField={false} className="subs-sheet">
        {/* The day, said in words: the guess is right most of the time, so changing it is one quiet tap away. */}
        <button type="button" className="subs-day" onClick={() => setPicking(!picking)} aria-expanded={picking} aria-controls="subs-strip" aria-label={`Change day. Logging for ${title}, ${longDate(date)}`}>
          <span className="subs-day-text"><b>{title}</b><span>{longDate(date)}</span></span>
          <span className="subs-day-change">Change<ChevronDown size={16} strokeWidth={2.8} aria-hidden="true" /></span>
        </button>
        {picking && (
          <div className="subs-strip" id="subs-strip" role="group" aria-label="Day">
            {strip.map((d) => {
              const dt = new Date(d + "T12:00:00");
              return (
                <button key={d} type="button" aria-pressed={d === date} disabled={d > t}
                  aria-label={`${dt.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}${well.days[d] ? `: ${dayLine(well.days[d])}` : ""}`}
                  onClick={() => { setDate(d); setPicking(false); }}>
                  <span className="subs-wd">{dt.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
                  <b>{dt.getDate()}</b>
                  <i className={well.days[d] ? "on" : ""} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}

        {/* Adding: one tap each. Fixed in place: what's logged collects below, so nothing moves under the thumb. */}
        <div className="subs-add">
          {tr.alcohol && (
            <section className="subs-group" aria-labelledby="subs-alcohol">
              <h3 id="subs-alcohol" className="lbl"><Wine size={14} strokeWidth={2.6} aria-hidden="true" className="drinks" />Alcohol</h3>
              <div className="subs-btns">
                {well.foodOn ? <>
                  {drinkButtons.map((r) => (
                    <button key={r.key} type="button" className="subs-btn" onClick={() => addDrink(r)} aria-label={`Add a ${r.name}`}><Plus size={16} strokeWidth={2.8} aria-hidden="true" />{r.name}</button>
                  ))}
                  <button type="button" className="subs-btn quiet" onClick={() => setAdding(true)}>Something else…</button>
                </> : (
                  <button type="button" className="subs-btn" onClick={() => { well.setDrinks(date, count + 1); vibrate(10); }} aria-label="Add a drink"><Plus size={16} strokeWidth={2.8} aria-hidden="true" />Drink</button>
                )}
              </div>
            </section>
          )}
          {(tr.cannabis || own.length > 0) && (
            <section className="subs-group" aria-labelledby="subs-other">
              <h3 id="subs-other" className={tr.alcohol ? "lbl" : "sr-only"}>{tr.alcohol ? "Other" : "Add"}</h3>
              <div className="subs-btns">
                {tr.cannabis && (
                  <button type="button" className="subs-btn" aria-pressed={cannabis} onClick={() => { well.setCannabis(date, !cannabis); vibrate(10); }}
                    aria-label="Cannabis">
                    {cannabis ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : <Plus size={16} strokeWidth={2.8} aria-hidden="true" />}Cannabis
                  </button>
                )}
                {own.map((c) => (
                  <button key={c.id} type="button" className="subs-btn" onClick={() => { well.setOther(date, c.id, c.n + 1); vibrate(10); }} aria-label={`Add ${c.name}`}>
                    <Plus size={16} strokeWidth={2.8} aria-hidden="true" />{c.name}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* What the day has. */}
        <section className="subs-tally" aria-labelledby="subs-tally-h" aria-live="polite">
          <div className="section-head"><h3 id="subs-tally-h" className="lbl">{title}</h3>
            {x?.drinks > 0 && <span className="lbl section-aside">{drinksLabel(x.drinks)}{well.foodOn ? ` · ${x.alcoholKcal.toLocaleString()} kcal from alcohol` : ""}</span>}</div>
          {anything ? (
            <div className="list">
              {drinkRows.map((r) => (
                <div key={r.key} className="list-row subs-row">
                  <span className="sub-icon drinks" aria-hidden="true"><Wine size={18} strokeWidth={2.4} /></span>
                  <span className="name">{r.name}<span className="sub detail">{r.kcal} kcal</span></span>
                  <Stepper label={r.name} n={r.n} less={() => lessDrink(r.key)} more={() => addDrink({ key: r.key, template: r.template })} />
                </div>
              ))}
              {meals.map((e) => (
                <div key={e.id} className="list-row subs-row">
                  <span className="sub-icon drinks" aria-hidden="true"><Wine size={18} strokeWidth={2.4} /></span>
                  <span className="name">{e.name}<span className="sub detail">{drinksLabel(drinksFor(alcoholOf(e)))} · in {MEALS.find((m) => m.id === e.meal)?.label || "a meal"}. Edit on Nutrition.</span></span>
                </div>
              ))}
              {count > 0 && (
                <div className="list-row subs-row">
                  <span className="sub-icon drinks" aria-hidden="true"><Wine size={18} strokeWidth={2.4} /></span>
                  <span className="name">Drinks</span>
                  <Stepper label="drink" n={count} less={() => well.setDrinks(date, count - 1)} more={() => { well.setDrinks(date, count + 1); vibrate(10); }} />
                </div>
              )}
              {cannabis && (
                <div className="list-row subs-row">
                  <span className="sub-icon weed" aria-hidden="true"><Cannabis size={18} strokeWidth={2.4} /></span>
                  {/* A yes for the day: its button above (✓) is the one control, so no second one here. */}
                  <span className="name">Cannabis<span className="sub detail">Any amount</span></span>
                </div>
              )}
              {own.filter((c) => c.n).map((c) => (
                <div key={c.id} className="list-row subs-row">
                  <span className="sub-icon own" aria-hidden="true"><CircleDot size={18} strokeWidth={2.4} /></span>
                  <span className="name">{c.name}</span>
                  <Stepper label={c.name} n={c.n} less={() => well.setOther(date, c.id, c.n - 1)} more={() => { well.setOther(date, c.id, c.n + 1); vibrate(10); }} />
                </div>
              ))}
            </div>
          ) : (
            <p className="subs-empty">{log.none ? `You said nothing ${dayWord}.` : `Nothing logged ${dayWord}.`} Tap above to add.</p>
          )}
          {well.foodOn && tr.alcohol && <p className="sub-note">Beer, wine, a shot and a cocktail are one standard drink each. For anything else, describe it and {COACHES[well.head]?.name || "your coach"} works out the alcohol.</p>}
        </section>

        <button type="button" className="btn btn-ink" onClick={onClose}>Done</button>
      </Sheet>
      {/* Something that isn't a standard drink: Add food, where Tank works out its alcohol. Closing it comes back here. */}
      {adding && <AddFood food={well.food} head={well.head} meal={drinkMeal(date)} date={date} targets={well.targets} notify={well.notify} pickMeal onClose={() => setAdding(false)} />}
    </>
  );
}

/** − n + for one row of the tally. `label` names it for screen readers: "One more Beer". */
function Stepper({ label, n, less, more }) {
  return (
    <span className="well-stepper" role="group" aria-label={label}>
      <button type="button" className="icon-btn" onClick={less} aria-label={`One fewer ${label}`}><Minus size={18} /></button>
      <b>{n}</b>
      <button type="button" className="icon-btn" onClick={more} aria-label={`One more ${label}`}><Plus size={18} /></button>
    </span>
  );
}
