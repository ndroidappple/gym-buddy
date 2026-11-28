import React, { useEffect, useId, useState } from "react";

/* The two characters on the alcohol & cannabis sheet, drawn like the coaches (flat body in its shadow
   colour with the lit body nudged up-left and clipped, white eyes, lids in the body colour, ink features).

   Proof: a big liquor bottle in gold glass, deliberately generic (no brand's label, colours or name).
   Sly: one brow up, a heavier lid, a smirk. Hops and sloshes when a drink goes on; tips back when one
   comes off.
   Haze: one bold seven-point leaf, drawn as a single shape like the coaches' clover or hex, the face on
   its round middle. Mellow: half-lidded, drifting. Switching cannabis on gets a slow eyes-closed exhale
   and a little puff; off, a small tilt.

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
  const H = HAZE;
  const eyes = kind === "alcohol" ? { x: [40, 60], y: 50, rx: 7, ry: 7.8 } : H.eyes;

  return (
    <svg viewBox="-6 -8 112 118" width={size} height={Math.round((size * 118) / 112)} className={`buddy buddy-${kind}`} aria-hidden="true">
      <defs>
        <clipPath id={`${uid}b`}>{kind === "alcohol" ? <path d={BOTTLE} /> : <H.Body />}</clipPath>
        {eyes.x.map((x, i) => <clipPath key={i} id={`${uid}e${i}`}><ellipse cx={x} cy={eyes.y} rx={eyes.rx} ry={eyes.ry} /></clipPath>)}
      </defs>
      <ellipse cx="50" cy="105" rx="26" ry="3.6" fill={INK} opacity=".12" />
      <g className={`bd-idle bd-idle-${kind}`}>
        <g key={nonce} className={playing ? `bd-react bd-${kind}-${playing}` : "bd-react"}>
          {kind === "alcohol" ? <Bottle uid={uid} L={L} /> : <Haze uid={uid} L={L} H={H} />}
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
          {kind === "alcohol" ? <ProofFace /> : <HazeFace f={H.face} ex={H.eyes.x} />}
        </g>
      </g>
      {kind === "cannabis" && playing === "on" && (
        <g className="bd-puff" fill="#CFCBD6">
          {H.puff.map(([cx, cy, r]) => <circle key={cx} cx={cx} cy={cy} r={r} />)}
        </g>
      )}
    </svg>
  );
}

/* A liquor bottle: cap, neck ring, square shoulders, gold glass with the level showing. No label. */
const BOTTLE = "M41 22 L59 22 L59 27 C59 32 80 33 80 46 L80 92 Q80 102 70 102 L30 102 Q20 102 20 92 L20 46 C20 33 41 32 41 27 Z";
function Bottle({ uid, L }) {
  return (
    <>
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

/* Haze: seven pointed leaflets fanned from the stem and a round middle for the face, all one outline
   (for the clip, so the shading stays inside it). Drawn like the coaches: the outline in its shadow
   colour, the lit leaf nudged up-left and clipped, a soft highlight, a light vein down each leaflet. */
const leaflet = (len, w) => `M0 0 Q${w} ${-len * 0.45} 0 ${-len} Q${-w} ${-len * 0.45} 0 0 Z`;
const LEAVES = [[0, 64, 17], [-31, 58, 16], [31, 58, 16], [-62, 46, 14], [62, 46, 14], [-96, 32, 11], [96, 32, 11]]; // angle, length, half-width
const AT = [50, 80]; // where the leaflets meet
const HAZE = {
  Body: () => (
    <>
      <circle cx="50" cy="68" r="20" />
      {LEAVES.map(([a, len, w]) => <path key={a} d={leaflet(len, w)} transform={`translate(${AT[0]} ${AT[1]}) rotate(${a})`} />)}
    </>
  ),
  stem: "M50 84 Q51 97 46 105",
  veins: LEAVES.filter(([a]) => Math.abs(a) < 90),
  eyes: { x: [42.5, 57.5], y: 66, rx: 5.8, ry: 6.4 },
  face: { brow: 57, mouth: 78, span: 5.8 },
  puff: [[84, 50, 3.4], [90, 40, 4.6], [96, 28, 5.8]],
};

function Haze({ uid, L, H }) {
  return (
    <>
      <path d={H.stem} fill="none" stroke={L.back} strokeWidth="4" strokeLinecap="round" />
      <g fill={L.shade}><H.Body /></g>
      <g clipPath={`url(#${uid}b)`}>
        <g fill={L.color} transform="translate(-3 -4)"><H.Body /></g>
        <g stroke={L.vein} strokeWidth="1.6" strokeLinecap="round" fill="none" opacity=".85">
          {H.veins.map(([a, len]) => <path key={a} d={`M0 -26 L0 ${-len + 9}`} transform={`translate(${AT[0]} ${AT[1]}) rotate(${a})`} />)}
        </g>
        <ellipse cx="38" cy="38" rx="5" ry="9" fill="#fff" opacity=".24" transform="rotate(-22 38 38)" />
      </g>
    </>
  );
}
function HazeFace({ f, ex }) {
  // Soft, level brows over each eye: relaxed, neither raised nor knitted.
  const b = (x) => `M${x - f.span - 0.5} ${f.brow} Q${x} ${f.brow - 2} ${x + f.span + 0.5} ${f.brow}`;
  return (
    <g fill="none" stroke={INK} strokeLinecap="round">
      <path d={b(ex[0])} strokeWidth="2.6" />
      <path d={b(ex[1])} strokeWidth="2.6" />
      <path d={`M45.5 ${f.mouth} Q50 ${f.mouth + 2.5} 54.5 ${f.mouth}`} strokeWidth="2.6" />
    </g>
  );
}
