import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, PenLine, ChevronLeft, Trash2, Check } from "lucide-react";
import Coach from "./Coach.jsx";
import TankMeal from "./TankMeal.jsx";
import { Sheet } from "./ui.jsx";
import { MEALS, unitsFor, nutritionFor, defaultPortion } from "../lib/nutrition.js";
import { recentFoods } from "../lib/food.js";
import { searchFoods, SEARCH_TROUBLE } from "../lib/foodSearch.js";

/* Adding food: describe it to Tank (he itemizes it into one food), recent foods and your own foods
   (one tap, then Add), search, or enter it by hand. Every path shows exactly what will be logged
   before Add. `food` is the useFood() store; `meal` and `date` are where it goes. */

const fmt = (n) => Math.round(n).toLocaleString();
const g = (n) => `${Math.round(n)} g`;
/** "150 g" / "1 serving (170 g)" / "2 × breast (172 g)" for a list row. */
export const amountLabel = (e) => (e.unit === "g" || e.unit === "oz" ? `${+e.amount} ${e.unit}` : `${+e.amount === 1 ? "" : `${+e.amount} × `}${e.unit}`);

/** A food from any source (search hit, recent entry, saved food) as { name, brand, source, ref, basis }. */
const asFood = (x) => ({ name: x.name, brand: x.brand || null, source: x.source, ref: x.ref ?? x.source_ref ?? x.id ?? null, basis: x.basis || null });

export default function AddFood({ food, meal: meal0, date, onClose, notify }) {
  const [view, setView] = useState({ step: "find" }); // find | portion {food} | tank | manual
  const [meal, setMeal] = useState(meal0);
  const mealLabel = MEALS.find((m) => m.id === meal)?.label;
  const add = (row, label) => {
    food.addEntry({ date, meal, ...row });
    notify?.(`${label} added to ${mealLabel}`);
    onClose();
  };
  const title = view.step === "tank" ? "Add with Tank" : view.step === "manual" ? "Enter manually" : view.step === "portion" ? "How much?" : `Add to ${mealLabel}`;

  return (
    <Sheet title={title} sub={view.step === "find" ? "Describe it to Tank, pick a recent food, or search." : view.step === "tank" ? "Say what you ate. Tank works out the macros." : null}
      onClose={onClose} labelledBy="add-food-title" className={"sheet-tall" + (view.step === "tank" ? " sheet-chat" : "")}>
      {view.step !== "find" && (
        <button type="button" className="btn-quiet food-back" onClick={() => setView({ step: "find" })}><ChevronLeft size={16} aria-hidden="true" /> Back</button>
      )}
      {view.step === "find" && <Find food={food} onPick={(f) => setView({ step: "portion", food: f })} onTank={() => setView({ step: "tank" })} onManual={() => setView({ step: "manual" })} />}
      {view.step === "tank" && (
        <TankMeal meal={meal} onMeal={setMeal} action={`Add to ${mealLabel}`}
          onSave={({ meal: m, save }) => {
            // One food for the whole meal; its items ride along in the basis so the breakdown is kept.
            const basis = { perServing: m.total, servingLabel: "meal", items: m.items };
            const ref = save ? food.addFood({ name: m.name, basis }) : null;
            add({ name: m.name, amount: 1, unit: "meal", kcal: m.total.kcal, protein: m.total.protein, carbs: m.total.carbs, fat: m.total.fat, source: "ai", source_ref: ref, basis }, m.name);
          }} />
      )}
      {view.step === "portion" && (
        <Portion item={view.food} meal={meal} onMeal={setMeal} action={`Add to ${mealLabel}`}
          onSave={({ amount, unit, n }) => add({
            name: view.food.name, brand: view.food.brand, amount, unit, grams: n.grams, kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat,
            source: view.food.source, source_ref: view.food.ref ? String(view.food.ref).slice(0, 80) : null, basis: view.food.basis,
          }, view.food.name)} />
      )}
      {view.step === "manual" && (
        <ManualFood meal={meal} onMeal={setMeal} action={`Add to ${mealLabel}`}
          onSave={({ food: f, save }) => {
            const ref = save ? food.addFood(f) : null;
            const n = nutritionFor(f.basis, 1, unitsFor(f.basis)[0].label);
            add({ name: f.name, brand: f.brand, amount: 1, unit: unitsFor(f.basis)[0].label, grams: n.grams, kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat,
              source: save ? "custom" : "quick", source_ref: ref, basis: f.basis }, f.name);
          }} />
      )}
    </Sheet>
  );
}

function Find({ food, onPick, onTank, onManual }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState({ status: "idle", results: [] }); // idle | loading | done | error
  const abort = useRef(null);
  const recents = useMemo(() => recentFoods(food.entries), [food.entries]);
  const mine = food.foods;
  const query = q.trim().toLowerCase();
  const local = useMemo(() => {
    if (!query) return [];
    const hit = (x) => `${x.name} ${x.brand || ""}`.toLowerCase().includes(query);
    return [...mine.filter(hit).map((f) => ({ ...asFood({ ...f, source: "custom" }), key: `mine:${f.id}`, tag: "Your food" })),
      ...recents.filter(hit).map((e) => ({ ...asFood(e), key: `recent:${e.id}`, tag: "Recent" }))].slice(0, 6);
  }, [query, mine, recents]);

  // Search as they type, after a short pause; a newer search cancels the one in flight.
  useEffect(() => {
    abort.current?.abort();
    if (query.length < 2) { setState({ status: "idle", results: [] }); return; }
    const ctl = new AbortController();
    abort.current = ctl;
    setState((s) => ({ ...s, status: "loading" }));
    const t = setTimeout(() => {
      searchFoods({ q: query, signal: ctl.signal })
        .then((r) => setState({ status: "done", results: r.results || [], partial: r.partial }))
        .catch((e) => { if (e.name !== "AbortError") setState({ status: "error", results: [], kind: e.kind }); });
    }, 350);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [query]);

  const row = (x, key, sub) => (
    <button key={key} type="button" className="list-row food-row" onClick={() => onPick(x)}>
      <span className="name">{x.name}<span className="sub">{sub}</span></span>
      <Plus size={18} aria-hidden="true" className="muted" />
    </button>
  );
  const per = (x) => (x.basis?.per100 ? `${fmt(x.basis.per100.kcal)} kcal / 100 g` : x.basis?.perServing ? `${fmt(x.basis.perServing.kcal)} kcal / ${x.basis.servingLabel || "serving"}` : "");

  return (
    <>
      <label className="food-search">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">Search foods</span>
        <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search foods, e.g. greek yogurt" enterKeyHint="search" />
      </label>
      {/* The fastest way for a mixed meal: say it, Tank itemizes it. */}
      <button type="button" className="tank-add" onClick={onTank}>
        <Coach id="tank" size={40} still decorative />
        <span><b>Add with Tank</b><small>Describe your meal. Tank works out the macros.</small></span>
      </button>
      <div className="food-actions">
        <button type="button" className="chip" onClick={onManual}><PenLine size={15} aria-hidden="true" /> Enter manually</button>
      </div>

      {!query && (
        <>
          {mine.length > 0 && (
            <section className="section">
              <h3 className="lbl">Your foods</h3>
              <div className="list">{mine.map((f) => row({ ...asFood({ ...f, source: "custom" }) }, `mine:${f.id}`, [f.brand, per(f)].filter(Boolean).join(" · ")))}</div>
            </section>
          )}
          <section className="section">
            <h3 className="lbl">Recent</h3>
            {recents.length
              ? <div className="list">{recents.map((e) => row(asFood(e), e.id, [e.brand, `${amountLabel(e)} · ${fmt(e.kcal)} kcal`].filter(Boolean).join(" · ")))}</div>
              : <p className="small muted">Foods you log show up here for one-tap logging next time.</p>}
          </section>
        </>
      )}

      {query && (
        <>
          {local.length > 0 && <div className="list">{local.map((x) => row(x, x.key, [x.tag, x.brand].filter(Boolean).join(" · ")))}</div>}
          {state.status === "loading" && <p className="small muted" aria-live="polite">Searching…</p>}
          {state.status === "error" && <p className="setup-hint" role="alert">{SEARCH_TROUBLE[state.kind] || SEARCH_TROUBLE.busy}</p>}
          {state.status === "done" && (
            state.results.length
              ? <div className="list">{state.results.map((x) => row(x, x.id, [x.brand, per(x)].filter(Boolean).join(" · ")))}</div>
              : <p className="small muted">Nothing found for "{q.trim()}". Try fewer words, or use quick add.</p>
          )}
          {state.partial && <p className="small muted">Some results may be missing; one food database didn't answer.</p>}
        </>
      )}
    </>
  );
}

function MealChips({ meal, onMeal }) {
  return (
    <div className="setup-choices food-meals" role="group" aria-label="Meal">
      {MEALS.map((m) => <button key={m.id} type="button" className="chip" aria-pressed={meal === m.id} onClick={() => onMeal(m.id)}>{m.label}</button>)}
    </div>
  );
}

function Macros({ n }) {
  return (
    <div className="food-macros" aria-live="polite">
      <div><b>{fmt(n.kcal)}</b><span>kcal</span></div>
      <div><b>{g(n.protein)}</b><span>protein</span></div>
      <div><b>{g(n.carbs)}</b><span>carbs</span></div>
      <div><b>{g(n.fat)}</b><span>fat</span></div>
    </div>
  );
}

/** Amount and unit for a food with a known basis, with the result shown live. Also used to edit an entry. */
export function Portion({ item, amount: a0, unit: u0, meal, onMeal, action, onSave, onDelete }) {
  const units = unitsFor(item.basis);
  const d = defaultPortion(item.basis);
  const [amount, setAmount] = useState(String(a0 ?? d.amount));
  const [unit, setUnit] = useState(u0 && units.some((u) => u.label === u0) ? u0 : d.unit);
  const n = nutritionFor(item.basis, amount, unit);
  const ok = +amount > 0 && +amount < 100000;
  const step = unit === "g" ? 10 : unit === "oz" ? 1 : 0.5;
  // Switching unit keeps the same amount of food: 170 g becomes 6 oz or 1 serving (170 g).
  const switchUnit = (u) => {
    if (u.label === unit) return;
    setUnit(u.label);
    if (!u.grams || !n.grams) return;
    const v = n.grams / u.grams;
    setAmount(String(u.label === "g" ? Math.round(v) : u.label === "oz" ? Math.round(v * 10) / 10 : Math.max(0.25, Math.round(v * 4) / 4)));
  };
  const bump = (dir) => setAmount((v) => String(Math.max(step, Math.round(((+v || 0) + dir * step) * 100) / 100)));
  return (
    <form className="food-form" onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ amount: +amount, unit, n }); }}>
      <div className="food-title"><b>{item.name}</b>{item.brand && <span className="muted small">{item.brand}</span>}</div>
      {item.basis?.items?.length > 0 && (
        <ul className="meal-breakdown">{item.basis.items.map((x, i) => <li key={i}>{x.food} · {x.estimated ? "~" : ""}{x.amount}<span>{Math.round(x.kcal)}</span></li>)}</ul>
      )}
      <div className="food-amount">
        <button type="button" className="icon-btn boxed" onClick={() => bump(-1)} aria-label="Less">−</button>
        <input className="input tn" type="number" inputMode="decimal" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
        <button type="button" className="icon-btn boxed" onClick={() => bump(1)} aria-label="More">+</button>
      </div>
      <div className="setup-choices" role="group" aria-label="Unit">
        {units.map((u) => <button key={u.label} type="button" className="chip" aria-pressed={unit === u.label} onClick={() => switchUnit(u)}>{u.label}</button>)}
      </div>
      <Macros n={n} />
      {onMeal && <MealChips meal={meal} onMeal={onMeal} />}
      <button type="submit" className="btn btn-ink" disabled={!ok}><Check size={18} strokeWidth={3} aria-hidden="true" /> {action}</button>
      {onDelete && <button type="button" className="btn-quiet danger" onClick={onDelete}><Trash2 size={16} aria-hidden="true" style={{ verticalAlign: -3 }} /> Remove</button>}
    </form>
  );
}

const numField = (label, value, set, props = {}) => (
  <label className="field"><span className="lbl">{label}</span>
    <input className="input tn" type="number" inputMode="decimal" step="any" min="0" value={value} onChange={(e) => set(e.target.value)} {...props} /></label>
);

/** Calories (and macros if known) with no food behind them: a restaurant meal, a label at hand. Also edits one. */
export function QuickAdd({ entry, meal, onMeal, action, onSave, onDelete }) {
  const [name, setName] = useState(entry?.name ?? "");
  const [kcal, setKcal] = useState(entry ? String(Math.round(entry.kcal)) : "");
  const [p, setP] = useState(entry?.protein ? String(entry.protein) : "");
  const [c, setC] = useState(entry?.carbs ? String(entry.carbs) : "");
  const [f, setF] = useState(entry?.fat ? String(entry.fat) : "");
  const ok = +kcal > 0 && +kcal < 20000;
  return (
    <form className="food-form" onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ name: name.trim() || "Quick add", kcal: Math.round(+kcal), protein: +p || 0, carbs: +c || 0, fat: +f || 0 }); }}>
      <label className="field"><span className="lbl">Name (optional)</span>
        <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chipotle bowl" /></label>
      {numField("Calories", kcal, setKcal, { autoFocus: !entry, required: true })}
      <div className="grid-3">{numField("Protein g", p, setP)}{numField("Carbs g", c, setC)}{numField("Fat g", f, setF)}</div>
      {onMeal && <MealChips meal={meal} onMeal={onMeal} />}
      <button type="submit" className="btn btn-ink" disabled={!ok}><Check size={18} strokeWidth={3} aria-hidden="true" /> {action}</button>
      {onDelete && <button type="button" className="btn-quiet danger" onClick={onDelete}><Trash2 size={16} aria-hidden="true" style={{ verticalAlign: -3 }} /> Remove</button>}
    </form>
  );
}

/** Enter a food by hand: from a label, or just the calories. Saving it to your foods is optional;
    with a weight, it can later be logged in g and oz too. */
function ManualFood({ meal, onMeal, action, onSave }) {
  const [name, setName] = useState("");
  const [serving, setServing] = useState("serving");
  const [grams, setGrams] = useState("");
  const [kcal, setKcal] = useState("");
  const [p, setP] = useState(""), [c, setC] = useState(""), [f, setF] = useState("");
  const [save, setSave] = useState(false);
  const ok = +kcal > 0 && +kcal < 20000;
  const submit = (e) => {
    e.preventDefault();
    if (!ok) return;
    const per = { kcal: Math.round(+kcal), protein: +p || 0, carbs: +c || 0, fat: +f || 0 };
    const label = serving.trim() || "serving";
    const w = +grams;
    const basis = w > 0
      ? { per100: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, Math.round((v / w) * 1000) / 10])), portions: [{ label: `${label} (${w} g)`, grams: w }] }
      : { perServing: per, servingLabel: label };
    onSave({ food: { name: name.trim() || "Quick add", brand: null, basis }, save: save && !!name.trim() });
  };
  return (
    <form className="food-form" onSubmit={submit}>
      <label className="field"><span className="lbl">Name</span>
        <input className="input" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chipotle bowl" /></label>
      {numField("Calories", kcal, setKcal, { required: true })}
      <div className="grid-3">{numField("Protein g", p, setP)}{numField("Carbs g", c, setC)}{numField("Fat g", f, setF)}</div>
      <div className="grid-2">
        <label className="field"><span className="lbl">Serving</span><input className="input" value={serving} maxLength={40} onChange={(e) => setServing(e.target.value)} placeholder="e.g. 1 slice" /></label>
        {numField("Weight g (optional)", grams, setGrams)}
      </div>
      <label className="check-row"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} disabled={!name.trim()} />
        <span>Save to my foods<small>{name.trim() ? "One tap to log it next time." : "Give it a name to save it."}</small></span></label>
      <MealChips meal={meal} onMeal={onMeal} />
      <button type="submit" className="btn btn-ink" disabled={!ok}><Check size={18} strokeWidth={3} aria-hidden="true" /> {action}</button>
    </form>
  );
}
