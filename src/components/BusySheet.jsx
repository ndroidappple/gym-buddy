import React from "react";
import { ArrowRight, Repeat, Clock } from "lucide-react";
import { Sheet } from "./ui.jsx";

/* Machine busy: do something else now (a different muscle first, so this one stays fresh), swap the
   lift for an equivalent today, or just come back to it later. The day's anchor lift gets a nudge
   to wait a few minutes first: it's the best measure of strength, so it's best kept first. */
export default function BusySheet({ lift, isAnchor, started, doNow, swaps, onDoNow, onSwap, onLater, onClose }) {
  return (
    <Sheet title={`${lift} busy?`} sub={isAnchor ? "This is your main lift: worth a few minutes' wait if you can." : "Do something else now and come back to it."}
      onClose={onClose} labelledBy="busy-title">
      {doNow.length > 0 && (
        <section className="section">
          <h3 className="lbl">Do now instead</h3>
          <div className="list">
            {doNow.map((x) => (
              <button key={x.n} type="button" className="list-row" onClick={() => onDoNow(x.n)}>
                <span className="name">{x.n}<span className="sub detail">{x.why}</span></span>
                <ArrowRight size={18} aria-hidden="true" className="muted" />
              </button>
            ))}
          </div>
        </section>
      )}
      {!started && swaps.length > 0 && (
        <section className="section">
          <h3 className="lbl">Or swap it for today</h3>
          <div className="list">
            {swaps.map((x) => (
              <button key={x.n} type="button" className="list-row" onClick={() => onSwap(x)}>
                <span className="name">{x.n}<span className="sub detail">{x.samePattern ? "Same movement" : "Same muscle"}{x.logged ? " · you've done this before" : ""}</span></span>
                <Repeat size={17} aria-hidden="true" className="muted" />
              </button>
            ))}
          </div>
          <p className="small muted detail">A swap is tracked as its own lift, so both keep clean histories.</p>
        </section>
      )}
      <button type="button" className="btn btn-ghost" onClick={onLater}><Clock size={17} aria-hidden="true" /> {doNow.length ? "Just move it to later" : "Wait for it"}</button>
    </Sheet>
  );
}
