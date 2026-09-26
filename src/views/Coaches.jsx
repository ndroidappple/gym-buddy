import React, { useMemo, useState } from "react";
import { InfoButton } from "../components/ui.jsx";
import { ChevronLeft, Check } from "lucide-react";
import { activeDays } from "../data/program.js";
import { COACHES, COACH_ORDER, coachFor } from "../data/coaches.js";
import { plural } from "../lib/util.js";
import { coachesLeft, needsSetup } from "../lib/setup.js";
import Coach from "../components/Coach.jsx";
import CoachChat from "../components/CoachChat.jsx";
import SetupChat from "../components/SetupChat.jsx";


export default function Coaches({ program, sessions, weighins, prefs, name, back, onProgramChange, onSetupDone, openCoach }) {
  // { coach, ask? }: ask = a first question to send straight to the live chat.
  const [open, setOpen] = useState(() => (openCoach && COACHES[openCoach] ? { coach: openCoach, setup: needsSetup(prefs, openCoach) } : null));
  const counts = useMemo(() => {
    const m = {};
    new Set(activeDays(program).flatMap((d) => program[d].exercises.map((e) => e.n))).forEach((n) => { const id = coachFor(n); m[id] = (m[id] || 0) + 1; });
    return m;
  }, [program]);
  const left = coachesLeft(prefs.coachSetup);
  const nextUp = needsSetup(prefs, "tank") ? "tank" : left[0];
  // Decided when the chat opens, so a finished setup stays on screen until the lifter moves on.
  const setupOpen = open?.setup;
  const openChat = (o) => setOpen(o && { ...o, setup: !o.ask && needsSetup(prefs, o.coach) });

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
          <p className="muted" style={{ fontWeight: 500, fontSize: 15 }}>
            {left.length ? "Say hi to each coach to shape your plan. The gold ring shows who's next." : "Six coaches, one per training area. Tap one to ask a question or change your plan."}
          </p>
        </div>
        <div className="coach-grid">
          {COACH_ORDER.map((id) => {
            const fresh = needsSetup(prefs, id);
            return (
              <button key={id} className={"coach-card" + (id === nextUp ? " next-up" : "")} onClick={() => openChat({ coach: id })}
                aria-label={`${fresh ? "Meet" : "Ask"} ${COACHES[id].name}, ${COACHES[id].group} coach${fresh ? "" : ", set up"}${id === nextUp ? ", next up" : ""}`}>
                {/* One signal for setup progress: a check on every coach you've met. The gold ring points at the next. */}
                {!fresh && left.length > 0 && <span className="coach-done" aria-hidden="true"><Check size={14} strokeWidth={3.4} /></span>}
                <Coach id={id} size={72} decorative />
                <b>{COACHES[id].name}</b>
                <span>{COACHES[id].group}</span>
                <i>{counts[id] ? `${plural(counts[id], "lift")} in your program` : "No lifts yet"}</i>
              </button>
            );
          })}
        </div>
      </div>
      {setupOpen && (
        <SetupChat key={open.coach} coach={open.coach} program={program} profile={prefs.profile} name={name}
          onDone={onSetupDone} onClose={() => setOpen(null)} onNext={openChat} />
      )}
      {open && !setupOpen && (
        <CoachChat key={open.coach + (open.ask ? "-ask" : "")} coach={open.coach} starter={open.ask} sessions={sessions} program={program}
          weighins={weighins} profile={prefs.profile} phase={prefs.phase} onProgramChange={onProgramChange} onClose={() => setOpen(null)} />
      )}
    </main>
  );
}
