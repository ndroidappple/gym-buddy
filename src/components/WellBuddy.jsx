import React, { useEffect, useId, useState } from "react";

/* The two characters on the alcohol & cannabis sheet, drawn like the coaches (flat body in its shadow
   colour with the lit body nudged up-left and clipped, white eyes, lids in the body colour, ink features).

   Proof: a big liquor handle in gold glass, deliberately generic (no brand's label, colours or name).
   Sly: one brow up, a heavier lid, a smirk. Hops and sloshes when a drink goes on; tips back when one
   comes off.
   Haze: a leaf, the face on its broad middle leaflet, six narrower ones fanned behind and a short stem.
   Mellow: half-lidded, drifting, the outer leaflets swaying. Switching cannabis on gets a slow
   eyes-closed exhale and a little puff; off, a small tilt.

   Neither cheers nor frowns at anything: no smile that grows, no frown, no colour change. They react to
   the tap, not to what it means. `react` is the last change ("add" | "remove" | "on" | "off") and `nonce`
   changes with every tap, so the same reaction can play twice in a row. */

const INK = "#1C1A22";

const LOOK = {
  alcohol: { color: "#F5C451", shade: "#D99A2B", lids: [0.36, 0.14], tilt: [10, 0] },
  cannabis: { color: "#8CCF98", shade: "#62AE72", back: "#4E9A5E", vein: "#6DB97C", lids: [0.5, 0.5], tilt: [0, 0] },
};

// How long each reaction runs (styles.css has the matching keyframes).
const REACT_MS = { add: 650, remove: 600, on: 1700, off: 700 };

export default function WellBuddy({ kind = "alcohol", size = 72, react = null, nonce = 0 }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const L = LOOK[kind];
  const [playing, setPlaying] = useState(null);
  useEffect(() => {
    if (!react || !nonce) return;
    setPlaying(react);
    const t = setTimeout(() => setPlaying(null), REACT_MS[react] || 700);
    return () => clearTimeout(t);
  }, [nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  // Haze's exhale closes both eyes for a beat; everything else keeps the resting lids.
  const lids = playing === "on" && kind === "cannabis" ? [1, 1] : L.lids;
  const eyes = kind === "alcohol" ? { x: [40, 60], y: 50, rx: 7, ry: 7.8 } : { x: [41, 59], y: 63, rx: 6.4, ry: 7 };

  return (
    <svg viewBox="-6 -8 112 118" width={size} height={Math.round((size * 118) / 112)} className={`buddy buddy-${kind}`} aria-hidden="true">
      <defs>
        <clipPath id={`${uid}b`}><path d={kind === "alcohol" ? BOTTLE : LEAF} /></clipPath>
        {eyes.x.map((x, i) => <clipPath key={i} id={`${uid}e${i}`}><ellipse cx={x} cy={eyes.y} rx={eyes.rx} ry={eyes.ry} /></clipPath>)}
      </defs>
      <ellipse cx="50" cy="105" rx="26" ry="3.6" fill={INK} opacity=".12" />
      <g className={`bd-idle bd-idle-${kind}`}>
        <g key={nonce} className={playing ? `bd-react bd-${kind}-${playing}` : "bd-react"}>
          {kind === "alcohol" ? <Bottle uid={uid} L={L} /> : <Leaf uid={uid} L={L} />}
          {/* Eyes: white, pupils, a lid in the body colour that drops to `lids`, and a blink on its own clock. */}
          {eyes.x.map((x, i) => (
            <g key={x} clipPath={`url(#${uid}e${i})`}>
              <ellipse cx={x} cy={eyes.y} rx={eyes.rx} ry={eyes.ry} fill="#fff" />
              <circle cx={x + 0.8} cy={eyes.y + 1.2} r="3.9" fill={INK} />
              <g className="bd-lid" style={{ transform: `translateY(${-(1 - lids[i]) * 2 * eyes.ry}px) rotate(${(i ? -1 : 1) * L.tilt[i]}deg)`, transformOrigin: `${x}px ${eyes.y}px` }}>
                <rect x={x - eyes.rx - 2} y={eyes.y - eyes.ry - 1} width={eyes.rx * 2 + 4} height={eyes.ry * 2 + 1} fill={L.color} />
                <path d={`M${x - eyes.rx - 2} ${eyes.y + eyes.ry} H${x + eyes.rx + 2}`} stroke={INK} strokeWidth="2.4" />
              </g>
              <rect className="bd-blink" x={x - eyes.rx - 2} y={eyes.y - eyes.ry - 1} width={eyes.rx * 2 + 4} height={eyes.ry * 2 + 2} fill={L.color} />
            </g>
          ))}
          {kind === "alcohol" ? <ProofFace /> : <HazeFace />}
        </g>
      </g>
      {kind === "cannabis" && playing === "on" && (
        <g className="bd-puff" fill="#CFCBD6">
          <circle cx="78" cy="58" r="3.4" /><circle cx="84" cy="48" r="4.6" /><circle cx="90" cy="36" r="5.8" />
        </g>
      )}
    </svg>
  );
}

/* A handle: cap, neck ring, square shoulders, a loop handle on the right, clear glass with the level
   showing, and a plain label (a stripe and two bars, no words or marks). */
const BOTTLE = "M41 22 L59 22 L59 27 C59 32 80 33 80 46 L80 92 Q80 102 70 102 L30 102 Q20 102 20 92 L20 46 C20 33 41 32 41 27 Z";
function Bottle({ uid, L }) {
  return (
    <>
      <path d="M75 37 C93 33 97 61 77 66" fill="none" stroke={L.shade} strokeWidth="9" strokeLinecap="round" />
      <path d="M75 37 C93 33 97 61 77 66" fill="none" stroke={L.color} strokeWidth="4" strokeLinecap="round" />
      <path d={BOTTLE} fill={L.shade} />
      <g clipPath={`url(#${uid}b)`}>
        <path d={BOTTLE} fill={L.color} transform="translate(-3 -4)" />
        {/* The level: a lighter fill with a surface that sloshes. */}
        <g className="bd-liquid">
          <path d="M14 55 Q32 51 50 55 T86 55 V106 H14 Z" fill="#FFE9A8" opacity=".38" />
        </g>
        <rect x="24.5" y="38" width="4.5" height="48" rx="2.2" fill="#fff" opacity=".55" />
      </g>
      <rect x="40" y="16.5" width="20" height="6.5" rx="1.5" fill={L.shade} />
      <rect x="38.5" y="5" width="23" height="13" rx="3.5" fill="#2E2C36" />
      <rect x="41" y="7.5" width="7" height="3" rx="1.5" fill="#fff" opacity=".25" />
      <rect x="27" y="68" width="46" height="25" rx="4" fill="#F4EEE3" />
      <rect x="27" y="72" width="46" height="3.2" fill="#8A4B12" />
      <rect x="36" y="80" width="28" height="4" rx="2" fill={INK} opacity=".72" />
      <rect x="41" y="87" width="18" height="2.6" rx="1.3" fill={INK} opacity=".35" />
    </>
  );
}
function ProofFace() {
  return (
    <g fill="none" stroke={INK} strokeLinecap="round">
      <path d="M32.5 41.5 L46 43" strokeWidth="3.4" />
      <path d="M53.5 37.5 Q60 34 67.5 35.5" strokeWidth="3.4" />
      <path d="M43.5 62 Q51.5 66 58.5 59.5" strokeWidth="3" />
    </g>
  );
}

/* A leaf: a broad middle leaflet as the body (the face goes on it), six narrower leaflets fanned out
   behind from the stem, longest at the top, each with a vein. */
const LEAF = "M50 12 C63 28 73 48 71 68 C69 86 60 96 50 96 C40 96 31 86 29 68 C27 48 37 28 50 12 Z";
const SIDE = [[-33, 66, 11], [-62, 54, 10], [-94, 38, 8], [33, 66, 11], [62, 54, 10], [94, 38, 8]]; // angle, length, half-width
function Leaf({ uid, L }) {
  return (
    <>
      <g className="bd-fan">
        {SIDE.map(([a, len, w]) => (
          <g key={a} transform={`translate(50 90) rotate(${a})`}>
            <path d={`M0 0 Q${w} ${-len * 0.45} 0 ${-len} Q${-w} ${-len * 0.45} 0 0 Z`} fill={L.back} />
            <path d={`M0 -4 L0 ${-len + 6}`} stroke={L.vein} strokeWidth="1.4" strokeLinecap="round" />
          </g>
        ))}
      </g>
      <path d="M50 94 Q51 100 47 106" fill="none" stroke={L.back} strokeWidth="4" strokeLinecap="round" />
      <path d={LEAF} fill={L.shade} />
      <g clipPath={`url(#${uid}b)`}>
        <path d={LEAF} fill={L.color} transform="translate(-3 -4)" />
        <path d="M50 22 L50 46" stroke={L.vein} strokeWidth="1.6" strokeLinecap="round" opacity=".8" />
        <ellipse cx="38" cy="42" rx="5" ry="9" fill="#fff" opacity=".26" transform="rotate(-22 38 42)" />
      </g>
    </>
  );
}
function HazeFace() {
  return (
    <g fill="none" stroke={INK} strokeLinecap="round">
      <path d="M34.5 53 Q41 51 47 53" strokeWidth="2.6" />
      <path d="M53 53 Q59 51 65.5 53" strokeWidth="2.6" />
      <path d="M45.5 76 Q50 78.5 54.5 76" strokeWidth="2.6" />
    </g>
  );
}
