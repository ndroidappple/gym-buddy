/* The type scale in src/styles.css ("Type"): every font size under 28 px is on the scale, and every
   weight is one of the four. Run: npm run test:type   (exits 1 and lists what's off) */
import { readFileSync } from "node:fs";

const SCALE = [11, 12.5, 13.5, 15, 16, 18, 20, 24, 26];
const DISPLAY = 28; // and up: hero numbers and titles, sized per screen
const WEIGHTS = [500, 600, 700, 800];

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const off = [];
for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const where = sel.trim().replace(/\s+/g, " ");
  for (const [, v] of body.matchAll(/font-size:\s*([0-9.]+)px/g)) if (+v < DISPLAY && !SCALE.includes(+v)) off.push(`${where}: font-size ${v}px`);
  for (const [, v] of body.matchAll(/font-weight:\s*([0-9]+)/g)) if (!WEIGHTS.includes(+v)) off.push(`${where}: font-weight ${v}`);
}
if (off.length) { console.error(`type: ${off.length} off the scale\n  ${off.join("\n  ")}`); process.exit(1); }
console.log("type: all sizes and weights on the scale");
