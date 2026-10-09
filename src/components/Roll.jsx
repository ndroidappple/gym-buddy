import { useRef } from "react";
import { useReducedMotion } from "../lib/motion.js";

const at = (s, p) => s[s.length - 1 - p]; // character p places from the right
const amount = (s) => Number(String(s).replace(/[^\d.]/g, "")) || 0;

/**
 * Text that rolls when it changes: each digit that changed slides out while its replacement slides
 * in from the other side (up when the number grows, down when it shrinks), and the digits that
 * stayed the same hold still. Places count from the right, so 99 → 100 rolls the last two and
 * adds the 1. Nothing moves on first render or with reduced motion. `dir` (1 up, -1 down) overrides
 * the direction, for text whose digits don't read as one number.
 */
export default function Roll({ value, dir }) {
  const text = String(value);
  const reduced = useReducedMotion();
  const s = useRef(null);
  if (!s.current) s.current = { text, prev: text, gen: 0, changed: [], dir: 1 };
  const r = s.current;
  if (text !== r.text) {
    r.gen++;
    r.prev = r.text;
    r.dir = dir ?? (amount(text) >= amount(r.text) ? 1 : -1);
    for (let p = 0; p < Math.max(text.length, r.prev.length); p++) if (at(text, p) !== at(r.prev, p)) r.changed[p] = r.gen;
    r.text = text;
  }
  if (reduced) return text;
  return (
    <span className="roll">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {Array.from(text, (ch, i) => {
          const p = text.length - 1 - i;
          const g = r.changed[p] || 0;
          const now = g > 0 && g === r.gen; // changed in the latest change: still on its way in
          const old = now ? at(r.prev, p) : undefined;
          return (
            <span key={p} className="roll-d" style={now ? { "--dir": r.dir } : undefined}>
              <span key={g} className={now ? "roll-in" : undefined}>{ch}</span>
              {old && <span key={`out${g}`} className="roll-out">{old}</span>}
            </span>
          );
        })}
      </span>
    </span>
  );
}
