import React, { useEffect, useMemo, useRef, useState } from "react";
import { BorderBeam } from "border-beam";
import { Search, Plus, PenLine, Pencil, ChevronLeft, ChevronRight, Trash2, Check, ScanBarcode, X } from "lucide-react";
import Coach from "./Coach.jsx";
import { COACHES } from "../data/coaches.js";
import TankMeal from "./TankMeal.jsx";
import ScanFood from "./ScanFood.jsx";
import { Sheet } from "./ui.jsx";
import { useReducedMotion } from "../lib/motion.js";
import { useTheme } from "../lib/theme.js";
import { MEALS, unitsFor, nutritionFor, defaultPortion, totals, addDays } from "../lib/nutrition.js";
import { yourFoods, pickYourFood, whenLabel } from "../lib/yourFoods.js";
import { readQuery, matchScore, portionFor, mealItems } from "../lib/foodQuery.js";
import { searchFoods, SEARCH_TROUBLE } from "../lib/foodSearch.js";

/* Adding food: one box for everything. It searches your foods (one tap, then Add, ranked by what you
   have and when) and the food databases, and when what's typed reads as a meal in words, the head coach
   steps up to itemize it into one food. Or scan a barcode, or enter it by hand. Every path shows exactly
   what will be logged before Add. `food` is the useFood() store; `meal` and `date` are where it goes. */

const fmt = (n) => Math.round(n).toLocaleString();
const g = (n) => `${Math.round(n)} g`;
/** "150 g" / "1 serving (170 g)" / "2 × breast (172 g)" for a list row. */
export const amountLabel = (e) => (e.unit === "g" || e.unit === "oz" ? `${+e.amount} ${e.unit}` : `${+e.amount === 1 ? "" : `${+e.amount} × `}${e.unit}`);

/** A food from any source (search hit, recent entry, saved food) as { name, brand, source, ref, basis }. */
const asFood = (x) => ({ name: x.name, brand: x.brand || null, source: x.source, ref: x.ref ?? x.source_ref ?? x.id ?? null, basis: x.basis || null });
/** A barcode match on this phone (see foodForBarcode) as a food. */
const scannedFood = ({ kind, item }) => (kind === "saved" ? asFood({ ...item, source: "custom" }) : asFood(item));

/* On a phone the sheet opens without focusing search: the keyboard rising while the sheet slides up
   reads as two motions fighting, and it covers what's tapped most (your foods, Scan). Tapping the
   search box brings the keyboard. With a real keyboard, search is ready at once. */
const touchScreen = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** `head`: the head coach, who itemizes a described meal. */
export default function AddFood({ food, head = "tank", meal: meal0, date, targets = null, onClose, notify }) {
  const who = COACHES[head].name;
  const [view, setView] = useState({ step: "find" }); // find (with the coach inside) | portion {food} | scan | manual {barcode?}
  const [meal, setMeal] = useState(meal0);
  const mealLabel = MEALS.find((m) => m.id === meal)?.label;
  const add = (row, label) => {
    food.addEntry({ date, meal, ...row });
    notify?.(`${label} added to ${mealLabel}`);
    onClose();
  };
  // Everything a meal was, logged again in one tap ("Same as yesterday's lunch").
  const addMany = (rows, label) => {
    rows.forEach((row) => food.addEntry({ date, meal, ...row }));
    notify?.(`${label} added to ${mealLabel}`);
    onClose();
  };
  // Where the day stands, so what's picked is picked knowing it: "1,120 kcal left · 45 g protein to go".
  const left = useMemo(() => {
    if (!targets) return null;
    const t = totals(food.entries.filter((e) => e.date === date));
    return { kcal: Math.round(targets.kcal - t.kcal), protein: Math.round(targets.protein - t.protein) };
  }, [targets, food.entries, date]);
  const standing = left && [left.kcal >= 0 ? `${fmt(left.kcal)} kcal left` : `${fmt(-left.kcal)} kcal over`, left.protein > 0 ? `${fmt(left.protein)} g protein to go` : "protein done"].join(" · ");
  const tankSave = ({ meal: m, save }) => {
    // One food for the whole meal; its items ride along in the basis so the breakdown is kept.
    const basis = { perServing: m.total, servingLabel: "meal", items: m.items };
    const ref = save ? food.addFood({ name: m.name, basis }) : null;
    add({ name: m.name, amount: 1, unit: "meal", kcal: m.total.kcal, protein: m.total.protein, carbs: m.total.carbs, fat: m.total.fat, source: "ai", source_ref: ref, basis }, m.name);
  };
  const [editing, setEditing] = useState(null); // the saved food being renamed or deleted
  const saved = view.step === "portion" && ["custom", "ai"].includes(view.food.source) ? food.foods.find((f) => f.id === view.food.ref) || null : null;
  const picked = saved ? { ...view.food, name: saved.name } : view.food; // a rename shows (and logs) at once
  const title = view.step === "scan" ? "Scan a barcode" : view.step === "manual" ? (view.barcode ? "Enter from the label" : "Enter manually")
    : view.step === "portion" ? "How much?" : `Add to ${mealLabel}`;

  return (
    <Sheet title={title} sub={view.step === "find" ? (standing || `Search your foods, or describe what you ate and ${who} works it out.`) : null}
      onClose={onClose} labelledBy="add-food-title" className="sheet-tall" focusField={!touchScreen()}>
      {view.step !== "find" && (
        <button type="button" className="btn-quiet food-back" onClick={() => setView({ step: "find" })}><ChevronLeft size={16} aria-hidden="true" /> Back</button>
      )}
      {view.step === "find" && <Find food={food} head={head} meal={meal} onMeal={setMeal} date={date} action={`Add to ${mealLabel}`} onTankSave={tankSave} onRepeat={addMany}
        onPick={(f, prior) => setView({ step: "portion", food: f, prior })} onScan={() => setView({ step: "scan" })} onManual={() => setView({ step: "manual" })} />}
      {view.step === "scan" && <ScanFood food={food} toFood={scannedFood} onFound={(f) => setView({ step: "portion", food: f })} onManual={(barcode) => setView({ step: "manual", barcode })} />}
      {view.step === "portion" && (
        <>
        <Portion item={picked} amount={view.prior?.amount} unit={view.prior?.unit} meal={meal} onMeal={setMeal} action={`Add to ${mealLabel}`}
          onSave={({ amount, unit, n }) => add({
            name: picked.name, brand: picked.brand, amount, unit, grams: n.grams, kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat,
            source: picked.source, source_ref: picked.ref ? String(picked.ref).slice(0, 80) : null, basis: picked.basis,
          }, picked.name)} />
        {/* Renaming or deleting a saved food lives here, not on every row of the list. */}
        {saved && <button type="button" className="btn-quiet food-edit" onClick={() => setEditing(saved)}><Pencil size={15} aria-hidden="true" /> Rename or delete this saved food</button>}
        {editing && <EditSavedFood food={food} item={editing} onClose={(gone) => { setEditing(null); if (gone) setView({ step: "find" }); }} />}
        </>
      )}
      {view.step === "manual" && (
        <ManualFood meal={meal} onMeal={setMeal} action={`Add to ${mealLabel}`} barcode={view.barcode}
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

const TOP = 8; // your foods shown before "Show all"
const MEAL_WORD = Object.fromEntries(MEALS.map((m) => [m.id, m.label.toLowerCase()]));

/* One box for everything (see the top of this file). When what's typed reads as a meal in words, the
   head coach takes the box: it glows in their color, the meal's items show as chips as it's understood
   (one of the lifter's own foods marked as theirs, and handed to the coach so it uses their numbers),
   and Return sends it. The coach answers right here under the box, and the box takes the replies. */
function Find({ food, head, meal, onMeal, date, action, onTankSave, onRepeat, onPick, onScan, onManual }) {
  const who = COACHES[head].name;
  const [q, setQ] = useState("");
  const [state, setState] = useState({ status: "idle", results: [] }); // idle | loading | done | error
  const [all, setAll] = useState(false); // every one of your foods, not just the top
  const [lookUp, setLookUp] = useState(false); // search the databases for a description after all
  const [tank, setTank] = useState(null); // { first, known }: the coach working on a described meal, under the box
  const [busy, setBusy] = useState(false); // the coach is thinking
  const abort = useRef(null);
  const input = useRef(null);
  const tankRef = useRef(null);
  const reduced = useReducedMotion();
  const theme = useTheme();
  const ranked = useMemo(() => yourFoods(food.entries, food.foods, { meal }), [food.entries, food.foods, meal]);
  // What's typed: a search, an amount and a food, or a meal in words for the coach (lib/foodQuery.js).
  // A name of one of their own foods is a search for it, however list-like it reads.
  const known = useMemo(() => q.trim() && ranked.some((x) => matchScore(x, q) >= 2), [ranked, q]);
  const read = useMemo(() => readQuery(q, { known }), [q, known]);
  const describing = !tank && read.kind === "describe";
  const term = tank || read.kind === "empty" ? "" : read.food;
  // Their own foods first, best match first, then most used.
  const mine = useMemo(() => {
    if (!term) return ranked;
    return ranked.map((x) => ({ x, m: matchScore(x, term) })).filter((r) => r.m > 0).sort((a, b) => b.m - a.m).map((r) => r.x);
  }, [ranked, term]);
  useEffect(() => { setAll(false); setLookUp(false); }, [term]);

  // A described meal, item by item, each matched to one of their own foods where it clearly is one.
  const items = useMemo(() => (describing ? mealItems(q).map((it) => {
    const own = it.food.length >= 3 ? ranked.map((x) => ({ x, m: matchScore(x, it.food) })).filter((r) => r.m >= 2).sort((a, b) => b.m - a.m || b.x.score - a.x.score)[0]?.x : null;
    return { ...it, own };
  }) : []), [describing, q, ranked]);
  // What the coach is told about those foods: their usual amount and its numbers.
  const knownLines = (its) => [...new Set(its.filter((it) => it.own).map((it) => {
    const p = pickYourFood(it.own);
    const n = nutritionFor(p.food.basis, p.amount || 1, p.unit || unitsFor(p.food.basis)[0].label);
    return `${p.food.name}: ${p.amount || 1} ${p.unit || "serving"} = ${fmt(n.kcal)} kcal, ${Math.round(n.protein)} g protein, ${Math.round(n.carbs)} g carbs, ${Math.round(n.fat)} g fat`;
  }))];

  // The food databases, as they type, after a short pause; a newer search cancels the one in flight.
  // A description doesn't go to them (its words would only find pieces of it) unless asked.
  const dbTerm = describing && !lookUp ? "" : term;
  useEffect(() => {
    abort.current?.abort();
    if (dbTerm.length < 2) { setState({ status: "idle", results: [] }); return; }
    const ctl = new AbortController();
    abort.current = ctl;
    setState((s) => ({ ...s, status: "loading" }));
    const t = setTimeout(() => {
      searchFoods({ q: dbTerm, signal: ctl.signal })
        .then((r) => setState({ status: "done", results: r.results || [], partial: r.partial }))
        .catch((e) => { if (e.name !== "AbortError") setState({ status: "error", results: [], kind: e.kind }); });
    }, 350);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [dbTerm]);
  // A database food that's already one of theirs shows once, as theirs.
  const mineKeys = useMemo(() => new Set(mine.map((x) => `${x.name}|${x.brand || ""}`.toLowerCase())), [mine]);
  const results = state.results.filter((x) => !mineKeys.has(`${x.name}|${x.brand || ""}`.toLowerCase()));

  // Yesterday's same meal, to log again in one tap.
  const yesterday = useMemo(() => {
    const es = food.entries.filter((e) => e.date === addDays(date, -1) && e.meal === meal);
    return es.length ? { entries: es, kcal: totals(es).kcal } : null;
  }, [food.entries, date, meal]);

  // An amount typed with the food starts its portion there: "200g chicken breast" opens at 200 g.
  const pickMine = (x) => {
    const p = pickYourFood(x);
    const at = read.kind === "amount" ? portionFor(unitsFor(p.food.basis), read.amount, read.unit) : null;
    onPick(p.food, at ? { amount: at.unit ? at.amount : at.amount * (p.unit && p.amount ? p.amount : 1), unit: at.unit || p.unit } : { amount: p.amount, unit: p.unit });
  };
  const pickResult = (x) => {
    const at = read.kind === "amount" ? portionFor(unitsFor(x.basis), read.amount, read.unit) : null;
    onPick(x, at || undefined);
  };
  const startTank = (text) => { setTank({ first: text, known: knownLines(mealItems(text).map((it) => ({ ...it, own: items.find((x) => x.text === it.text)?.own }))) }); setQ(""); input.current?.blur(); };
  const stopTank = () => { setTank(null); setBusy(false); setQ(""); };
  // Return: with the coach working, a reply to them; a description goes to the coach; an amount opens
  // the best match; a search just closes the keyboard.
  const submit = (e) => {
    e.preventDefault();
    if (tank) { if (q.trim() && !busy) { tankRef.current?.send(q); setQ(""); input.current?.blur(); } return; }
    if (describing) return startTank(read.text);
    if (read.kind === "amount" && mine[0]) return pickMine(mine[0]);
    if (read.kind === "amount" && results[0]) return pickResult(results[0]);
    input.current?.blur();
  };

  // "4× · usually breakfast · yesterday": why it's here, so the list's order makes sense.
  const why = (x) => [x.brand, x.count > 1 && `${x.count}×`, x.usual && `usually ${MEAL_WORD[x.usual]}`, x.lastDate ? whenLabel(x.lastDate) : "saved"].filter(Boolean).join(" · ");
  const shown = all ? mine : mine.slice(0, term ? 5 : TOP);
  const more = mine.length - shown.length;
  const coachOn = !!tank || describing;

  const box = (
    <form className={"food-search" + (coachOn ? " coach-on" : "")} role="search" onSubmit={submit} style={{ "--c": COACHES[head].color }}>
      {coachOn ? <span className="food-search-coach" aria-hidden="true"><Coach id={head} size={22} mood={busy ? "focused" : "idle"} still decorative /></span> : <Search size={18} aria-hidden="true" />}
      <label htmlFor="food-q" className="sr-only">{tank ? `Reply to ${who}` : "Search foods, or describe a meal"}</label>
      <input id="food-q" ref={input} type="search" autoFocus={!touchScreen()} value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={tank ? `Reply or correct it` : "Search or describe a meal"}
        enterKeyHint={tank || describing ? "send" : read.kind === "amount" ? "go" : "search"} autoComplete="off" />
      {tank
        ? <button type="button" className="icon-btn food-scan" onClick={stopTank} aria-label={`Stop and search instead`}><X size={20} /></button>
        : <button type="button" className="icon-btn food-scan" onClick={onScan} aria-label="Scan a barcode"><ScanBarcode size={20} /></button>}
    </form>
  );

  return (
    <>
      {/* The coach's color travels the box's border while they're on it: slowly while listening, quicker
          while working. With reduced motion, a still border in their color says the same. */}
      {/* The box stays at the top while the list or the coach's answer scrolls under it. */}
      <div className="food-box">
        {coachOn && !reduced
          ? <BorderBeam size="md" colorVariant="forest" theme={theme} duration={busy ? 1.4 : 3.6} brightness={busy ? 1.5 : 1.1} className="food-search-beam">{box}</BorderBeam>
          : box}
      </div>

      {tank && (
        <>
          <TankMeal ref={tankRef} embedded coach={head} first={tank.first} known={tank.known} onBusy={setBusy}
            meal={meal} onMeal={onMeal} action={action} onSave={onTankSave} onManual={onManual} />
          <button type="button" className="btn-quiet food-manual" onClick={stopTank}><Search size={15} aria-hidden="true" /> Search instead</button>
        </>
      )}

      {describing && (
        <button type="button" className="tank-row lead" onClick={() => startTank(read.text)}>
          <Coach id={head} size={34} still decorative />
          <span className="tank-row-text">
            <b>Log this with {who}</b>
            <span className="meal-chips" aria-label="Understood as">
              {items.map((it, k) => (
                <span key={k} className={"meal-chip" + (it.own ? " own" : "")}>
                  {it.own && <Check size={12} strokeWidth={3} aria-hidden="true" />}
                  {it.amount != null && <b>{fmtAmount(it.amount)}{it.unit ? ` ${it.unit}` : ""}</b>}
                  {it.own ? it.own.name : it.food}
                </span>
              ))}
            </span>
            <small>{items.some((it) => it.own) ? `Uses your own foods where it can. ` : ""}Return sends it.</small>
          </span>
          <ChevronRight size={18} aria-hidden="true" className="muted" />
        </button>
      )}

      {!tank && (mine.length > 0 || read.kind === "empty") && (
        <section className="section food-group" aria-labelledby="your-foods-lbl">
          <h3 className="lbl" id="your-foods-lbl">Your foods</h3>
          {read.kind === "empty" && yesterday && (
            <button type="button" className="food-repeat" onClick={() => onRepeat(yesterday.entries.map(copyEntry), `Yesterday's ${MEAL_WORD[meal]}`)}>
              <span className="name">Same as yesterday's {MEAL_WORD[meal]}<span className="sub detail">{yesterday.entries.map((e) => e.name).join(" · ")}</span></span>
              <span className="food-kcal">{fmt(yesterday.kcal)}<small> kcal</small></span>
              <Plus size={18} aria-hidden="true" className="muted" />
            </button>
          )}
          {mine.length ? (
            <div className="list">
              {shown.map((x) => (
                <div key={x.key} className="list-row food-row food-row-wrap">
                  <button type="button" className="food-row-main" onClick={() => pickMine(x)}>
                    <span className="name">{x.name}<span className="sub detail">{why(x)}</span></span>
                    {x.kcal != null && <span className="food-kcal">{fmt(x.kcal)}<small> kcal</small></span>}
                    <Plus size={18} aria-hidden="true" className="muted" />
                  </button>
                </div>
              ))}
              {more > 0 && <button type="button" className="list-row food-more" onClick={() => setAll(true)}>Show all {mine.length}</button>}
            </div>
          ) : (
            // Nothing logged yet: the box itself is the way in, so say what it can do.
            <div className="food-first">
              <Coach id={head} size={40} still decorative />
              <p>Type what you ate, like <q>2 eggs and toast</q>, and {who} works out the macros. Or search for a food, or scan its barcode.</p>
            </div>
          )}
        </section>
      )}

      {describing && !lookUp && term.length >= 2 && (
        <button type="button" className="btn-quiet food-lookup" onClick={() => setLookUp(true)}><Search size={15} aria-hidden="true" /> Search the food database for it instead</button>
      )}

      {!tank && dbTerm.length >= 2 && (
        <section className="section food-group" aria-labelledby="food-db-lbl" aria-busy={state.status === "loading"}>
          <h3 className="lbl food-db-lbl" id="food-db-lbl">Food database<span className="detail">USDA · Open Food Facts</span></h3>
          {state.status === "loading" && (
            <div className="list food-skel" aria-label="Searching">{[0, 1, 2].map((k) => <div key={k} className="list-row"><i /><i /></div>)}</div>
          )}
          {state.status === "error" && <p className="setup-hint" role="alert">{SEARCH_TROUBLE[state.kind] || SEARCH_TROUBLE.busy}</p>}
          {state.status === "done" && (
            results.length
              ? <div className="list food-results">{results.map((x) => (
                <div key={x.id} className="list-row food-row food-row-wrap">
                  <button type="button" className="food-row-main" onClick={() => pickResult(x)}>
                    <span className="name">{x.name}<span className="sub">{[x.brand, serving(x)].filter(Boolean).join(" · ")}</span></span>
                    <Plus size={18} aria-hidden="true" className="muted" />
                  </button>
                </div>
              ))}</div>
              : <p className="small muted">Nothing found for <q>{dbTerm}</q>{state.partial ? " (one food database didn't answer, so try again in a moment)" : ""}. Try fewer words, or describe it to {who}.</p>
          )}
        </section>
      )}

      {!tank && read.kind !== "empty" && !describing && (
        <button type="button" className="tank-row" onClick={() => startTank(read.text)}>
          <Coach id={head} size={28} still decorative />
          <span className="tank-row-text"><b>Ask {who} about <q>{read.text}</q></b><small>{who} works out the macros from a description.</small></span>
          <ChevronRight size={18} aria-hidden="true" className="muted" />
        </button>
      )}
      {!tank && <button type="button" className="btn-quiet food-manual" onClick={onManual}><PenLine size={15} aria-hidden="true" /> Enter manually</button>}
    </>
  );
}

/** "2", "½", "1.5" for a chip. */
const fmtAmount = (n) => ({ 0.5: "½", 0.25: "¼", 0.75: "¾" }[n] ?? String(Math.round(n * 100) / 100));
/** A logged entry, as a new entry to log again (any date and meal). */
const copyEntry = (e) => ({ name: e.name, brand: e.brand ?? null, amount: e.amount, unit: e.unit, grams: e.grams ?? null, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat,
  source: e.source, source_ref: e.source_ref ?? null, basis: e.basis ?? null });

/** A database food's usual serving and its calories ("1 cup (240 g) · 170 kcal"), else per 100 g. */
function serving(x) {
  const b = x.basis;
  if (!b) return "";
  if (b.perServing) return `${b.servingLabel || "serving"} · ${fmt(b.perServing.kcal)} kcal`;
  const p = (b.portions || []).find((u) => u.grams > 0);
  if (p) return `${p.label} · ${fmt(nutritionFor(b, 1, p.label).kcal)} kcal`;
  return `${fmt(b.per100.kcal)} kcal / 100 g`;
}

function MealChips({ meal, onMeal }) {
  return (
    <div className="setup-choices food-meals" role="group" aria-label="Meal">
      {MEALS.map((m) => <button key={m.id} type="button" className="chip" aria-pressed={meal === m.id} onClick={() => onMeal(m.id)}>{m.label}</button>)}
    </div>
  );
}

const MACROS = [["kcal", "kcal"], ["protein", "protein"], ["carbs", "carbs"], ["fat", "fat"]];
const macroValue = (k, v) => (k === "kcal" ? fmt(v) : g(v));

/** The totals. With `onShow` (a meal with a breakdown), each is a button picking what the breakdown lists. */
function Macros({ n, shown, onShow }) {
  return (
    <div className="food-macros" aria-live="polite" role={onShow ? "group" : undefined} aria-label={onShow ? "Show per ingredient" : undefined}>
      {MACROS.map(([k, label]) => onShow
        ? <button key={k} type="button" aria-pressed={shown === k} onClick={() => onShow(k)}><b>{macroValue(k, n[k])}</b><span>{label}</span></button>
        : <div key={k}><b>{macroValue(k, n[k])}</b><span>{label}</span></div>)}
    </div>
  );
}

/** Amount and unit for a food with a known basis, with the result shown live. Also used to edit an entry. */
export function Portion({ item, amount: a0, unit: u0, meal, onMeal, action, onSave, onDelete, editName = false }) {
  const [name, setName] = useState(item.name);
  const units = unitsFor(item.basis);
  const d = defaultPortion(item.basis);
  const [amount, setAmount] = useState(String(a0 ?? d.amount));
  const [unit, setUnit] = useState(u0 && units.some((u) => u.label === u0) ? u0 : d.unit);
  const n = nutritionFor(item.basis, amount, unit);
  const ok = +amount > 0 && +amount < 100000;
  // A meal's ingredients, scaled to the amount, showing whichever total was tapped last.
  const items = item.basis?.items ?? [];
  const [shown, setShown] = useState("kcal");
  const scale = item.basis?.perServing ? Math.max(0, +amount || 0) : 1;
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
    <form className="food-form" onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ amount: +amount, unit, n, name: name.trim() || item.name }); }}>
      {editName
        ? <NameField value={name} onChange={setName} />
        : <div className="food-title"><b>{item.name}</b>{item.brand && <span className="muted small">{item.brand}</span>}</div>}
      {items.length > 0 && (
        <ul className="meal-breakdown" aria-label={`Per ingredient: ${shown}`}>
          <li className="meal-breakdown-head">{shown}</li>
          {items.map((x, i) => <li key={i}>{x.food} · {x.estimated && !String(x.amount).startsWith("~") ? "~" : ""}{x.amount}<span>{macroValue(shown, (x[shown] || 0) * scale)}</span></li>)}
        </ul>
      )}
      <div className="food-amount">
        <button type="button" className="icon-btn boxed" onClick={() => bump(-1)} aria-label="Less">−</button>
        <input className="input tn" type="number" inputMode="decimal" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
        <button type="button" className="icon-btn boxed" onClick={() => bump(1)} aria-label="More">+</button>
      </div>
      <div className="setup-choices" role="group" aria-label="Unit">
        {units.map((u) => <button key={u.label} type="button" className="chip" aria-pressed={unit === u.label} onClick={() => switchUnit(u)}>{u.label}</button>)}
      </div>
      <Macros n={n} shown={shown} onShow={items.length > 0 ? setShown : undefined} />
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
    with a weight, it can later be logged in g and oz too. With a `barcode` (a scan no database
    knew), the food keeps it, so the next scan finds it; saving is on by default then. */
function ManualFood({ meal, onMeal, action, onSave, barcode }) {
  const [name, setName] = useState("");
  const [serving, setServing] = useState("serving");
  const [grams, setGrams] = useState("");
  const [kcal, setKcal] = useState("");
  const [p, setP] = useState(""), [c, setC] = useState(""), [f, setF] = useState("");
  const [save, setSave] = useState(!!barcode);
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
    if (barcode) basis.barcode = barcode;
    onSave({ food: { name: name.trim() || "Quick add", brand: null, basis }, save: save && !!name.trim() });
  };
  return (
    <form className="food-form" onSubmit={submit}>
      {barcode && <p className="setup-hint">Barcode {barcode}. Copy the label's serving and nutrition; the weight lets you log it in grams too.</p>}
      <label className="field"><span className="lbl">Name</span>
        <input className="input" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chipotle bowl" /></label>
      {numField("Calories", kcal, setKcal, { required: true })}
      <div className="grid-3">{numField("Protein g", p, setP)}{numField("Carbs g", c, setC)}{numField("Fat g", f, setF)}</div>
      <div className="grid-2">
        <label className="field"><span className="lbl">Serving</span><input className="input" value={serving} maxLength={40} onChange={(e) => setServing(e.target.value)} placeholder="e.g. 1 slice" /></label>
        {numField("Weight g (optional)", grams, setGrams)}
      </div>
      <label className="check-row"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} disabled={!name.trim()} />
        <span>Save to my foods<small>{!name.trim() ? "Give it a name to save it." : barcode ? "Scanning it next time finds it." : "One tap to log it next time."}</small></span></label>
      <MealChips meal={meal} onMeal={onMeal} />
      <button type="submit" className="btn btn-ink" disabled={!ok}><Check size={18} strokeWidth={3} aria-hidden="true" /> {action}</button>
    </form>
  );
}

/** A name field that looks editable: used wherever a food's name can be changed. */
export function NameField({ value, onChange, label = "Name" }) {
  return (
    <label className="field name-field"><span className="lbl">{label}</span>
      <span className="name-input"><input className="input" value={value} maxLength={60} onChange={(e) => onChange(e.target.value)} enterKeyHint="done" />
        <Pencil size={16} aria-hidden="true" /></span></label>
  );
}

/** Rename or delete one of your saved foods. Past log entries keep the name they were logged with. */
function EditSavedFood({ food, item, onClose }) {
  const [name, setName] = useState(item.name);
  const [confirm, setConfirm] = useState(false);
  const save = (e) => { e.preventDefault(); if (name.trim()) food.updateFood(item.id, { name: name.trim() }); onClose(false); };
  return (
    <Sheet title="Your food" sub="Renaming changes it for next time; past entries keep their name." onClose={() => onClose(false)} labelledBy="saved-food-title">
      <form className="food-form" onSubmit={save}>
        <NameField value={name} onChange={setName} />
        <button type="submit" className="btn btn-ink" disabled={!name.trim()}>Save name</button>
        {confirm
          ? <button type="button" className="btn btn-danger" onClick={() => { food.removeFood(item.id); onClose(true); }}>Delete {item.name}</button>
          : <button type="button" className="btn-quiet danger" onClick={() => setConfirm(true)}><Trash2 size={16} aria-hidden="true" style={{ verticalAlign: -3 }} /> Delete from your foods</button>}
      </form>
    </Sheet>
  );
}
