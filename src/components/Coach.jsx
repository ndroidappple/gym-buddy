import React, { useEffect, useId, useRef, useState } from "react";
import { COACHES } from "../data/coaches.js";

/* Flat 2D coaches, drawn in SVG. Every feature is a separate layer that eases between moods:
   brows tilt, eyelids drop, the mouth swaps with a pop, arms bend at the elbow to flex.
   Eyes follow your finger, each coach blinks on its own clock, and a tap gets a reaction. */

export const MOODS = {
  idle: { title: "Ready", line: "Let's get to work." },
  focused: { title: "Locked in", line: "Eyes on the bar. Nothing else." },
  hyped: { title: "Fired up", line: "THAT is how it's done!" },
  resting: { title: "Recovering", line: "Breathe. Next set is yours." },
  pr: { title: "Beast mode", line: "NEW RECORD! Somebody call the gym!" },
  encourage: { title: "Shake it off", line: "Off set. You still showed up. Next one." },
  sleepy: { title: "Missing you", line: "Zzz… the iron misses you." },
  proud: { title: "Proud", line: "Work done. Go eat something big." },
};
export const MOOD_ORDER = ["idle", "focused", "hyped", "resting", "pr", "encourage", "sleepy", "proud"];

/* Face and pose per mood. lid: 0 open, 1 closed; lidTilt slants the lids down toward the nose (anger). eyes: "open" | "happy" (∩) | "shut" (∪). */
const FACE = {
  idle: { brow: [-3, 4], lid: 0.08, eyes: "open", mouth: "smile", arms: "down", anim: "breathe" },
  focused: { brow: [4, 26], lid: 0.3, lidTilt: 22, pupil: 4.2, eyes: "open", mouth: "grit", arms: "down", anim: "tense", fx: "vein", fixed: true },
  hyped: { brow: [-3, 6], lid: 0, eyes: "happy", mouth: "grin", arms: "flex", anim: "hop", fx: "lines", blush: true },
  resting: { brow: [-1, 0], lid: 1, eyes: "shut", mouth: "o", arms: "down", anim: "slow", fx: "sweat" },
  pr: { brow: [-3, 10], lid: 0, eyes: "open", big: true, mouth: "roar", arms: "flex", anim: "jump", fx: "stars", blush: true, fixed: true },
  encourage: { brow: [-3, 14], lid: 0.2, eyes: "open", mouth: "wobble", arms: "down", anim: "sway", down: true },
  sleepy: { brow: [1, 6], lid: 1, eyes: "flat", mouth: "tiny", arms: "down", anim: "sink", fx: "zzz" },
  proud: { brow: [-2, -4], lid: 0, eyes: "happy", mouth: "smirk", arms: "flex", anim: "nod", fx: "medal", blush: true },
};

const INK = "#1C1A22";
function tone(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const to = t > 0 ? 255 : 0, k = Math.abs(t);
  return `rgb(${[n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * k)).join(",")})`;
}

/* Body outlines in a 100×100 box. Composite outlines are flat lists of shapes (no <g>), because the same
   outline is reused inside <clipPath>, which only accepts plain shapes. */
const CIRCLES = {
  clover: [[50, 28, 23], [72, 50, 23], [50, 72, 23], [28, 50, 23], [50, 50, 26]],
  flower: [[50, 24, 18], [72.5, 37, 18], [72.5, 63, 18], [50, 76, 18], [27.5, 63, 18], [27.5, 37, 18], [50, 50, 28]],
};
function Shape({ type, ...p }) {
  if (CIRCLES[type]) return <>{CIRCLES[type].map(([cx, cy, r]) => <circle key={`${cx},${cy}`} {...p} cx={cx} cy={cy} r={r} />)}</>;
  switch (type) {
    case "ghost": return <path {...p} d="M17 52 A33 33 0 0 1 83 52 V84 Q83 90 77 87 L72 84 Q66 81 61 86 Q55 91 50 86 Q45 81 39 86 Q34 91 28 86 L23 87 Q17 90 17 84 Z" />;
    case "star": return <path {...p} strokeLinejoin="round" strokeWidth="9" d="M50 15 L61.2 37.4 L86 41 L68 58.6 L72.3 83.3 L50 71.6 L27.7 83.3 L32 58.6 L14 41 L38.8 37.4 Z" />;
    case "hexagon": return <path {...p} strokeLinejoin="round" strokeWidth="10" d="M50 15 L81 32.5 L81 67.5 L50 85 L19 67.5 L19 32.5 Z" />;
    case "mech": return <rect {...p} x="15" y="22" width="70" height="64" rx="18" />;
    case "heart": return <path {...p} strokeLinejoin="round" strokeWidth="6" d="M50 90 C24 74 13 60 13 43 C13 27 27 18 39 20 C45 21 48 25 50 29 C52 25 55 21 61 20 C73 18 87 27 87 43 C87 60 76 74 50 90 Z" />;
    case "circle": return <circle {...p} cx="50" cy="52" r="36" />;
    default: return <rect {...p} x="15" y="16" width="70" height="70" rx="22" />;
  }
}

/* Arms sit behind the body: each shoulder is tucked just inside the outline, so the arms grow out of the
   sides and never cover the face. An arm is built in its own frame (shoulder at 0,0, hanging down +y, bicep
   on -x so it faces up when flexed) from four bold shapes, each lit like the body: a shade base with the lit
   color nudged toward the light and clipped, so the dark edge separates it from a body of the same color. */
const ANCHOR = { clover: [13, 62], ghost: [21, 62], star: [21, 45], mech: [19, 62], square: [19, 60], heart: [18, 54] };
// [shoulder, elbow] in degrees. Flexed: upper arm out to the side, forearm up. Down: elbows out, fists at the hips.
const POSE = { down: [40, -58], flex: [100, 96] };
// Boulder's arms come out of the star's side points, which sit higher, so its angles differ.
const POSE_BODY = { star: { down: [28, -40], flex: [96, 98] } };
// Each coach's wrist gear echoes their headgear; Piston gets steel arms with a red elbow bolt, Brick square fists.
const KIT = {
  tank: { band: "#FF5E57", stripe: "#fff" },
  wings: { band: "#1FB5A8", stripe: "#128A80" },
  boulder: { band: "#4C8DFF", stripe: "#fff" },
  piston: { steel: true, band: "#7C8691", bolt: "#FF5E57" },
  brick: { band: "#F4F1EA", stripe: "#FF5E57", stripe2: "#23408E", block: true },
  dash: { band: INK, stripe: "#FF6F91" },
};
// Arm geometry at 70% muscle (BULK 0-1): upper arm U and forearm F long, plus how far the bicep, tricep and forearm bulge.
const U = 20, F = 15, BULK = 0.7;
const BI = 4 + 4.5 * BULK, TRI = 1.2 + 1.6 * BULK, SW = 2.2 + 2.4 * BULK;
const HW0 = 6.5, HE = 4.4 + 0.6 * BULK, HW = 3.6 + 0.4 * BULK;
const UPPER = `M${-HW0} 0 C${-HW0 - BI} ${U * 0.28} ${-HE - BI * 1.15} ${U * 0.78} ${-HE} ${U} A${HE} ${HE} 0 0 0 ${HE} ${U} C${HE + TRI} ${U * 0.7} ${HW0 + TRI} ${U * 0.3} ${HW0} 0 Z`;
const FORE = `M${-HE} 0 C${-HE - SW} ${F * 0.3} ${-HW - SW * 0.25} ${F * 0.72} ${-HW} ${F} L${HW} ${F} C${HW + SW * 0.3} ${F * 0.62} ${HE + SW * 0.55} ${F * 0.25} ${HE} 0 Z`;
const FORE_STEEL = `M${-HE + 0.6} 0 L${-HW} ${F} L${HW} ${F} L${HE - 0.6} 0 Z`;
const FW = 12 + 2.4 * BULK, FH = 11 + 1.4 * BULK;

/* A shape in shade, then again in the lit color nudged up-left and clipped to itself. */
function Lit({ id, color, shade, ...shape }) {
  const El = shape.d ? "path" : "rect";
  return (
    <>
      <defs><clipPath id={id}><El {...shape} /></clipPath></defs>
      <El {...shape} fill={shade} />
      <g clipPath={`url(#${id})`}><El {...shape} fill={color} transform="translate(-1.3 -1.6)" /></g>
    </>
  );
}

function Arm({ uid, side, pose, id, body, color, shade }) {
  const [ax, ay] = ANCHOR[body] || ANCHOR.square;
  const [shoulder, elbow] = (POSE_BODY[body] || POSE)[pose] || POSE.down;
  const kit = KIT[id] || {};
  const upC = kit.steel ? "#A9B2BC" : color, upS = kit.steel ? "#6B747E" : shade;
  const k = `${uid}${side > 0 ? "r" : "l"}`;
  const cuff = { x: -HW - 1.3, width: 2 * HW + 2.6 };
  return (
    <g transform={side > 0 ? "translate(100 0) scale(-1 1)" : undefined}>
      {/* Pivots are written into the transform (not transform-origin) so they stay right inside the rotated shoulder. */}
      <g className="cz-joint" style={{ transform: `translate(${ax}px, ${ay}px) rotate(${shoulder}deg)` }}>
        <g className="cz-joint" style={{ transform: `translate(0px, ${U}px) rotate(${elbow}deg)` }}>
          <Lit id={`${k}f`} d={kit.steel ? FORE_STEEL : FORE} color={upC} shade={upS} />
          {kit.steel && <path d={`M${-HE + 0.9} 4 H${HE - 0.9} M${-HW - 0.2} 9 H${HW + 0.2}`} stroke={upS} strokeWidth="1.2" />}
          <rect {...cuff} y={F - 4.2} height="4.4" rx="1.4" fill={kit.band} />
          {kit.stripe && <rect {...cuff} y={F - 3.2} height="0.9" fill={kit.stripe} />}
          {kit.stripe2 && <rect {...cuff} y={F - 1.6} height="0.9" fill={kit.stripe2} />}
          <Lit id={`${k}h`} x={-FW / 2} y={F - 1} width={FW} height={FH} rx={kit.block ? 2.4 : FH / 2.3} color={color} shade={shade} />
          <path d={`M${-FW / 2 + 2.6} ${F + FH * 0.42} Q-1 ${F + FH * 0.62} ${FW / 2 - 3.4} ${F + FH * 0.4}`} stroke={shade} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </g>
        <Lit id={`${k}u`} d={UPPER} color={upC} shade={upS} />
        {/* Where the arm meets the body it sits in the body's shadow. */}
        <path d={UPPER} fill={`url(#${uid}ao)`} />
        {kit.steel && <g><circle cx="0" cy={U} r="3.4" fill={kit.bolt} /><circle cx="-1" cy={U - 1} r="1" fill="#fff" opacity=".5" /></g>}
      </g>
    </g>
  );
}

/* Each coach's headgear is drawn to its own outline, so it sits on the head instead of floating across it. */
const SHINE = { fill: "#fff", opacity: 0.45 };

/* Each coach's brow, drawn for the left eye around its centre with P(dx, dy); negative dx is the outer
   end. `line` = stroke-only width, `square` = hard ends, `tilt` = resting angle, `dy` = height. */
const BROWS = {
  // Tank: a heavy slab, set low and a touch tough.
  tank: { tilt: -6, d: (P) => `M ${P(-10.5, -3.2)} L ${P(6.5, -1.8)} L ${P(6.5, 3.8)} L ${P(-10.5, 2.6)} Z` },
  // Wings: a swept wing, thick at the inside and tapering up and out like a feather.
  wings: { tilt: -7, dy: 1.6, d: (P) => `M ${P(7, -1.2)} Q ${P(-2, -2)} ${P(-10.5, -3.6)} Q ${P(-3, 1.6)} ${P(7, 2.6)} Z` },
  // Boulder: chunky rounded rocks with a lumpy top.
  boulder: { tilt: -3, dy: 1.2, d: (P) => `M ${P(-9, 1.8)} Q ${P(-10, -2)} ${P(-5.5, -2.6)} Q ${P(-2.5, -4.6)} ${P(1.5, -3.2)} Q ${P(5.5, -4.2)} ${P(7.8, -1.2)} Q ${P(9.4, 1.8)} ${P(5, 2.6)} L ${P(-5.5, 2.8)} Q ${P(-9, 3)} ${P(-9, 1.8)} Z` },
  // Piston: flat machined bars with square ends.
  piston: { square: true, d: (P) => `M ${P(-8.5, -1.6)} L ${P(6.5, -1.6)} L ${P(6.5, 1.8)} L ${P(-8.5, 1.8)} Z` },
  // Brick: two short, square blocks, like bricks.
  brick: { square: true, tilt: -3, d: (P) => `M ${P(-8.5, -2.6)} L ${P(5, -2.6)} L ${P(5, 2.8)} L ${P(-8.5, 2.8)} Z` },
  // Dash: short, sporty dashes set high.
  dash: { line: 5, dy: -2, tilt: 6, d: (P) => `M ${P(-5.5, 0.5)} L ${P(4.5, -1)}` },
};
function Gear({ coach }) {
  switch (coach.body) {
    case "clover": // Tank: red lifting sweatband on the top lobe, tails flapping off the right.
      return (
        <g>
          <g className="cz-tails" style={{ transformOrigin: "74px 22px" }}>
            <path d="M72 19 Q83 14 90 18 Q83 20 76 24 Z" fill="#C8372F" />
            <path d="M72 23 Q81 27 85 34 Q79 31 73 27 Z" fill="#9E2A24" />
          </g>
          <path d="M26 18 Q50 12 74 18 L74 27 Q50 21 26 27 Z" fill="#FF5E57" />
          <path d="M28 20.5 Q50 15.5 72 20.5" stroke="#fff" strokeWidth="1.6" fill="none" opacity=".55" />
        </g>
      );
    case "ghost": // Wings: backwards cap following the dome, strap and brim at the back.
      return (
        <g>
          <path d="M19 44 A31 31 0 0 1 81 44 Q50 36 19 44 Z" fill="#1FB5A8" />
          <path d="M19 44 Q50 36 81 44 L81 47 Q50 39 19 47 Z" fill="#128A80" />
          <path d="M72 22 Q86 20 94 27 Q84 29 77 29 Z" fill="#128A80" />
          <circle cx="50" cy="19.5" r="2.6" fill="#128A80" />
          <path d="M35 28 A24 24 0 0 1 48 22" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".4" />
        </g>
      );
    case "star": // Boulder: striped sweatband ringed round the top point.
      return (
        <g>
          <path d="M40.5 27 L59.5 27 L62.5 36 L37.5 36 Z" fill="#4C8DFF" />
          <path d="M39.3 30.5 L60.7 30.5" stroke="#fff" strokeWidth="1.8" />
          <path d="M38.3 33.3 L61.7 33.3" stroke="#fff" strokeWidth="1.2" opacity=".7" />
        </g>
      );
    case "mech": // Piston: riveted steel brow plate and the antenna.
      return (
        <g>
          <rect x="47.5" y="9" width="5" height="14" rx="2.5" fill="#7C8691" />
          <circle cx="50" cy="8" r="5.5" fill="#FF5E57" /><circle cx="48.3" cy="6.4" r="1.6" {...SHINE} />
          <rect x="15" y="26" width="70" height="9" rx="3" fill="#A9B2BC" />
          <rect x="15" y="26" width="70" height="3" rx="1.5" {...SHINE} />
          {[20, 35, 65, 80].map((x) => <circle key={x} cx={x} cy="31.5" r="1.6" fill="#6B747E" />)}
        </g>
      );
    case "heart": // Dash: headphones over both lobes.
      return (
        <g>
          <path d="M16 44 C14 16 86 16 84 44" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
          <rect x="10" y="38" width="10" height="16" rx="5" fill={INK} />
          <rect x="80" y="38" width="10" height="16" rx="5" fill={INK} />
          <rect x="12" y="41" width="4" height="10" rx="2" fill="#FF6F91" />
          <rect x="84" y="41" width="4" height="10" rx="2" fill="#FF6F91" />
        </g>
      );
    default: // Brick: 80s terry headband, white with red and navy stripes.
      return (
        <g>
          <rect x="15" y="22" width="70" height="10" fill="#F4F1EA" />
          <rect x="15" y="24.5" width="70" height="1.8" fill="#FF5E57" />
          <rect x="15" y="27.8" width="70" height="1.8" fill="#23408E" />
        </g>
      );
  }
}

// Where the anger vein throbs: the temple, clear of each coach's headgear.
const VEIN = { clover: [80, 43], heart: [71, 31], star: [76, 47], default: [78, 46] };

const MOUTHS = {
  smile: <path d="M41.5 64 Q50 72 58.5 64" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />,
  smirk: <path d="M42 66 Q51 71 59 62" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />,
  line: <path d="M43.5 66 L56.5 66" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />,
  tiny: <path d="M47.5 67 L52.5 67" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />,
  wobble: <path d="M42.5 67.5 Q46 63.5 50 67 Q54 70.5 57.5 66.5" fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />,
  grit: (
    <g>
      <rect x="39.5" y="61.5" width="21" height="9.5" rx="3.6" fill={INK} />
      <rect x="41.3" y="63" width="17.4" height="6.5" rx="1.8" fill="#fff" />
      <path d="M41.3 66.25 H58.7 M45.6 63 V69.5 M50 63 V69.5 M54.4 63 V69.5" stroke={INK} strokeWidth="1.1" />
    </g>
  ),
  o: <ellipse cx="50" cy="66.5" rx="3.6" ry="4.2" fill={INK} />,
  grin: (
    <g>
      <path d="M39 61 Q50 61 61 61 Q60 77 50 78 Q40 77 39 61 Z" fill={INK} />
      <path d="M41.5 61.5 L58.5 61.5 L57.5 65 L42.5 65 Z" fill="#fff" />
      <ellipse cx="50" cy="73.5" rx="5.5" ry="3" fill="#FF6F7D" />
    </g>
  ),
  roar: (
    <g>
      <path d="M40 59 Q50 57 60 59 Q63 79 50 81 Q37 79 40 59 Z" fill={INK} />
      <path d="M42 60 L58 60 L56.8 63.8 L43.2 63.8 Z" fill="#fff" />
      <ellipse cx="50" cy="75" rx="6" ry="3.4" fill="#FF6F7D" />
    </g>
  ),
};

/* One shared pointer listener; each coach reads it on the next frame to aim its pupils. */
const watchers = new Set();
let pointer = null, frame = 0;
function aimAll() {
  frame = 0;
  for (const w of watchers) w();
}
if (typeof window !== "undefined") {
  addEventListener("pointermove", (e) => { pointer = { x: e.clientX, y: e.clientY, t: performance.now() }; if (!frame) frame = requestAnimationFrame(aimAll); }, { passive: true });
}

/**
 * A coach. `mood` is one of MOOD_ORDER. `still` holds the pose (use in lists): the face still shows the mood,
 * the eyes still blink. Pass `decorative` when the coach's name is already shown as text beside it.
 */
/* Centre of each coach's idle artwork in viewBox units (measured). The full viewBox leaves headroom
   for hats and effects, so the body sits low; `badge` crops a square around the body instead. */
const BADGE_CENTER = { tank: [48.4, 52.8], wings: [50, 59.3], boulder: [50, 57.8], piston: [50, 54], brick: [50, 58.3], dash: [50, 60.1] };
const BADGE_SPAN = 112;

export default function Coach({ id = "tank", mood = "idle", size = 64, still = false, decorative = false, badge = false, className = "" }) {
  const c = COACHES[id] || COACHES.tank;
  const [bx, by] = BADGE_CENTER[id] || BADGE_CENTER.tank;
  const viewBox = badge ? `${bx - BADGE_SPAN / 2} ${by - BADGE_SPAN / 2} ${BADGE_SPAN} ${BADGE_SPAN}` : "-12 -24 124 132";
  const [poke, setPoke] = useState(false);
  const f = FACE[poke ? "hyped" : mood] || FACE.idle;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svg = useRef(null);
  const pupils = useRef([]);
  const delay = useRef(`${(-Math.random() * 5).toFixed(2)}s`).current;
  const shade = tone(c.color, -0.22);

  // Eyes follow the finger while it's nearby and recent; otherwise the idle wander takes over.
  useEffect(() => {
    const set = (v) => pupils.current.forEach((p) => { if (p) p.style.transform = v; });
    if (still || f.fixed) { set(""); return; }
    const aim = () => {
      const el = svg.current;
      if (!el) return;
      if (!pointer || performance.now() - pointer.t > 2500) { set(""); return; }
      const r = el.getBoundingClientRect();
      const dx = pointer.x - (r.left + r.width / 2), dy = pointer.y - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 140) * 2.6;
      set(`translate(${(dx / d) * k}px, ${(dy / d) * k}px)`);
    };
    watchers.add(aim);
    return () => watchers.delete(aim);
  }, [still, f.fixed]);

  // A tap gets a quick happy bounce, then the real mood comes back.
  useEffect(() => {
    if (!poke) return;
    const t = setTimeout(() => setPoke(false), 900);
    return () => clearTimeout(t);
  }, [poke]);

  const a11y = decorative ? { "aria-hidden": true } : { role: "img", "aria-label": `${c.name}, ${(MOODS[mood] || MOODS.idle).title.toLowerCase()}` };
  const eyeX = [40, 60];
  const lookDown = f.down ? "translate(0px, 2px)" : "";

  return (
    <svg ref={svg} viewBox={viewBox} width={size} height={badge ? size : Math.round((size * 132) / 124)}
      className={`coach${still ? " coach-still" : ""}${poke ? " coach-poked" : ""} ${className}`} style={{ "--d": delay }}
      onPointerDown={decorative ? undefined : () => setPoke(true)} {...a11y}>
      <defs>
        <linearGradient id={`${uid}ao`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={INK} stopOpacity=".32" /><stop offset=".45" stopColor={INK} stopOpacity="0" /></linearGradient>
        <clipPath id={`${uid}c`}><Shape type={c.body} stroke="none" /></clipPath>
        {eyeX.map((x, i) => <clipPath key={i} id={`${uid}e${i}`}><ellipse cx={x} cy="54" rx="8.8" ry="9.8" /></clipPath>)}
      </defs>

      {f.fx === "stars" && !still && (
        <g>
          {[["6,6 8.5,11 14,11.5 10,15 11,20.5 6,18 1,20.5 2,15 -2,11.5 3.5,11", "#FFC53D", 0], ["94,0 96,4 100,4.4 97,7 98,11 94,9 90,11 91,7 88,4.4 92,4", "#FF5E57", 0.3],
            ["100,70 102,74 106,74.4 103,77 104,81 100,79 96,81 97,77 94,74.4 98,74", "#4C8DFF", 0.6], ["-4,64 -2,68 2,68.4 -1,71 0,75 -4,73 -8,75 -7,71 -10,68.4 -6,68", "#2EC27E", 0.15]]
            .map(([pts, col, dl]) => <polygon key={pts} className="coach-twinkle" style={{ animationDelay: `${dl}s` }} points={pts} fill={col} />)}
        </g>
      )}
      {f.fx === "lines" && !still && (
        <g className="coach-whoosh" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><path d="M-6 26 L2 32" /><path d="M-9 40 L0 41" /><path d="M106 26 L98 32" /><path d="M109 40 L100 41" /></g>
      )}

      <ellipse className="cz-ground" cx="50" cy="101" rx="30" ry="4.5" fill={INK} opacity=".13" />

      <g className={`coach-body coach-${f.anim}`}>

        {/* Flat shading: the body in its shadow color, then the lit body nudged up-left and clipped to the outline,
            leaving a crescent of shade along the bottom-right; a soft highlight sits top-left. */}
        {/* Arms go first so the body covers the shoulders. They're a step darker than the body: further back. */}
        <Arm uid={uid} side={-1} pose={f.arms} id={id} body={c.body} color={tone(c.color, -0.1)} shade={tone(c.color, -0.3)} />
        <Arm uid={uid} side={1} pose={f.arms} id={id} body={c.body} color={tone(c.color, -0.1)} shade={tone(c.color, -0.3)} />
        <Shape type={c.body} fill={shade} stroke={shade} />
        <g clipPath={`url(#${uid}c)`}>
          <Shape type={c.body} fill={c.color} stroke={c.color} transform="translate(-4 -5)" />
          <ellipse cx="30" cy="27" rx="11" ry="6" fill="#fff" opacity=".28" transform="rotate(-30 30 27)" />
        </g>

        <Gear coach={c} />

        {f.blush && <g fill="#FF7A8A" opacity=".45"><ellipse cx="31" cy="62" rx="5" ry="3" /><ellipse cx="69" cy="62" rx="5" ry="3" /></g>}

        {/* Eyes: sclera, matte pupils (aimed), and a lid that drops over each eye. */}
        <g className="cz-fade" style={{ opacity: f.eyes === "open" ? 1 : 0 }}>
          {eyeX.map((x, i) => (
            <g key={x} clipPath={`url(#${uid}e${i})`}>
              <ellipse cx={x} cy="54" rx="8.8" ry="9.8" fill="#fff" />
              <g className={still || f.fixed ? undefined : "coach-look"} style={{ transform: lookDown }}>
                <g ref={(el) => { pupils.current[i] = el; }} className="cz-aim">
                  <circle cx={x + 1} cy="55" r={f.big ? 6 : f.pupil || 5.2} fill={INK} className="cz-pupil" />
                </g>
              </g>
              <g className="coach-blink-lid">
                <g className="cz-lid" style={{ transform: `translateY(${-21 + 21 * f.lid}px) rotate(${(i ? -1 : 1) * (f.lidTilt || 0)}deg)`, transformOrigin: `${x}px 64px` }}>
                  <rect x={x - 16} y="30" width="32" height="34" fill={c.color} />
                  <path d={`M${x - 16} 64 L${x + 16} 64`} stroke={INK} strokeWidth="2.8" />
                </g>
              </g>
            </g>
          ))}
        </g>
        <g className="cz-fade" style={{ opacity: f.eyes === "happy" ? 1 : 0 }} fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round">
          <path d="M33.5 55 Q40 46 46.5 55" /><path d="M53.5 55 Q60 46 66.5 55" />
        </g>
        <g className="cz-fade" style={{ opacity: f.eyes === "shut" ? 1 : 0 }} fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round">
          <path d="M33.5 52 Q40 58 46.5 52" /><path d="M53.5 52 Q60 58 66.5 52" />
        </g>
        <g className="cz-fade" style={{ opacity: f.eyes === "flat" ? 1 : 0 }} stroke={INK} strokeWidth="3.2" strokeLinecap="round">
          <path d="M34 54 L46 54" /><path d="M54 54 L66 54" />
        </g>

        {/* Brows: [lift, tilt] from the mood. Positive tilt lowers the inner ends (tough); negative raises
            them (soft). Each coach has their own brow shape and resting angle; the right brow mirrors the left. */}
        {eyeX.map((x, i) => {
          const b = BROWS[id] || BROWS.tank;
          const side = i ? -1 : 1; // shapes are drawn for the left brow: negative dx is the outer end
          const P = (dx, dy) => `${x + side * dx} ${40.5 + (b.dy || 0) + dy}`;
          return (
            <path key={x} className="cz-brow" d={b.d(P)} fill={b.line ? "none" : INK} stroke={INK}
              strokeWidth={b.line || 1.4} strokeLinecap={b.square ? "butt" : "round"} strokeLinejoin={b.square ? "miter" : "round"}
              style={{ transform: `translateY(${f.brow[0]}px) rotate(${side * (f.brow[1] + (b.tilt || 0))}deg)`, transformOrigin: `${x}px 40.5px` }} />
          );
        })}

        {Object.entries(MOUTHS).map(([k, el]) => (
          <g key={k} className="cz-mouth" style={{ opacity: f.mouth === k ? 1 : 0, transform: `scale(${f.mouth === k ? 1 : 0.5})` }}>{el}</g>
        ))}

        {f.fx === "vein" && (
          <g transform={`translate(${(VEIN[c.body] || VEIN.default).join(" ")})`}>
            <g className={still ? undefined : "coach-vein"} fill="none" stroke="#E0342C" strokeWidth="2.6" strokeLinecap="round">
              <path d="M-6 -2 Q-2 -2 -2 -6" /><path d="M2 -6 Q2 -2 6 -2" /><path d="M6 2 Q2 2 2 6" /><path d="M-2 6 Q-2 2 -6 2" />
            </g>
          </g>
        )}
        {f.fx === "sweat" && <path className="coach-drip" d="M82 40 q4.5 7 0 10.5 q-4.5 -3.5 0 -10.5" fill="#6FB7FF" />}
        {f.fx === "medal" && <g><path d="M44 76 L50 86 L56 76" fill="none" stroke="#4C8DFF" strokeWidth="4" /><circle cx="50" cy="90" r="7.5" fill="#FFC53D" stroke="#D9A21F" strokeWidth="2" /><circle cx="48" cy="88" r="2" fill="#fff" opacity=".6" /></g>}
      </g>

      {f.fx === "zzz" && (
        <g fill="currentColor" opacity=".7" style={{ fontFamily: "var(--body)", fontWeight: 800 }}>
          <text className="coach-zzz" x="80" y="20" fontSize="14">z</text>
          <text className="coach-zzz" style={{ animationDelay: ".8s" }} x="90" y="8" fontSize="11">z</text>
          <text className="coach-zzz" style={{ animationDelay: "1.6s" }} x="98" y="-2" fontSize="9">z</text>
        </g>
      )}
    </svg>
  );
}
