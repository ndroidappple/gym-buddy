import React, { useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Sheet } from "./ui.jsx";
import Coach from "./Coach.jsx";
import { COACHES, COACH_ORDER, VIBES } from "../data/coaches.js";
import { useReducedMotion } from "../lib/motion.js";

/** First login: an invitation, not a gate. The lifter picks a head coach, who sets up goals and days;
    the crew shapes the lifts. */
export default function Welcome({ name, onStart, onLater }) {
  const [head, setHead] = useState("tank");
  return (
    <Sheet title={name ? `Welcome, ${name}` : "Welcome to GymBuddy"} sub="Swipe to pick your head coach." onClose={onLater} labelledBy="welcome-title">
      <div className="welcome">
        <HeadPicker value={head} onChange={setHead} />
        <p>Your head coach is who you talk to about training and food. The rest of the crew coach their lifts in the gym. About 2 minutes to set up.</p>
        <button type="button" className="btn btn-day" data-day="push" onClick={() => onStart(head)}>Set up with {COACHES[head].name}</button>
        <button type="button" className="btn btn-ghost" onClick={onLater}>Later</button>
      </div>
    </Sheet>
  );
}

/** The six coaches, one large slide each, swiped through like cards. The slide in the middle is the
    pick: `onChange` follows the swipe. The neighbors peek in at the sides so it reads as swipeable.
    Also used in Settings to switch. */
export function HeadPicker({ value, onChange }) {
  const track = useRef(null);
  const reduced = useReducedMotion();
  const at = Math.max(0, COACH_ORDER.indexOf(value));
  const width = () => track.current?.firstElementChild?.offsetWidth || 1;
  // Start on the current pick, without animating there.
  useLayoutEffect(() => { if (track.current) track.current.scrollLeft = at * width(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The slide whose center is in the middle: the track pads both sides so slide n centers at n × width.
  const onScroll = () => {
    const id = COACH_ORDER[Math.round(track.current.scrollLeft / width())];
    if (id && id !== value) onChange(id);
  };
  const go = (n) => {
    const i = Math.min(COACH_ORDER.length - 1, Math.max(0, n));
    track.current?.scrollTo({ left: i * width(), behavior: reduced ? "auto" : "smooth" });
  };
  const onKey = (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(at + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(at - 1); }
  };

  return (
    <div className="head-pick" role="group" aria-roledescription="carousel" aria-label="Head coach">
      <div className="head-pick-track" ref={track} onScroll={onScroll} onKeyDown={onKey} tabIndex={0} aria-label="Swipe or use the arrow keys to choose">
        {COACH_ORDER.map((id, n) => (
          <section key={id} className={"head-pick-slide" + (id === value ? " on" : "")} style={{ "--c": COACHES[id].color }}
            aria-roledescription="slide" aria-label={`${n + 1} of ${COACH_ORDER.length}: ${COACHES[id].name}`} aria-current={id === value || undefined}
            onClick={() => id !== value && go(n)}>
            <div className="head-pick-stage">
              <Coach id={id} size={176} mood={id === value ? "hyped" : "idle"} still={id !== value} decorative />
            </div>
            <b>{COACHES[id].name}</b>
            <span className="head-pick-group">Also coaches {COACHES[id].group.toLowerCase()}</span>
            <p>{VIBES[id]}</p>
          </section>
        ))}
      </div>
      <div className="head-pick-nav">
        <button type="button" className="icon-btn" onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous coach"><ChevronLeft size={22} strokeWidth={2.6} /></button>
        <div className="head-pick-dots">
          {COACH_ORDER.map((id, n) => (
            <button key={id} type="button" className={n === at ? "on" : ""} style={{ "--c": COACHES[id].color }} onClick={() => go(n)} aria-label={`Show ${COACHES[id].name}`} aria-pressed={n === at} />
          ))}
        </div>
        <button type="button" className="icon-btn" onClick={() => go(at + 1)} disabled={at === COACH_ORDER.length - 1} aria-label="Next coach"><ChevronRight size={22} strokeWidth={2.6} /></button>
      </div>
    </div>
  );
}
