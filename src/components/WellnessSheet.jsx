import React, { useState } from "react";
import { Plus, Minus, X } from "lucide-react";
import { Sheet } from "./ui.jsx";
import { addDays } from "../lib/nutrition.js";
import { today, vibrate } from "../lib/util.js";
import { DRINK_PRESETS, alcoholOf, drinksFor, drinksLabel, defaultLogDay, dayLine } from "../lib/wellness.js";

/* Alcohol and cannabis for a day: yesterday or today. Every tap saves at once (there's no Save to
   forget); Done just closes. With food tracking on, a drink is a food log entry with its calories,
   so it shows on Nutrition and counts toward the day; with it off, the sheet keeps a plain count.
   `well` is App's wellness bundle: { days, foodOn, log, setCannabis, setDrinks, addDrink, removeDrink }. */

/** The quiet line on Today: asks about the exception, then says what's logged once there is something. */
export function WellnessLine({ well }) {
  const [open, setOpen] = useState(false);
  const t = today(), y = addDays(t, -1);
  const shown = well.days[t] ? t : well.days[y] ? y : null;
  return (
    <>
      <div className="well-line" data-help="wellness">
        {shown
          ? <span className="well-status">{dayLine(well.days[shown])} {shown === t ? "today" : "yesterday"}</span>
          : <span>Alcohol or cannabis?</span>}
        <button type="button" className="btn-quiet well-open" onClick={() => setOpen(true)} aria-haspopup="dialog">{shown ? "Edit" : "Log it"}</button>
      </div>
      {open && <WellnessSheet well={well} start={shown} onClose={() => setOpen(false)} />}
    </>
  );
}

export default function WellnessSheet({ well, start = null, onClose }) {
  const t = today(), y = addDays(t, -1);
  const guess = defaultLogDay();
  const [date, setDate] = useState(start || guess);
  const day = well.days[date];
  const drinks = (day?.items || []).slice().sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  const count = well.log[date]?.drinks || 0; // food tracking off
  const cannabis = !!well.log[date]?.cannabis;
  const add = (p) => { well.addDrink(p, date); vibrate(10); };

  return (
    <Sheet title="Alcohol & cannabis" sub={date === guess && !start && date === y ? "It's morning, so this is for yesterday." : null}
      onClose={onClose} labelledBy="wellness-title" focusField={false}>
      <div className="segctl" role="group" aria-label="Day">
        <button aria-pressed={date === y} onClick={() => setDate(y)}>Yesterday</button>
        <button aria-pressed={date === t} onClick={() => setDate(t)}>Today</button>
      </div>

      <section className="section" aria-labelledby="well-drinks">
        <div className="section-head">
          <h3 className="lbl" id="well-drinks">Alcohol</h3>
          <span className="lbl section-aside">{day?.drinks ? `${drinksLabel(day.drinks)}${well.foodOn ? ` · ${day.alcoholKcal.toLocaleString()} kcal from alcohol` : ""}` : "None"}</span>
        </div>
        {well.foodOn ? (
          <>
            {drinks.length > 0 && (
              <div className="list">
                {drinks.map((e) => (
                  <div key={e.id} className="list-row well-drink">
                    <span className="name">{e.name}<span className="sub detail">{drinksLabel(drinksFor(alcoholOf(e)))} · {Math.round(e.kcal)} kcal</span></span>
                    <button type="button" className="icon-btn" onClick={() => well.removeDrink(e.id)} aria-label={`Remove ${e.name}`}><X size={18} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="well-presets">
              {DRINK_PRESETS.map((p) => (
                <button key={p.id} type="button" className="chip well-preset" onClick={() => add(p)} aria-label={`Add a ${p.name.toLowerCase()}`}>
                  <Plus size={15} strokeWidth={2.8} aria-hidden="true" /><span>{p.name}<small>{p.sub} · {p.per.kcal} kcal</small></span>
                </button>
              ))}
            </div>
            <p className="small muted">Each is one standard drink. Something specific, like a 16 oz IPA? Describe it in Nutrition and it counts here too.</p>
          </>
        ) : (
          <div className="well-count">
            <button type="button" className="icon-btn" onClick={() => well.setDrinks(date, count - 1)} disabled={!count} aria-label="One fewer drink"><Minus size={20} /></button>
            <b aria-live="polite">{drinksLabel(count)}</b>
            <button type="button" className="icon-btn" onClick={() => well.setDrinks(date, count + 1)} aria-label="One more drink"><Plus size={20} /></button>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="well-cannabis">
        <h3 className="lbl" id="well-cannabis">Cannabis</h3>
        <div className="list">
          <button className="list-row" role="switch" aria-checked={cannabis} onClick={() => well.setCannabis(date, !cannabis)}>
            <span className="name">Used cannabis<span className="sub detail">{date === t ? "Today" : "Yesterday"}, any amount</span></span>
            <span className="switch" aria-hidden="true" />
          </button>
        </div>
      </section>

      <button type="button" className="btn btn-ink" onClick={onClose}>Done</button>
    </Sheet>
  );
}
