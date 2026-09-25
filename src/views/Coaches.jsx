import React, { useMemo, useState } from "react";
import { InfoButton } from "../components/ui.jsx";
import { ChevronLeft } from "lucide-react";
import { DAYS } from "../data/program.js";
import { COACHES, COACH_ORDER, coachFor } from "../data/coaches.js";
import { plural } from "../lib/util.js";
import Coach from "../components/Coach.jsx";
import CoachChat from "../components/CoachChat.jsx";

export default function Coaches({ program, sessions, weighins, back }) {
  const [chat, setChat] = useState(null);
  const counts = useMemo(() => {
    const m = {};
    new Set(DAYS.flatMap((d) => program[d].exercises.map((e) => e.n))).forEach((n) => { const id = coachFor(n); m[id] = (m[id] || 0) + 1; });
    return m;
  }, [program]);

  return (
    <main className="screen">
      <header className="top">
        <button className="icon-btn boxed" onClick={() => back("#/today")} aria-label="Back"><ChevronLeft size={20} /></button>
        <span className="spacer" />
        <InfoButton screen="coaches" />
      </header>
      <div className="body" style={{ gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 className="page-title">Meet your coaches</h1>
          <p className="muted" style={{ fontWeight: 600, fontSize: 15 }}>Six coaches, one per training area. They call your cues, cheer your sets and lose it when you hit a PR. Tap one to ask a question.</p>
        </div>
        <div className="coach-grid">
          {COACH_ORDER.map((id) => (
            <button key={id} className="coach-card" onClick={() => setChat(id)} aria-label={`Ask ${COACHES[id].name}, ${COACHES[id].group} coach`}>
              <Coach id={id} size={72} decorative />
              <b>{COACHES[id].name}</b>
              <span>{COACHES[id].group}</span>
              <i>{counts[id] ? `${plural(counts[id], "lift")} in your program` : "No lifts yet"}</i>
            </button>
          ))}
        </div>
      </div>
      {chat && <CoachChat coach={chat} sessions={sessions} program={program} weighins={weighins} onClose={() => setChat(null)} />}
    </main>
  );
}
