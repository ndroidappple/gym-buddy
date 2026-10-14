import React, { useState } from "react";
import { Sheet } from "./ui.jsx";
import Coach from "./Coach.jsx";
import { COACHES, COACH_ORDER, VIBES } from "../data/coaches.js";

/** First login: an invitation, not a gate. The lifter picks a head coach, who sets up goals and days;
    the crew shapes the lifts. */
export default function Welcome({ name, onStart, onLater }) {
  const [head, setHead] = useState("tank");
  return (
    <Sheet title={name ? `Welcome, ${name}` : "Welcome to GymBuddy"} sub="Pick your head coach. They'll set up your plan with you." onClose={onLater} labelledBy="welcome-title">
      <div className="sheet-body welcome">
        <HeadPicker value={head} onChange={setHead} />
        <p>{COACHES[head].name} is who you'll talk to about your training and food. The rest of the crew coaches you through their lifts in the gym. About 2 minutes to set up; skip anything.</p>
        <button type="button" className="btn btn-day" data-day="push" onClick={() => onStart(head)}>Set up with {COACHES[head].name}</button>
        <button type="button" className="btn btn-ghost" onClick={onLater}>Later</button>
      </div>
    </Sheet>
  );
}

/** The six coaches as choices, each with how they coach. Also used in Settings to switch. */
export function HeadPicker({ value, onChange }) {
  return (
    <div className="head-pick" role="radiogroup" aria-label="Head coach">
      {COACH_ORDER.map((id, i) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className="head-pick-card" style={{ "--c": COACHES[id].color, "--i": i }} onClick={() => onChange(id)}>
          <Coach id={id} size={44} mood={value === id ? "hyped" : "idle"} still={value !== id} decorative />
          <b>{COACHES[id].name}</b>
          <small>{VIBES[id]}</small>
        </button>
      ))}
    </div>
  );
}
