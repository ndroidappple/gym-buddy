import React from "react";
import { Sheet } from "./ui.jsx";
import Coach from "./Coach.jsx";
import { COACH_ORDER } from "../data/coaches.js";

/** First login: an invitation, not a gate. Tank sets up goals and days; the crew shapes the lifts. */
export default function Welcome({ name, onStart, onLater }) {
  return (
    <Sheet title={name ? `Welcome, ${name}` : "Welcome to GymBuddy"} sub="Your coaches will set up your plan with you. About 2 minutes." onClose={onLater} labelledBy="welcome-title">
      <div className="sheet-body welcome">
        <div className="welcome-crew" aria-hidden="true">
          {COACH_ORDER.map((id, i) => <span key={id} className="coach-chip" style={{ "--i": i }}><Coach id={id} size={40} still badge decorative /></span>)}
        </div>
        <p>Tank asks about your goals, weight and training days. Then each coach lets you keep, drop or add their lifts. Skip anything; you can always come back.</p>
        <button type="button" className="btn btn-day" data-day="push" onClick={onStart}>Set up with Tank</button>
        <button type="button" className="btn btn-ghost" onClick={onLater}>Later</button>
      </div>
    </Sheet>
  );
}
