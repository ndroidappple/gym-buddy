import React from "react";
import { ChevronRight } from "lucide-react";
import Coach from "./Coach.jsx";
import { COACHES, COACH_ORDER, headCoach } from "../data/coaches.js";
import { href } from "../lib/router.js";
import { needsSetup, nextCoachToMeet } from "../lib/setup.js";

/* Setup is never required, just encouraged. `glow` gives it the gold rim when it should lead
   (before the first workout); otherwise it sits quietly until every coach has been met. */
export default function SetupCard({ prefs, glow, lead }) {
  const next = nextCoachToMeet(prefs);
  if (!next) return null;
  const met = COACH_ORDER.filter((id) => !needsSetup(prefs, id)).length;
  const tank = next === headCoach(prefs); // the head coach sets up the plan
  return (
    <a className={"card setup-card" + (glow ? " pr-rim" : "")} href={href("coaches", next)}>
      <span className="coach-chip"><Coach id={next} size={36} still badge decorative /></span>
      <span className="setup-card-text">
        <b>{lead || (tank ? `Set up your plan with ${COACHES[next].name}` : `Meet ${COACHES[next].name} next`)}</b>
        <span>{tank ? "Goals, weight and training days. About a minute." : `${met} of ${COACH_ORDER.length} coaches done. Pick your ${COACHES[next].group.toLowerCase()} lifts.`}</span>
      </span>
      <ChevronRight size={20} strokeWidth={2.6} aria-hidden="true" />
    </a>
  );
}
