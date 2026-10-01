import React, { useCallback, useEffect, useRef, useState } from "react";
import { Flashlight, FlashlightOff, PenLine, ScanBarcode, Keyboard } from "lucide-react";
import { startScan, cameraTrouble, normalizeBarcode, foodForBarcode } from "../lib/barcode.js";
import { searchFoods, SEARCH_TROUBLE } from "../lib/foodSearch.js";

/* Scanning a packaged food. The back camera reads the barcode; the food is looked for on this
   phone first (your saved foods, then foods you've logged), so a rescan works offline, then in the
   food databases. A hit goes to the portion step; a miss offers entering it from the label, which
   remembers the barcode for next time. Typing the number works when the camera can't. */

const TROUBLE = {
  denied: "Camera access is off for GymBuddy. Turn it on in your phone's Settings (Safari › Camera), or type the number under the barcode.",
  nocamera: "Couldn't open a camera here. Type the number under the barcode instead.",
  reader: "The barcode reader didn't load. Check your connection and try again, or type the number.",
};

/** `toFood(x)` maps a saved food or entry to the portion step's shape. */
export default function ScanFood({ food, toFood, onFound, onManual }) {
  const video = useRef(null);
  const cam = useRef(null); // { stop, torch } while the camera is open
  const [state, setState] = useState({ status: "starting" }); // starting | scanning | looking | notfound | trouble | typing
  const [torchOn, setTorchOn] = useState(false);
  const [typed, setTyped] = useState("");
  const [typedBad, setTypedBad] = useState(false);
  // Each camera start gets a number; anything that finishes after a newer start (or after closing)
  // sees a different number and stands down. Callbacks are read through a ref so a parent's
  // re-render never restarts the camera.
  const run = useRef(0);
  const statusRef = useRef("starting");
  statusRef.current = state.status;
  const props = useRef({ food, toFood, onFound });
  props.current = { food, toFood, onFound };

  const lookUp = useCallback(async (code) => {
    const my = ++run.current;
    navigator.vibrate?.(30);
    setState({ status: "looking", code });
    const { food: { foods, entries }, toFood: map, onFound: found } = props.current;
    const mine = foodForBarcode(foods, entries, code);
    if (mine) return found(map(mine));
    try {
      const r = await searchFoods({ barcode: code });
      if (my !== run.current) return;
      if (r.results?.length) props.current.onFound(r.results[0]);
      else setState(r.partial ? { status: "trouble", kind: "busy", code } : { status: "notfound", code });
    } catch (e) {
      if (my === run.current) setState({ status: "trouble", kind: e.kind || "busy", code });
    }
  }, []);

  const stopCamera = useCallback(() => { run.current++; cam.current?.stop(); cam.current = null; setTorchOn(false); }, []);
  const start = useCallback(async () => {
    stopCamera();
    const my = run.current;
    setState({ status: "starting" });
    try {
      const c = await startScan(video.current, (code) => { if (my === run.current) { cam.current = null; lookUp(code); } });
      if (my !== run.current) return c.stop();
      cam.current = c;
      setState({ status: "scanning" });
    } catch (e) {
      if (my !== run.current) return;
      const kind = e?.name && /^(NotAllowed|Security|NotFound|Overconstrained|NotReadable|Abort)Error$/.test(e.name) ? cameraTrouble(e) : "reader";
      setState({ status: "trouble", kind });
    }
  }, [lookUp, stopCamera]);

  useEffect(() => {
    start();
    // The camera stays off while the app is in the background, and comes back if still scanning.
    const onVis = () => {
      const scanning = statusRef.current === "scanning" || statusRef.current === "starting";
      if (document.visibilityState === "hidden") { if (scanning) { stopCamera(); setState({ status: "starting" }); } }
      else if (scanning) start();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); stopCamera(); };
  }, [start, stopCamera]);

  const toggleTorch = async () => {
    try { await cam.current?.torch?.(!torchOn); setTorchOn(!torchOn); } catch {}
  };
  const submitTyped = (e) => {
    e.preventDefault();
    const code = normalizeBarcode(typed);
    if (!code) { setTypedBad(true); return; }
    lookUp(code);
  };
  const typing = () => { stopCamera(); setTypedBad(false); setState({ status: "typing" }); };

  const { status, code, kind } = state;
  const live = status === "starting" || status === "scanning";
  return (
    <div className="scan">
      <div className="scan-view" hidden={!live}>
        <video ref={video} playsInline muted aria-label="Camera view" />
        <div className="scan-frame" aria-hidden="true" />
        {cam.current?.torch && (
          <button type="button" className="icon-btn scan-torch" onClick={toggleTorch} aria-pressed={torchOn} aria-label={torchOn ? "Turn light off" : "Turn light on"}>
            {torchOn ? <FlashlightOff size={20} /> : <Flashlight size={20} />}
          </button>
        )}
      </div>
      <p className="small muted" aria-live="polite">
        {status === "starting" && "Opening the camera…"}
        {status === "scanning" && "Point the camera at the barcode."}
        {status === "looking" && `Looking up ${code}…`}
      </p>

      {status === "notfound" && (
        <div className="scan-msg" role="status">
          <p><b>Not in the food databases yet.</b> Enter it from the label once; scanning {code} finds it next time.</p>
          <button type="button" className="btn btn-ink" onClick={() => onManual(code)}><PenLine size={18} aria-hidden="true" /> Enter from the label</button>
          <button type="button" className="btn-quiet" onClick={start}><ScanBarcode size={16} aria-hidden="true" style={{ verticalAlign: -3 }} /> Scan another</button>
        </div>
      )}
      {status === "trouble" && (
        <div className="scan-msg" role="alert">
          <p>{TROUBLE[kind] || (kind === "offline" ? "No connection, so I can't look that barcode up. Enter it from the label, or try again when you're back online." : SEARCH_TROUBLE[kind] || SEARCH_TROUBLE.busy)}</p>
          {code
            ? <><button type="button" className="btn btn-ink" onClick={() => lookUp(code)}>Try again</button>
              <button type="button" className="btn-quiet" onClick={() => onManual(code)}><PenLine size={16} aria-hidden="true" style={{ verticalAlign: -3 }} /> Enter from the label</button></>
            : kind === "reader" && <button type="button" className="btn btn-ink" onClick={start}>Try again</button>}
        </div>
      )}

      {status === "typing" || (status === "trouble" && !code)
        ? (
          <form className="food-form" onSubmit={submitTyped}>
            <label className="field"><span className="lbl">Barcode number</span>
              <input className="input tn" inputMode="numeric" autoComplete="off" autoFocus={status === "typing"} value={typed} maxLength={18}
                onChange={(e) => { setTyped(e.target.value); setTypedBad(false); }} placeholder="The digits under the bars" aria-invalid={typedBad} /></label>
            {typedBad && <p className="setup-hint" role="alert">That isn't a full barcode. Check the digits, including the small ones at each end.</p>}
            <button type="submit" className="btn btn-ink" disabled={!typed.replace(/\D/g, "")}>Look it up</button>
            {status === "typing" && <button type="button" className="btn-quiet" onClick={start}><ScanBarcode size={16} aria-hidden="true" style={{ verticalAlign: -3 }} /> Use the camera</button>}
          </form>
        )
        : live && <button type="button" className="btn-quiet" onClick={typing}><Keyboard size={16} aria-hidden="true" style={{ verticalAlign: -3 }} /> Type the number instead</button>}
    </div>
  );
}
