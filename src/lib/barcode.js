/* Scanning a packaged food's barcode. iPhone Safari has no built-in BarcodeDetector, so the
   `barcode-detector` ponyfill (zxing compiled to WASM) stands in wherever the browser's own can't
   read these formats. It loads only when the scanner opens, and its .wasm is served from this app,
   not a CDN. Codes are compared in one canonical form: GTIN-13 (a 12-digit UPC-A gets a leading 0,
   a UPC-E is expanded first), or the 8 digits of an EAN-8. */

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

/** GS1 check digit for the digits before it. */
function checkDigit(body) {
  let sum = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += +body[i] * w;
  return (10 - (sum % 10)) % 10;
}
const valid = (code) => /^\d+$/.test(code) && checkDigit(code.slice(0, -1)) === +code.slice(-1);

/** An 8-digit UPC-E ("01234565") as its 12-digit UPC-A, or null. */
export function expandUpcE(code) {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [ns, a, b, c, d, e, f, check] = code;
  const mid = f <= "2" ? `${a}${b}${f}0000${c}${d}${e}` : f === "3" ? `${a}${b}${c}00000${d}${e}` : f === "4" ? `${a}${b}${c}${d}00000${e}` : `${a}${b}${c}${d}${e}0000${f}`;
  const upcA = `${ns}${mid}${check}`;
  return valid(upcA) ? upcA : null;
}

/**
 * A scanned or typed barcode in canonical form, or null if it isn't a valid product code.
 * `format` is the detector's ("upc_e" etc.); without it, an 8-digit code is tried as EAN-8, then UPC-E.
 */
export function normalizeBarcode(raw, format) {
  let code = String(raw ?? "").replace(/\D/g, "");
  if (code.length === 8 && (format === "upc_e" || (!format && !valid(code)))) code = expandUpcE(code) || "";
  if (code.length === 14 && code[0] === "0") code = code.slice(1); // GTIN-14 with no packaging level
  if (code.length === 12) code = "0" + code;
  return (code.length === 13 || code.length === 8) && valid(code) ? code : null;
}

/** Whether a food's stored barcode (any form) is this canonical code. */
export const sameBarcode = (stored, code) => !!stored && normalizeBarcode(stored) === code;

/** A food already on this phone with this barcode: one of your saved foods first, else the newest
    entry logged from it (its basis carries the barcode; Open Food Facts entries also keep it as
    source_ref). Returns { kind: "saved" | "entry", item } or null. */
export function foodForBarcode(foods, entries, code) {
  const saved = foods.find((f) => sameBarcode(f.basis?.barcode, code));
  if (saved) return { kind: "saved", item: saved };
  const hits = entries.filter((e) => e.basis && (sameBarcode(e.basis.barcode, code) || (e.source === "off" && sameBarcode(e.source_ref, code))));
  const entry = hits.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
  return entry ? { kind: "entry", item: entry } : null;
}

let detector = null;
async function getDetector() {
  if (detector) return detector;
  const Native = globalThis.BarcodeDetector;
  if (Native) {
    try {
      const have = await Native.getSupportedFormats();
      if (FORMATS.every((f) => have.includes(f))) return (detector = new Native({ formats: FORMATS }));
    } catch {}
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import("barcode-detector/ponyfill"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) } });
  return (detector = new BarcodeDetector({ formats: FORMATS }));
}

/** Why the camera couldn't start, from getUserMedia's error: "denied" | "nocamera". */
export const cameraTrouble = (e) => (e?.name === "NotAllowedError" || e?.name === "SecurityError" ? "denied" : "nocamera");

/**
 * Opens the back camera into `video` and reads barcodes until stopped. `onCode(code)` gets a
 * canonical code once it has been read the same way on two frames in a row (one blurry frame can
 * misread a digit). Resolves { stop, torch } where torch is null or (on) => Promise.
 * Rejects with getUserMedia's error (see cameraTrouble) or the detector's load error.
 */
export async function startScan(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no camera"), { name: "NotFoundError" });
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  let stopped = false;
  const stop = () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    if (video.srcObject === stream) video.srcObject = null;
  };
  try {
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    const det = await getDetector();
    let last = null;
    const tick = async () => {
      if (stopped) return;
      if (video.readyState >= 2) {
        try {
          const hits = await det.detect(video);
          const hit = hits.map((h) => normalizeBarcode(h.rawValue, h.format)).find(Boolean) || null;
          if (hit && hit === last && !stopped) { stop(); onCode(hit); return; }
          last = hit;
        } catch {} // a frame the detector can't use; try the next
      }
      if (!stopped) setTimeout(tick, 150);
    };
    tick();
  } catch (e) {
    stop();
    throw e;
  }
  const track = stream.getVideoTracks()[0];
  const torch = track?.getCapabilities?.().torch ? (on) => track.applyConstraints({ advanced: [{ torch: on }] }) : null;
  return { stop, torch };
}
