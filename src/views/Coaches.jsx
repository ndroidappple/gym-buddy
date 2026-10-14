import React, { useMemo, useState } from "react";
import { InfoButton } from "../components/ui.jsx";
import { ChevronLeft, Check } from "lucide-react";
import { activeDays } from "../data/program.js";
import { COACHES, COACH_ORDER, coachFor } from "../data/coaches.js";
import { plural } from "../lib/util.js";
import { href } from "../lib/router.js";
import { coachesLeft, needsSetup } from "../lib/setup.js";
import Coach from "../components/Coach.jsx";
import CoachChat from "../components/CoachChat.jsx";
import SetupChat from "../components/SetupChat.jsx";

/* Until setup's done, the crew to meet, one per training area, the head coach first. After that,
   this is the conversation with the head coach; the crew coach their lifts in the gym. */
export default function Coaches({ program, sessions, weighins, prefs, name, go, back, nutrition, head, coachChat, onProgramChange, onSetupDone, onSetupProgress, openCoach, openMode }) {
  const met = !COACH_ORDER.some((id) => needsSetup(prefs, id));
  // { coach, setup?, importOnly? }: importOnly = the head coach's bring-in-your-program steps, opened from Settings.
  const [open, setOpen] = useState(() => {
    if (openMode === "import") return { coach: head, setup: true, importOnly: true };
    if (!openCoach || !COACHES[openCoach] || !needsSetup(prefs, openCoach)) return null;
    return { coach: openCoach, setup: true };
  });
  const counts = useMemo(() => {
    const m = {};
    new Set(activeDays(program).flatMap((d) => program[d].exercises.map((e) => e.n))).forEach((n) => { const id = coachFor(n); m[id] = (m[id] || 0) + 1; });
    return m;
  }, [program]);
  const left = coachesLeft(prefs.coachSetup);
  const nextUp = needsSetup(prefs, head) ? head : left[0];
  // Tapping a coach you've already met during setup goes to the head coach conversation instead.
  const openChat = (o) => setOpen(o && { ...o, setup: needsSetup(prefs, o.coach) });
  // Who's still to meet after the open coach, by who's actually unmet (not just list order).
  const after = open ? COACH_ORDER.filter((id) => id !== open.coach && needsSetup(prefs, id)) : [];
  // Decided when the chat opens, so a finished setup stays on screen until the lifter moves on.
  const setupOpen = open?.setup;
  const talking = !setupOpen && (met || open);
  const close = () => (met ? back("#/today") : setOpen(null));

  return (
    <main className="screen">
      <header className="top">
        <button className="icon-btn boxed" onClick={() => back("#/today")} aria-label="Back"><ChevronLeft size={20} /></button>
        <span className="spacer" />
        <InfoButton screen="coaches" />
      </header>
      {!met && (
        <div className="body" style={{ gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h1 className="page-title">Meet your coaches</h1>
            <p className="muted" style={{ fontWeight: 500, fontSize: 15 }}>
              {COACHES[head].name} is your head coach. Say hi to each of the crew to shape your plan. The gold ring shows who's next.
            </p>
          </div>
          <div className="coach-grid" data-help="coaches">
            {COACH_ORDER.map((id) => {
              const fresh = needsSetup(prefs, id);
              return (
                <button key={id} className={"coach-card" + (id === nextUp ? " next-up" : "")} onClick={() => openChat({ coach: id })}
                  aria-label={`${fresh ? "Meet" : "Talk to"} ${COACHES[id].name}, ${id === head ? "head coach" : `${COACHES[id].group} coach`}${fresh ? "" : ", set up"}${id === nextUp ? ", next up" : ""}`}>
                  {/* One signal for setup progress: a check on every coach you've met. The gold ring points at the next. */}
                  {!fresh && <span className="coach-done" aria-hidden="true"><Check size={14} strokeWidth={3.4} /></span>}
                  <Coach id={id} size={72} decorative />
                  <b>{COACHES[id].name}</b>
                  <span>{id === head ? `Head coach · ${COACHES[id].group}` : COACHES[id].group}</span>
                  <i>{counts[id] ? `${plural(counts[id], "lift")} in your program` : "No lifts yet"}</i>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {setupOpen && (
        <SetupChat key={open.coach + (open.importOnly ? "-import" : "")} coach={open.coach} head={head} importOnly={open.importOnly} onImport={onProgramChange} program={program} profile={prefs.profile} name={name}
          next={after[0] || null} left={after.length}
          onSave={onSetupProgress} onDone={onSetupDone} onClose={() => (open.importOnly ? back("#/settings") : met ? back("#/today") : setOpen(null))} onNext={openChat}
          onFinish={() => { setOpen(null); go(href("today")); }} />
      )}
      {talking && (
        <CoachChat coach={head} head={head} name={name} {...coachChat} sessions={sessions} program={program} weighins={weighins}
          profile={prefs.profile} phase={prefs.phase} nutrition={nutrition} onProgramChange={onProgramChange} onClose={close} />
      )}
    </main>
  );
}
