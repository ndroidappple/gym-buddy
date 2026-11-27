import React, { useState } from "react";
import { effortWord } from "../lib/outside.js";

/** How hard a workout felt, 1-10 (Google Health asks the same, but keeps the answer to itself).
    Optional: it reads "How hard was it?" until rated, and can be changed any time. Saves when the
    finger lifts, so a tap without a drag rates it too. */
export default function Effort({ value, onSave, className = "effort" }) {
  const [effort, setEffort] = useState(value || 0);
  const word = effortWord(effort);
  const save = (v) => { const n = Number(v); setEffort(n); if (n !== value) onSave(n); };
  return (
    <label className={className}>
      <span className="effort-q">{word ? <><b>{effort}</b> · {word}</> : "How hard was it?"}</span>
      <input type="range" min="1" max="10" step="1" value={effort || 5} data-unset={effort ? undefined : ""}
        onChange={(e) => setEffort(Number(e.target.value))}
        onPointerUp={(e) => save(e.currentTarget.value)} onKeyUp={(e) => save(e.currentTarget.value)}
        aria-label="How hard was it, 1 to 10" aria-valuetext={word ? `${effort}, ${word}` : "Not rated"} />
    </label>
  );
}
