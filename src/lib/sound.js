let ctx = null;
let enabled = true;
/** The rest-timer chime follows the Settings switch (App calls this from prefs). */
export const setSound = (on) => { enabled = on !== false; };

/** Call from a user gesture (e.g. "Log set") so mobile browsers allow audio later. */
export function primeAudio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  } catch {}
}

/** Two short bell tones, like a gym timer. */
export function chime() {
  if (!ctx || !enabled) return;
  try {
    const t0 = ctx.currentTime;
    [0, 0.22].forEach((dt, i) => {
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
    });
  } catch {}
}
