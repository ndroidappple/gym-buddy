import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, MessageCircle, Trophy, ThumbsUp, Wrench, ArrowRight } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import Coach from "./Coach.jsx";
import { COACHES } from "../data/coaches.js";
import { useTheme } from "../lib/theme.js";
import { reducedMotion } from "../lib/motion.js";
import { KINDS, freshWalk, requestWalk } from "../lib/walkthrough.js";

/* The coach's walkthrough of a workout, on its recap. The coach sits in a card pinned to the bottom of
   the screen with one point at a time; each step scrolls the recap to the part it's about and outlines
   it in the workout day's color. Nothing is dimmed or blocked: the lifter can still scroll and read
   around it. Written once (requestWalk) and kept on the workout, so replaying it is instant. */

export const KIND_ICONS = { overall: Trophy, good: ThumbsUp, improve: Wrench, next: ArrowRight };

const WAIT = ["Going over every set…", "Checking your rests…", "Comparing with last time…", "Writing it up…"];
const WAIT_HEART = ["Going over every set…", "Reading your heart rate…", "Comparing with last time…", "Writing it up…"];

/** Where a step points: its place on the recap, or the nearest one that's showing. */
export function placeFor(target) {
  const q = (id) => document.querySelector(`[data-walk="${CSS.escape(id)}"]`);
  return q(target) || (/^(chart|zones|hr:)/.test(target) && q("heart")) || q("overview");
}

export default function Walkthrough({ session, sessions, program, prefs, head = "tank", notes, heart, day, onSave, onStep, onAsk, onClose }) {
  const theme = useTheme();
  const [walk, setWalk] = useState(() => freshWalk(session));
  const [status, setStatus] = useState(walk ? "ready" : "writing"); // writing | ready | error
  const [error, setError] = useState(null);
  const [idx, setIdx] = useState(0);
  const [wait, setWait] = useState(0);
  const card = useRef(null);
  const next = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const asking = useRef(null);
  const write = () => {
    asking.current?.abort();
    const ctl = (asking.current = new AbortController());
    setStatus("writing"); setError(null);
    requestWalk({ coach: head, session, sessions, program, profile: prefs.profile, notes, heart, signal: ctl.signal })
      .then((w) => { if (!alive.current || ctl.signal.aborted) return; setWalk(w); setIdx(0); setStatus("ready"); onSave(w); })
      .catch((e) => { if (alive.current && !ctl.signal.aborted) { setError(e.kind || "busy"); setStatus("error"); } });
  };
  // Closing while the coach writes stops asking.
  useEffect(() => { if (!walk) write(); return () => asking.current?.abort(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The waiting lines turn over while the coach writes.
  useEffect(() => {
    if (status !== "writing") return;
    const id = setInterval(() => setWait((i) => i + 1), 2400);
    return () => clearInterval(id);
  }, [status]);

  const steps = walk?.steps || [];
  const step = status === "ready" ? steps[idx] : null;
  const last = idx === steps.length - 1;

  // The screen leaves room under the recap for the card, so the last part can scroll above it.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--walk-h", `${el.offsetHeight}px`));
    ro.observe(el);
    root.classList.add("walking");
    return () => { ro.disconnect(); root.classList.remove("walking"); root.style.removeProperty("--walk-h"); };
  }, []);

  // The step's place: outlined, and scrolled to the middle of the screen above the card.
  useEffect(() => {
    onStep?.(step || null);
    if (!step) return;
    const el = placeFor(step.target);
    if (!el) return;
    el.classList.add("walk-on");
    const frame = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const top = 16 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-t")) || 0);
      const room = window.innerHeight - (card.current?.offsetHeight || 0) - 16 - top;
      const y = window.scrollY + r.top - top - (r.height < room ? (room - r.height) / 2 : 8);
      window.scrollTo({ top: Math.max(0, y), behavior: reducedMotion() ? "auto" : "smooth" });
    });
    return () => { cancelAnimationFrame(frame); el.classList.remove("walk-on"); };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onStep?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (status === "ready") next.current?.focus({ preventScroll: true }); }, [status]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") onClose();
      else if (status === "ready" && e.key === "ArrowRight" && !last && !e.target.closest?.("svg, input, textarea")) setIdx((i) => i + 1);
      else if (status === "ready" && e.key === "ArrowLeft" && idx > 0 && !e.target.closest?.("svg, input, textarea")) setIdx((i) => i - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [status, idx, last, onClose]);

  const coach = COACHES[head] || COACHES.tank;
  const Icon = step ? KIND_ICONS[step.kind] : null;
  const lines = heart ? WAIT_HEART : WAIT;
  return createPortal((
    <section ref={card} className="walk-card" data-day={day} style={{ "--c": coach.color }} role="region" aria-label={`${coach.name}'s walkthrough of this workout`}>
      <div className="walk-top">
        <Coach id={head} size={40} mood={status === "writing" ? "idle" : step?.kind === "improve" ? "idle" : "proud"} />
        <span className="walk-who">{coach.name}'s take</span>
        {status === "ready" && <span className="walk-count mono small muted">{idx + 1} of {steps.length}</span>}
        <button type="button" className="icon-btn walk-x" onClick={onClose} aria-label="Close the walkthrough"><X size={18} /></button>
      </div>

      {status === "writing" && (
        <div className="walk-body walk-wait" aria-live="polite">
          <ThinkingOrb state="breathing" size={20} theme={theme} aria-hidden="true" />
          <span>{lines[wait % lines.length]}</span>
        </div>
      )}

      {status === "error" && (
        <div className="walk-body">
          <p className="walk-text">
            {error === "offline" ? "You're offline. I'll walk you through it once you're back online."
              : error === "rate" ? "Too many people asking me at once. Give it a minute and try again."
              : "I couldn't put my take together just now."}
          </p>
          <div className="walk-nav"><span className="spacer" /><button type="button" className="btn btn-ink walk-btn" onClick={write}>Try again</button></div>
        </div>
      )}

      {step && (
        <>
          <div className="walk-body" aria-live="polite" key={idx}>
            <span className={`walk-kind k-${step.kind}`}><Icon size={13} strokeWidth={2.8} aria-hidden="true" />{KINDS[step.kind]}</span>
            <p className="walk-title">{step.title}</p>
            <p className="walk-text">{step.text}</p>
          </div>
          <div className="walk-nav">
            <button type="button" className="icon-btn boxed" onClick={() => setIdx((i) => i - 1)} disabled={idx === 0} aria-label="Previous point"><ChevronLeft size={20} /></button>
            <span className="walk-dots" aria-hidden="true">{steps.map((s, i) => <i key={i} className={i === idx ? "on" : undefined} />)}</span>
            {last
              ? (
                <>
                  <button type="button" className="ask-btn walk-ask" onClick={onAsk}><MessageCircle size={16} strokeWidth={2.6} aria-hidden="true" />Ask</button>
                  <button ref={next} type="button" className="btn btn-ink walk-btn" onClick={onClose}>Done</button>
                </>
              )
              : <button ref={next} type="button" className="btn btn-ink walk-btn" onClick={() => setIdx((i) => i + 1)}>Next<ChevronRight size={18} aria-hidden="true" /></button>}
          </div>
        </>
      )}
    </section>
  ), document.body);
}

/** The walkthrough's points about one part of the recap, kept under it once the walkthrough's over. */
export function WalkNotes({ walk, match, head = "tank" }) {
  const steps = walk?.steps?.filter((s) => match(s.target)) || [];
  if (!steps.length) return null;
  const coach = COACHES[head] || COACHES.tank;
  return (
    <div className="walk-notes" style={{ "--c": coach.color }}>
      {steps.map((s, i) => {
        const Icon = KIND_ICONS[s.kind];
        return (
          <details key={i} className="walk-note">
            <summary>
              <span className={`walk-kind k-${s.kind}`}><Icon size={12} strokeWidth={2.8} aria-hidden="true" />{KINDS[s.kind]}</span>
              <span className="walk-note-title">{s.title}</span>
              <ChevronRight className="walk-note-chev" size={16} aria-hidden="true" />
            </summary>
            <p>{s.text} <span className="muted">— {coach.name}</span></p>
          </details>
        );
      })}
    </div>
  );
}
