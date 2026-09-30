/* Renders the coach home screen icons in public/icons/<coach>/ from the live Coach component, so they
   track the coaches' current look. Run after changing a coach: npm run icons
   Needs a Chromium; set CHROMIUM_PATH if it isn't at /opt/pw-browsers/chromium. */
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const SIZES = [180, 192, 512];
// The same framing for every coach, sized so the flexed fists stay inside Android's round mask (the middle 80%).
const FRAME = "-30 -33.1 160 160";
const CREAM = "#F5F2ED";
// Tile background: the coach's color, 70% of the way to cream.
const tint = (hex) => {
  const a = parseInt(hex.slice(1), 16), b = parseInt(CREAM.slice(1), 16);
  return `rgb(${[16, 8, 0].map((s) => Math.round(((a >> s) & 255) * 0.3 + ((b >> s) & 255) * 0.7)).join(",")})`;
};

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { default: Coach } = await vite.ssrLoadModule("/src/components/Coach.jsx");
const { COACHES, COACH_ORDER } = await vite.ssrLoadModule("/src/data/coaches.js");
await vite.close();

const css = fs.readFileSync("src/styles.css", "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
for (const id of COACH_ORDER) {
  // Fired up, held still: the happy flex, without motion lines.
  const coach = renderToStaticMarkup(React.createElement(Coach, { id, mood: "hyped", still: true, decorative: true }))
    .replace(/^<svg /, '<svg x="-12" y="-24" width="124" height="132" ');
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><style>${css}
      *, *::before, *::after { animation: none !important; transition: none !important; }
      html, body { margin: 0; background: ${tint(COACHES[id].color)}; }</style>
      <svg viewBox="${FRAME}" width="${size}" height="${size}" style="display:block;color:#1C1A22">${coach}</svg>`);
    await page.screenshot({ path: `public/icons/${id}/${size}.png`, clip: { x: 0, y: 0, width: size, height: size } });
  }
  console.log(`icons/${id}`);
}
await browser.close();
