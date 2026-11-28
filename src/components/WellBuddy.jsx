import React, { useEffect, useId, useState } from "react";

/* The two characters on the alcohol & cannabis sheet, drawn like the coaches (flat body in its shadow
   colour with the lit body nudged up-left and clipped, white eyes, lids in the body colour, ink features).

   Proof: a big liquor bottle in gold glass, deliberately generic (no brand's label, colours or name).
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

export default function WellBuddy({ kind = "alcohol", size = 72, react = null, nonce = 0, variant = "fan" }) {
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
  const H = HAZE[variant] || HAZE.fan;
  const eyes = kind === "alcohol" ? { x: [40, 60], y: 50, rx: 7, ry: 7.8 } : H.eyes;

  return (
    <svg viewBox="-6 -8 112 118" width={size} height={Math.round((size * 118) / 112)} className={`buddy buddy-${kind}`} aria-hidden="true">
      <defs>
        <clipPath id={`${uid}b`}>{kind === "alcohol" ? <path d={BOTTLE} /> : <H.Body />}</clipPath>
        {eyes.x.map((x, i) => <clipPath key={i} id={`${uid}e${i}`}><ellipse cx={x} cy={eyes.y} rx={eyes.rx} ry={eyes.ry} /></clipPath>)}
      </defs>
      <ellipse cx="50" cy="105" rx="26" ry="3.6" fill={INK} opacity=".12" />
      <g className={`bd-idle bd-idle-${kind}${kind === "cannabis" ? ` haze-${variant}` : ""}`}>
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

/* A liquor bottle: cap, neck ring, square shoulders, gold glass with the level showing, and a plain
   label (a stripe and two bars, no words or marks). */
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

/* Haze, in four takes on the leaf. Each has its body outline (for the clip, so shading stays inside
   it), what's drawn behind the body, and where the face sits. All drawn the same way: the outline in
   its shadow colour, the lit body nudged up-left and clipped, a soft highlight, a light vein. */

/* A pointed leaflet from its base at 0,0, `len` long and `w` across at its widest. */
const leaflet = (len, w) => `M0 0 Q${w} ${-len * 0.45} 0 ${-len} Q${-w} ${-len * 0.45} 0 0 Z`;
const Leaflets = ({ at, list, fill, vein, className }) => (
  <g className={className}>
    {list.map(([a, len, w]) => (
      <g key={a} transform={`translate(${at[0]} ${at[1]}) rotate(${a})`}>
        <path d={leaflet(len, w)} fill={fill} />
        {vein && <path d={`M0 -4 L0 ${-len + 6}`} stroke={vein} strokeWidth="1.4" strokeLinecap="round" />}
      </g>
    ))}
  </g>
);

const FAN_BODY = "M50 12 C63 28 73 48 71 68 C69 86 60 96 50 96 C40 96 31 86 29 68 C27 48 37 28 50 12 Z";
const TRIO_BODY = "M50 10 C64 27 74 48 72 68 C70 86 60 96 50 96 C40 96 30 86 28 68 C26 48 36 27 50 10 Z";
const BLADE_BODY = "M50 6 C69 24 79 48 74 70 C70 88 60 98 50 98 C40 98 30 88 26 70 C21 48 31 24 50 6 Z";
const EMBLEM_LEAVES = [[0, 64, 17], [-31, 58, 16], [31, 58, 16], [-62, 46, 14], [62, 46, 14], [-96, 32, 11], [96, 32, 11]];
const EMBLEM_AT = [50, 80];

const HAZE = {
  // Fan: the face on the broad middle leaflet, six narrower ones fanned out behind from a short stem.
  fan: {
    Body: () => <path d={FAN_BODY} />,
    behind: (L) => <Leaflets className="bd-fan" at={[50, 90]} fill={L.back} vein={L.vein} list={[[-33, 66, 11], [-62, 54, 10], [-94, 38, 8], [33, 66, 11], [62, 54, 10], [94, 38, 8]]} />,
    stem: "M50 94 Q51 100 47 106",
    vein: "M50 20 L50 44",
    eyes: { x: [41, 59], y: 63, rx: 6.4, ry: 7 }, face: { brow: 53, mouth: 76, span: 6.4 }, puff: [[76, 54, 3.4], [82, 44, 4.6], [88, 32, 5.8]],
  },
  // Trio: just three leaflets, the two at the sides hanging loose like relaxed arms and swaying apart.
  trio: {
    Body: () => <path d={TRIO_BODY} />,
    behind: (L) => (
      <>
        <Leaflets className="bd-arm-l" at={[47, 88]} fill={L.back} vein={L.vein} list={[[-58, 50, 11]]} />
        <Leaflets className="bd-arm-r" at={[53, 88]} fill={L.back} vein={L.vein} list={[[58, 50, 11]]} />
      </>
    ),
    stem: "M50 94 Q51 100 47 106",
    vein: "M50 18 L50 44",
    eyes: { x: [41, 59], y: 63, rx: 6.4, ry: 7 }, face: { brow: 53, mouth: 76, span: 6.4 }, puff: [[76, 52, 3.4], [82, 42, 4.6], [88, 30, 5.8]],
  },
  // Emblem: one bold seven-point leaf, drawn as a single shape like the coaches' clover or hex, the face
  // on its round middle.
  emblem: {
    Body: () => (
      <>
        <circle cx="50" cy="68" r="20" />
        {EMBLEM_LEAVES.map(([a, len, w]) => <path key={a} d={leaflet(len, w)} transform={`translate(${EMBLEM_AT[0]} ${EMBLEM_AT[1]}) rotate(${a})`} />)}
      </>
    ),
    behind: () => null,
    stem: "M50 84 Q51 97 46 105",
    veins: EMBLEM_LEAVES.filter(([a]) => Math.abs(a) < 90),
    eyes: { x: [42.5, 57.5], y: 66, rx: 5.8, ry: 6.4 }, face: { brow: 57, mouth: 78, span: 5.8 }, puff: [[84, 50, 3.4], [90, 40, 4.6], [96, 28, 5.8]],
  },
  // Blade: a single leaflet with its midrib and side veins, on a curled stem. The plainest of the four.
  blade: {
    Body: () => <path d={BLADE_BODY} />,
    behind: () => null,
    stem: "M50 97 Q53 104 47 108",
    vein: "M50 14 L50 42",
    sideVeins: ["M50 30 L40 22", "M50 30 L60 22", "M50 40 L36 32", "M50 40 L64 32"],
    eyes: { x: [41, 59], y: 60, rx: 6.6, ry: 7.2 }, face: { brow: 50, mouth: 73, span: 6.6 }, puff: [[78, 50, 3.4], [84, 40, 4.6], [90, 28, 5.8]],
  },
};
export const HAZE_VARIANTS = Object.keys(HAZE);

function Haze({ uid, L, H }) {
  return (
    <>
      {H.behind(L)}
      <path d={H.stem} fill="none" stroke={L.back} strokeWidth="4" strokeLinecap="round" />
      <g fill={L.shade}><H.Body /></g>
      <g clipPath={`url(#${uid}b)`}>
        <g fill={L.color} transform="translate(-3 -4)"><H.Body /></g>
        <g stroke={L.vein} strokeWidth="1.6" strokeLinecap="round" fill="none" opacity=".85">
          {H.vein && <path d={H.vein} />}
          {H.sideVeins?.map((d) => <path key={d} d={d} />)}
          {H.veins?.map(([a, len]) => <path key={a} d={`M0 -26 L0 ${-len + 9}`} transform={`translate(${EMBLEM_AT[0]} ${EMBLEM_AT[1]}) rotate(${a})`} />)}
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
