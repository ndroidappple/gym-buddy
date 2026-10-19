/* GymBuddy's sounds: rendered from earshot's sound bank by scripts/render-sounds.py (what each one is, and how
   it was checked, is there). They're decoded once into the Web Audio context and played from memory. */
import setUrl from "../assets/sounds/set.mp3";
import tickUrl from "../assets/sounds/tick.mp3";
import restUrl from "../assets/sounds/rest.mp3";
import prUrl from "../assets/sounds/pr.mp3";
import doneUrl from "../assets/sounds/done.mp3";

const URLS = { set: setUrl, tick: tickUrl, rest: restUrl, pr: prUrl, done: doneUrl };
const buffers = {};
const loading = {};
let ctx = null;
let enabled = true;
/** The sounds follow the Settings switch (App calls this from prefs). */
export const setSound = (on) => { enabled = on !== false; };

function context() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  // iOS stops the audio when the lifter switches to their music app or takes a call, and only a tap
  // starts it again: any tap does, and coming back to the app tries.
  ["touchend", "click", "keydown"].forEach((e) => document.addEventListener(e, wake, { capture: true, passive: true }));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wake(); });
  return ctx;
}
function wake() {
  try { if (ctx.state !== "running") ctx.resume().catch(() => {}); } catch {}
}

/** Fetches and decodes the sounds (once; a failed one is tried again next time). No tap needed. */
export function loadSounds() {
  if (!enabled) return;
  try {
    const c = context();
    for (const [name, url] of Object.entries(URLS)) {
      loading[name] ||= fetch(url).then((r) => r.arrayBuffer())
        .then((data) => c.decodeAudioData(data))
        .then((b) => { buffers[name] = b; }, () => { delete loading[name]; });
    }
  } catch {}
}

/** Call from a user gesture (e.g. "Log set") so mobile browsers allow audio later. */
export function primeAudio() {
  try {
    context();
    wake();
    loadSounds();
  } catch {}
}

function start(name, at) {
  const b = buffers[name];
  if (!b) return name === "rest" ? beep(at) : null; // the bell isn't loaded (offline): the old two tones
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.connect(ctx.destination);
  src.start(at);
  return src;
}

/** Plays a sound now: "set", "pr", "done". For taps, so it plays even while the audio is still waking. */
export function play(name) {
  if (!ctx || !enabled) return;
  try { start(name, ctx.currentTime); } catch {}
}

/**
 * Plays a timer sound ("tick", "rest") `inS` seconds from now, on the audio clock so the countdown keeps
 * time. Skipped when the audio is asleep (it would play late, on the next tap). Returns a cancel for a
 * sound that hasn't started yet.
 */
export function cue(name, inS = 0) {
  if (!ctx || !enabled || ctx.state !== "running") return () => {};
  try {
    const at = ctx.currentTime + Math.max(0, inS);
    const srcs = [start(name, at)].flat().filter(Boolean);
    return () => { if (ctx.currentTime < at) srcs.forEach((s) => { try { s.stop(); } catch {} }); };
  } catch { return () => {}; }
}

/* Two short bell tones, like a gym timer: the rest-over sound until the real one has loaded. */
function beep(t0) {
  return [0, 0.22].map((dt, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = i ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + dt);
    o.stop(t0 + dt + 0.55);
    return o;
  });
}
