import React, { useEffect, useState } from "react";
import { Sparkles, Target, TrendingUp, Lightbulb, ChevronRight, Bell } from "lucide-react";
import { Sheet } from "./ui.jsx";
import { WEEKDAYS, rangeLabel, hourLabel, whenLabel, coversLabel } from "../lib/weekReview.js";
import { phoneState, allowNotifications } from "../lib/push.js";
import { listReviews, cachedReviews } from "../lib/reviews.js";
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

/** The hour it comes out, as a select (5 AM to 11 PM covers anyone's Sunday). */
export function HourPicker({ value, onChange }) {
  return (
    <label className="review-hour">
      <span className="lbl">Time</span>
      <select className="input" value={value} onChange={(e) => onChange(+e.target.value)}>
        {Array.from({ length: 19 }, (_, i) => i + 5).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
      </select>
    </label>
  );
}

/**
 * First time the lifter meets the feature: what it is, when, a notification when it's ready, and
 * a way to turn it off. Closing it any other way keeps it on, as it was.
 */
export default function WeekReviewIntro({ settings, onSave }) {
  const [day, setDay] = useState(settings.day ?? 0);
  const [hour, setHour] = useState(settings.hour ?? 10);
  const [ping, setPing] = useState(settings.notify !== false);
  const phone = phoneState();
  const canNotify = phone === "on" || phone === "ask";
  const r = { ...settings, day, hour };
  const keep = () => {
    // Asked from this tap: iOS only shows the permission prompt in response to one.
    if (ping && phone === "ask") allowNotifications().catch(() => {});
    onSave({ ...r, notify: ping, on: true, intro: true });
  };
  return (
    <Sheet title="New: Week in review" sub={`Every ${whenLabel(r)}, your coaches look back at your week with you.`} onClose={() => onSave({ ...settings, intro: true })} labelledBy="review-intro-title" className="review-intro">
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
        <span className="lbl">Released every {whenLabel(r)}, covering {coversLabel(r)}</span>
        <DayPicker value={day} onChange={setDay} />
        <HourPicker value={hour} onChange={setHour} />
      </div>
      {canNotify && (
        <button type="button" className="list-row review-intro-ping" role="switch" aria-checked={ping} onClick={() => setPing(!ping)}>
          <Bell size={18} aria-hidden="true" />
          <span className="name">Notify me when it's ready<span className="sub">{phone === "ask" ? "Your phone will ask to allow notifications." : "On this phone and any other that allows them."}</span></span>
          <span className="switch" aria-hidden="true" />
        </button>
      )}
      <button type="button" className="btn btn-ink" onClick={keep}>Keep it on</button>
      <button type="button" className="btn-quiet" onClick={() => onSave({ ...r, notify: ping, on: false, intro: true })}>Turn it off</button>
      <p className="small muted review-intro-note">You can change this any time in Settings.</p>
    </Sheet>
  );
}

/** Saved reviews, newest first: this phone's copies at once, then the account's list. null while there's nothing to show yet. */
export function useReviews(limit = 26) {
  const [rows, setRows] = useState(() => { const c = cachedReviews(limit); return c.length ? c : null; });
  useEffect(() => {
    let alive = true;
    listReviews(limit).then((r) => { if (alive) setRows(r); }).catch(() => { if (alive) setRows((cur) => cur || []); });
    return () => { alive = false; };
  }, [limit]);
  return rows;
}

/** Reviews as rows, each opening its cards. */
export function ReviewList({ rows }) {
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

/** Every saved week in review (Settings › Past reviews, and See all on Progress). */
export function PastReviewsSheet({ onClose }) {
  const rows = useReviews();
  return (
    <Sheet title="Past reviews" sub="Every week in review, newest first." onClose={onClose} labelledBy="reviews-title">
      <ReviewList rows={rows} />
      {rows === null && <p className="note-box">Loading…</p>}
      {rows?.length === 0 && <p className="note-box">No reviews yet. Your first one is released on your release day, once you've logged a workout or some food that week.</p>}
    </Sheet>
  );
}
