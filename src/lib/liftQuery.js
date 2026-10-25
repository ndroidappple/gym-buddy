import { muscleOf, patternOf } from "./busy.js";
import { matchScore } from "./foodQuery.js";

/* The lift picker's box, read on the phone (instantly, no AI), like Add food's: a lift's name, or what
   the lifter wants in words ("something for upper chest, no bench", "rows I can do at home"). A
   description is understood as muscles, movement, equipment wanted and equipment to avoid, and the
   library is ranked by how well each lift fits, with the reasons shown. What the phone can't read
   (an injury, a feel, "like X but easier") goes to the head coach, who suggests lifts to tap. */

/* What each lift needs, by name. A lift can need more than one (a bench and a barbell). */
const EQUIP = [
  ["machine", /machine|hack|leg press|leg curl|leg extension|pec dec|smith|abduction|adduction|calf raise \(seated\)|seated calf|chest press|lateral raise \(machine\)/i],
  ["cable", /cable|pulldown|pushdown|crossover|face pull|straight-arm|y-raise|rope/i],
  ["barbell", /barbell|bench press|back squat|front squat|deadlift|good morning|ez-bar|t-bar|close-grip|overhead press|hip thrust|shrugs/i],
  ["dumbbell", /\bdb\b|dumbbell|goblet|arnold|concentration|lateral raise \(db\)|front raise|hammer|single-arm db|step-up|walking lunge/i],
  ["bodyweight", /push-?up|pull-?up|chin-?up|dips|nordic|plank|crunch|sit-?up|leg raise/i],
];
const BENCH = /bench|incline|decline|preacher|chest-supported|arnold|seated db|skull|concentration|hip thrust|single-arm db row/i;
export const equipmentOf = (name) => EQUIP.filter(([, re]) => re.test(name)).map(([k]) => k);
export const needsBench = (name) => BENCH.test(name);

/* Words → what they mean. Most specific first. */
const MUSCLE_WORDS = [
  [/upper chest/, ["chest"], { incline: true }], [/lower chest/, ["chest"], { decline: true }],
  [/\b(chest|pecs?)\b/, ["chest"]],
  [/rear delts?/, ["shoulders"], { pattern: "rear delt" }], [/side delts?|lateral delts?/, ["shoulders"], { pattern: "raise", name: /lateral|y-raise|upright/i }],
  [/\b(shoulders?|delts?)\b/, ["shoulders"]],
  [/\btraps?\b/, ["back"], { name: /shrug|upright/i }], [/\b(lats?|upper back|back)\b/, ["back"]],
  [/\b(triceps?|tris)\b/, ["triceps"]], [/\b(biceps?|bis)\b/, ["biceps"]], [/\barms?\b/, ["biceps", "triceps"]],
  [/\b(hamstrings?|hams)\b/, ["hamstrings"]], [/\b(glutes?|butt|booty)\b/, ["glutes"]], [/\b(quads?|thighs?)\b/, ["quads"]],
  [/\b(calf|calves)\b/, ["calves"]], [/\b(abs?|core|obliques?)\b/, ["core"]], [/\blegs?\b/, ["quads", "hamstrings", "glutes"]],
];
const PATTERN_WORDS = [
  [/\b(press(es)?|pressing|push(es)?)\b/, "press"], [/\brows?\b/, "horizontal pull"], [/\b(pulldowns?|pull-?ups?|chin-?ups?|vertical pull)\b/, "vertical pull"],
  [/\b(fly|flyes?|flies)\b/, "fly"], [/\b(raises?)\b/, "raise"], [/\b(curls?)\b/, "curl"], [/\b(squats?|lunges?)\b/, "squat"],
  [/\b(hinge|deadlifts?|rdl)\b/, "hinge"], [/\b(extensions?|pushdowns?)\b/, "extension"],
];
const EQUIP_WORDS = [[/\b(dumbbells?|dbs?)\b/, "dumbbell"], [/\bcables?\b/, "cable"], [/\bmachines?\b/, "machine"], [/\bbarbells?\b/, "barbell"],
  [/\b(bodyweight|body weight|no equipment|calisthenics)\b/, "bodyweight"]];
const NOT = /\b(no|without|not|skip|avoid|except|other than)\s+(an?\s+|the\s+|any\s+)?([a-z-]+)/g;
const FILLER = /\b(something|anything|for|alternative|instead|like|exercise|lift|move|movement|home|hotel|gym|easy|easier|harder|that|works?|hits?|target|i can)\b/;

/**
 * Reads the box. Returns { kind: "empty" | "search" | "describe", text, muscles, pattern, want, avoid,
 * bench (false when to avoid one), incline, decline, name (a name pattern), chips }. A name search is
 * one that matches a lift by name (`known`), or a word or two with nothing to understand.
 */
export function readLiftQuery(raw, { known = false } = {}) {
  const text = String(raw || "").trim();
  const t = text.toLowerCase();
  const out = { kind: "empty", text, muscles: [], pattern: null, want: [], avoid: [], bench: null, incline: false, decline: false, name: null, chips: [] };
  if (!t) return out;
  let rest = t;
  for (const m of t.matchAll(NOT)) {
    const w = m[3];
    if (/^benche?s?$/.test(w)) out.bench = false;
    const e = EQUIP_WORDS.find(([re]) => re.test(w))?.[1] || (/^equipment$/.test(w) ? "equipment" : null);
    if (e === "equipment") out.want.push("bodyweight");
    else if (e) out.avoid.push(e);
    if (/^benche?s?$/.test(w) || e) out.chips.push({ text: `no ${w.replace(/s$/, "")}`, avoid: true });
    rest = rest.replace(m[0], " ");
  }
  for (const [re, ms, extra = {}] of MUSCLE_WORDS) {
    const m = rest.match(re);
    if (!m) continue;
    out.muscles.push(...ms.filter((x) => !out.muscles.includes(x)));
    if (extra.incline) out.incline = true;
    if (extra.decline) out.decline = true;
    if (extra.pattern) out.pattern = extra.pattern;
    if (extra.name) out.name = extra.name;
    out.chips.push({ text: m[0] });
    rest = rest.replace(m[0], " ");
  }
  if (/\bincline\b/.test(rest) && !out.incline) { out.incline = true; out.chips.push({ text: "incline" }); }
  if (/\bdecline\b/.test(rest) && !out.decline) { out.decline = true; out.chips.push({ text: "decline" }); }
  for (const [re, p] of PATTERN_WORDS) if (!out.pattern && re.test(rest)) { out.pattern = p; out.chips.push({ text: rest.match(re)[0] }); }
  for (const [re, e] of EQUIP_WORDS) if (re.test(rest) && !out.want.includes(e)) { out.want.push(e); out.chips.push({ text: rest.match(re)[0] }); }
  if (/\b(home|hotel|travel(ing)?)\b/.test(t)) { out.home = true; if (!out.want.length) out.want.push("bodyweight", "dumbbell"); out.chips.push({ text: "at home" }); }
  const understood = out.muscles.length + (out.pattern ? 1 : 0) + out.want.length + out.avoid.length + (out.bench === false ? 1 : 0);
  const words = t.split(/\s+/).length;
  out.kind = !known && (understood >= 2 || (understood >= 1 && (FILLER.test(t) || words >= 3)) || words >= 6) ? "describe" : "search";
  return out;
}

/* How a lift does the curl / extension / squat movements in the reader's words (busy.js has the
   rest: press, rows, pulldowns, fly, raise, rear delt, hinge). */
const movesAs = (n, p) => (p === "curl" ? /curl/i.test(n) && !/leg curl/i.test(n) : p === "extension" ? /extension|pushdown|skull/i.test(n) && !/leg extension/i.test(n)
  : p === "squat" ? /squat|lunge|leg press|step-?up/i.test(n) : p === "rear delt" ? /rear delt|face pull|reverse pec|upright row/i.test(n) : patternOf(n) === p);

/**
 * The library ranked for what was described: lifts that can't fit (wrong muscle, gear to avoid, a
 * bench when there's none) are out; the rest score for the movement, the gear wanted, and an incline
 * or decline asked for. Returns [{ e, why: ["Chest", "cable", "no bench"] }], best first.
 */
export function rankLifts(lib, r, k = 6) {
  const LABEL = { chest: "Chest", back: "Back", shoulders: "Shoulders", triceps: "Triceps", biceps: "Biceps", quads: "Quads", hamstrings: "Hamstrings", glutes: "Glutes", calves: "Calves", core: "Core" };
  return lib.map((e) => {
    const n = e.n, gear = equipmentOf(n), m = muscleOf(n);
    if (r.muscles.length && !r.muscles.includes(m)) return null;
    if (r.name && !r.name.test(n)) return null;
    if (r.avoid.some((x) => gear.includes(x))) return null;
    if (r.bench === false && needsBench(n)) return null;
    if (r.want.length === 1 && r.want[0] === "bodyweight" && !gear.includes("bodyweight")) return null;
    // At home there's no rack, cable stack or machine: bodyweight and dumbbells only.
    if (r.home && !gear.some((x) => x === "bodyweight" || x === "dumbbell")) return null;
    let score = 1;
    const why = [LABEL[m] || e.g];
    if (r.pattern) { if (movesAs(n, r.pattern)) score += 3; else score -= 1; }
    const gearHit = r.want.find((x) => gear.includes(x));
    if (r.want.length) { if (gearHit) { score += 2; why.push(gearHit); } else score -= 2; }
    if (r.incline) { if (/incline|low to high/i.test(n)) { score += 3; why.push("incline"); } else if (/decline|high to low|dips/i.test(n)) score -= 3; }
    if (r.decline) { if (/decline|dips|high to low/i.test(n)) { score += 3; why.push("decline"); } else if (/incline/i.test(n)) score -= 3; }
    if (r.bench === false) why.push("no bench");
    if (r.avoid.length && !gearHit) why.push(gear[0] || "no gear");
    return { e, why, score, moves: !r.pattern || movesAs(n, r.pattern) };
  }).filter(Boolean)
    // A movement asked for ("rows") is what they want: only lifts that move that way, when there are any.
    .filter((x, _, all) => x.moves || !all.some((y) => y.moves))
    .sort((a, b) => b.score - a.score).slice(0, k).map(({ e, why }) => ({ e, why }));
}

/** Whether a lift matches a name search: every word, forgivingly (the food search's matching). */
export const liftMatch = (e, q) => matchScore({ name: e.n, brand: e.g }, q);
