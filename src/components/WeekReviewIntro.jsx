import React, { useEffect, useState } from "react";
import { Sparkles, Target, TrendingUp, Lightbulb, ChevronRight } from "lucide-react";
import { Sheet } from "./ui.jsx";
import { WEEKDAYS, rangeLabel } from "../lib/weekReview.js";
import { listReviews } from "../lib/reviews.js";
import { href } from "../lib/router.js";

/** The glowing button Today shows when a review is ready. `glow` until it's been opened. */
export function ReviewChip({ weekEnd, glow, preview = false }) {
  const inner = (
    <>
      <Sparkles size={14} strokeWidth={2.6} aria-hidden="true" />
      <span className="review-chip-long">Week in review</span><span className="review-chip-short">Your week</span>
    </>
  );
  return preview
    ? <span className={"review-chip glow"} aria-hidden="true">{inner}</span>
    : <a className={"review-chip" + (glow ? " glow" : "")} href={href("review", weekEnd)} data-help="review"
        aria-label={glow ? "Your week in review is ready" : "Week in review"}>{inner}</a>;
}

/** Seven day buttons, Sunday first. */
export function DayPicker({ value, onChange, label = "Review day" }) {
  return (
    <div className="segctl review-days" role="group" aria-label={label}>
      {WEEKDAYS.map((d, i) => (
        <button key={d} type="button" aria-pressed={value === i} aria-label={d} onClick={() => onChange(i)}>{d.slice(0, 1)}</button>
      ))}
    </div>
  );
}

/**
 * First time the lifter meets the feature: what it is, which day, and a way to turn it off.
 * Closing it any other way keeps it on.
 */
export default function WeekReviewIntro({ settings, onSave }) {
  const [day, setDay] = useState(settings.day ?? 0);
  const keep = () => onSave({ ...settings, day, on: true, intro: true });
  return (
    <Sheet title="New: Week in review" sub={`Every ${WEEKDAYS[day]}, your coaches look back at your week with you.`} onClose={keep} labelledBy="review-intro-title" className="review-intro">
      <div className="review-intro-preview">
        <ReviewChip preview glow />
        <span className="small muted">Look for this at the top of Today.</span>
      </div>
      <ul className="review-intro-list">
        <li><Target size={20} aria-hidden="true" /><span>How you did against your training and food goals</span></li>
        <li><TrendingUp size={20} aria-hidden="true" /><span>Your high and low points, and trends across weeks</span></li>
        <li><Lightbulb size={20} aria-hidden="true" /><span>Patterns in your own numbers, and what to focus on next week</span></li>
      </ul>
      <div className="review-intro-day">
        <span className="lbl">Comes out every {WEEKDAYS[day]}</span>
        <DayPicker value={day} onChange={setDay} />
      </div>
      <button type="button" className="btn btn-ink" onClick={keep}>Keep it on</button>
      <button type="button" className="btn-quiet" onClick={() => onSave({ ...settings, day, on: false, intro: true })}>Turn it off</button>
      <p className="small muted review-intro-note">You can change this any time in Settings.</p>
    </Sheet>
  );
}

/** Saved reviews, newest first, each opening its cards. Renders nothing until there's one. */
export function ReviewList({ limit = 26, onLoaded }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    listReviews(limit).then((r) => { if (alive) { setRows(r); onLoaded?.(r.length); } }).catch(() => { if (alive) { setRows([]); onLoaded?.(0); } });
    return () => { alive = false; };
  }, [limit]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows?.length) return null;
  return (
    <div className="list review-list">
      {rows.map((r) => (
        <a key={r.weekEnd} className="list-row" href={href("review", r.weekEnd)}>
          <Sparkles size={18} aria-hidden="true" />
          <span className="name">{rangeLabel(r.weekEnd)}<span className="sub">{r.headline}</span></span>
          <ChevronRight size={18} aria-hidden="true" className="muted" />
        </a>
      ))}
    </div>
  );
}
