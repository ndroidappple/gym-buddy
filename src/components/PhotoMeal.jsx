import React, { useMemo, useRef, useState } from "react";
import { Camera, ArrowUp, RotateCcw, Weight } from "lucide-react";
import { COACHES } from "../data/coaches.js";
import { useMealAnswer, MealAnswer } from "./TankMeal.jsx";
import { fitToScale } from "../lib/nutrition.js";
import { shrinkPhoto } from "../lib/photo.js";

/* Logging a meal from photos of it on a kitchen scale. The scale has the weight, which is what a
   photo alone gets most wrong, so the head coach only has to see what's on the plate and how it
   splits; the app fits his grams to the scale's reading (fitToScale). Two shots: from above shows
   the plate's layout, from the side shows how high it's piled and what's underneath. The reading
   can be typed over when it's misread or wasn't in the shot. The rest is the described-meal answer
   card (TankMeal.jsx), with his question about cooking fat when the food looks cooked in some. */

const SLOTS = ["From above", "From the side"];
const PLATE_KEY = "gb.plate"; // this phone's plate: { on: the reading includes it, grams }
const readPlate = () => {
  try { const p = JSON.parse(localStorage.getItem(PLATE_KEY)); if (p && typeof p.on === "boolean") return { on: p.on, grams: +p.grams > 0 ? +p.grams : "" }; } catch {}
  return { on: false, grams: "" };
};
const keepPlate = (p) => { try { localStorage.setItem(PLATE_KEY, JSON.stringify(p)); } catch {} };
const fmt = (n) => Math.round(n).toLocaleString();

/** `head`: the coach who works it out; `meal`: the slot it's logged to; `onAdd({ meal, save })`. */
export default function PhotoMeal({ head, meal, action, onAdd, onManual }) {
  const who = COACHES[head].name;
  const a = useMealAnswer({ coach: head, mealSlot: meal });
  const [shots, setShots] = useState([null, null]); // { url, data, mediaType } per slot
  const [reading, setReading] = useState(-1); // the slot whose photo is being shrunk
  const [bad, setBad] = useState(false);
  const [plate, setPlate] = useState(readPlate);
  const [note, setNote] = useState("");
  const [weight, setWeight] = useState(null); // the food's weight typed over the reading (null: not typed)
  const [reply, setReply] = useState("");
  const inputs = [useRef(null), useRef(null)];

  const take = async (i, file) => {
    if (!file) return;
    setReading(i);
    setBad(false);
    try {
      const shot = await shrinkPhoto(file);
      setShots((s) => s.map((x, k) => (k === i ? shot : x)));
    } catch { setBad(true); }
    setReading(-1);
  };
  const setPlateTo = (p) => { setPlate(p); keepPlate(p); };
  const plateOk = !plate.on || +plate.grams > 0;
  const ready = shots.some(Boolean) && plateOk && reading < 0;

  const ask = () => {
    const say = [
      "Photos of my meal on the scale.",
      plate.on ? `The reading includes the plate (${plate.grams} g); the app takes it off.` : "The scale was zeroed with the plate on, so it shows the food only.",
      note.trim() && `Note: ${note.trim()}`,
    ].filter(Boolean).join(" ");
    a.ask(say, [], shots.filter(Boolean).map(({ data, mediaType }) => ({ data, mediaType })));
  };
  const again = () => { a.reset(); setShots([null, null]); setWeight(null); setReply(""); };

  // The food's weight: typed, else the reading less the plate when the plate was weighed too.
  const read = a.meal?.scale ?? a.earlier?.scale ?? null;
  const net = weight != null ? +weight || null : read != null ? read - (plate.on ? +plate.grams : 0) : null;
  const fitted = useMemo(() => fitToScale(a.meal, net), [a.meal, net]);
  const earlier = useMemo(() => fitToScale(a.earlier, net), [a.earlier, net]);
  const fit = fitted?.fit;
  // Far from what the plate looks like: most likely a misread digit, or a plate that wasn't zeroed.
  const odd = fit && (fit.k > 1.8 || fit.k < 0.55);
  const unread = weight == null && read == null;
  const under = weight == null && read != null && !(net > 0);

  const asked = a.status !== "idle";
  const working = a.status === "working";
  const follow = (text) => { a.follow(text); setReply(""); };

  const scaleRow = (
    <div className="photo-weight">
      <label className="photo-weight-field">
        <Weight size={18} aria-hidden="true" />
        <span className="lbl">Food weight</span>
        <input className="input tn" inputMode="decimal" autoComplete="off" aria-describedby="photo-weight-how"
          value={weight ?? (net > 0 ? String(Math.round(net)) : "")} placeholder="Type it"
          onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))} />
        <span className="photo-weight-g">g</span>
      </label>
      <small id="photo-weight-how" className={odd || unread || under ? "photo-weight-warn" : "muted"}>
        {weight != null ? (fit ? `${who}'s split, fitted to your ${fmt(fit.net)} g.` : "Type the food's weight, without the plate.")
          : unread ? `Couldn't read the scale in the photo. Type the number and ${who} fits the meal to it.`
          : under ? "The plate weighs more than the reading. Check the plate weight."
          : plate.on ? `Scale ${fmt(read)} g, less the plate's ${fmt(+plate.grams)} g.` : "Read from the scale."}
        {odd && ` That's ${fit.k > 1 ? "a lot more" : "a lot less"} than it looks (about ${fmt(fit.seen)} g by eye), so check the number${plate.on ? " and the plate weight" : " and that the scale was zeroed with the plate on"}.`}
      </small>
    </div>
  );

  return (
    <div className="photo">
      {!asked ? (
        <>
          <p className="small muted">Plate on the scale, with the display in the shot. {who} reads the weight and works out what's on it.</p>
          <div className="photo-shots">
            {SLOTS.map((label, i) => (
              <button key={label} type="button" className={"photo-shot" + (shots[i] ? " taken" : "")} onClick={() => inputs[i].current?.click()}
                aria-label={shots[i] ? `Retake: ${label.toLowerCase()}` : `Take a photo ${label.toLowerCase()}`} aria-busy={reading === i}>
                {shots[i] ? <img src={shots[i].url} alt="" /> : <Camera size={26} aria-hidden="true" />}
                <span>{label}{i > 0 && !shots[i] && <small> optional</small>}</span>
                <input ref={inputs[i]} type="file" accept="image/*" capture="environment" hidden
                  onChange={(e) => { take(i, e.target.files?.[0]); e.target.value = ""; }} />
              </button>
            ))}
          </div>
          {bad && <p className="setup-hint" role="alert">Couldn't open that photo. Try taking it again.</p>}

          <div className="field">
            <span className="lbl" id="photo-plate-lbl">The scale shows</span>
            <div className="setup-choices photo-plate" role="group" aria-labelledby="photo-plate-lbl">
              <button type="button" className="chip" aria-pressed={!plate.on} onClick={() => setPlateTo({ ...plate, on: false })}>Food only (zeroed)</button>
              <button type="button" className="chip" aria-pressed={plate.on} onClick={() => setPlateTo({ ...plate, on: true })}>Food and plate</button>
            </div>
          </div>
          {plate.on && (
            <label className="field"><span className="lbl">Plate weight, empty (remembered)</span>
              <input className="input tn" inputMode="decimal" autoComplete="off" value={plate.grams} placeholder="g"
                onChange={(e) => setPlateTo({ ...plate, grams: e.target.value.replace(/[^\d.]/g, "").slice(0, 5) })} aria-invalid={!plateOk} /></label>
          )}
          <label className="field"><span className="lbl">Anything the photo can't show? <small>optional</small></span>
            <input className="input" autoComplete="off" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Cooked in butter, ranch on the side…" enterKeyHint="go" onKeyDown={(e) => { if (e.key === "Enter" && ready) ask(); }} /></label>

          <button type="button" className="btn btn-ink" disabled={!ready} onClick={ask}>Work it out</button>
        </>
      ) : (
        <div className="photo-strip">
          {shots.map((s, i) => s && <img key={i} src={s.url} alt={`Your meal, ${SLOTS[i].toLowerCase()}`} />)}
          <button type="button" className="btn-quiet" onClick={again}><RotateCcw size={15} aria-hidden="true" style={{ verticalAlign: -2 }} /> New photos</button>
        </div>
      )}

      {asked && (
        <MealAnswer a={{ ...a, meal: fitted, earlier }} coach={head} action={action} onAdd={onAdd} onManual={onManual} onFollow={follow}
          refine={false} extra={scaleRow} />
      )}

      {/* Correct it ("that's quinoa"), or answer the coach's question, as with a described meal. */}
      {asked && (!working || a.earlier) && (
        <form className="chat-input answer-follow" onSubmit={(e) => { e.preventDefault(); if (reply.trim() && !working) follow(reply.trim()); }} aria-busy={working}>
          <label htmlFor="photo-more" className="sr-only">{a.status === "asking" ? `Answer ${who}` : "Correct it or add more"}</label>
          <input id="photo-more" className="lift-reply-input" value={reply} onChange={(e) => setReply(e.target.value)} autoComplete="off" enterKeyHint="send"
            placeholder={a.status === "asking" ? `Answer ${who}` : "Correct it or add more"} />
          <button type="submit" aria-label="Send" disabled={!reply.trim() || working}><ArrowUp size={20} strokeWidth={2.8} /></button>
        </form>
      )}
    </div>
  );
}
