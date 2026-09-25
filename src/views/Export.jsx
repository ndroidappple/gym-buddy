import React, { useMemo, useState } from "react";
import { InfoButton } from "../components/ui.jsx";
import { ChevronLeft, Download, Copy } from "lucide-react";
import { e1rm, num, today, byDateAsc } from "../lib/util.js";

export default function Export({ sessions, program, weighins, back, notify }) {
  const [fmt, setFmt] = useState("csv");

  const csv = useMemo(() => {
    const rows = [["date", "day", "exercise", "set", "weight_lbs", "reps", "rir", "est_1rm", "minutes", "miles", "bodyweight_lbs", "note"]];
    [...sessions].sort(byDateAsc).forEach((s) => {
      Object.entries(s.sets).forEach(([n, sets]) => {
        sets.forEach((x, i) => rows.push([
          s.date, program[s.day]?.name || s.day, n, i + 1, x.w ?? "", x.r ?? "", x.rir ?? "",
          x.min != null ? "" : num(e1rm(x.w, x.r)), x.min ?? "", x.mi ?? "", s.bw ?? "", s.note || "",
        ]));
      });
    });
    (weighins || []).forEach((w) => rows.push([w.date, "Weigh-in", "", "", "", "", "", "", "", "", w.bw, ""]));
    const cell = (c) => { const v = String(c); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    return rows.map((r) => r.map(cell).join(",")).join("\n");
  }, [sessions, program, weighins]);

  const json = useMemo(() => JSON.stringify({ exportedAt: new Date().toISOString(), sessions, weighins }, null, 2), [sessions, weighins]);
  const payload = fmt === "csv" ? csv : json;

  const copy = async () => {
    try { await navigator.clipboard.writeText(payload); notify("Copied to clipboard"); }
    catch { notify("Copy blocked. Select the text below instead."); }
  };

  const download = () => {
    try {
      const blob = new Blob([payload], { type: fmt === "csv" ? "text/csv" : "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gymbuddy-${today()}.${fmt}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Download started");
    } catch { notify("Download blocked. Use Copy instead."); }
  };

  return (
    <main className="screen">
      <header className="top ruled">
        <button className="icon-btn boxed" onClick={() => back("#/settings")} aria-label="Back"><ChevronLeft size={20} /></button>
        <h1 className="top-title">Export</h1>
        <span className="spacer" />
        <InfoButton screen="export" />
      </header>
      <div className="body" style={{ paddingTop: 12 }}>
        <p className="muted">Your sessions are saved to your GymBuddy account and sync across devices. Export a copy whenever you want one you control. CSV opens straight in Sheets or Excel.</p>
        <div className="segctl" role="group" aria-label="Format">
          {["csv", "json"].map((f) => <button key={f} aria-pressed={fmt === f} onClick={() => setFmt(f)}>{f.toUpperCase()}</button>)}
        </div>
        <div className="btn-row">
          <button className="btn btn-ink" onClick={download}><Download size={18} aria-hidden="true" /> Download</button>
          <button className="btn btn-ghost" onClick={copy}><Copy size={17} aria-hidden="true" /> Copy</button>
        </div>
        <label className="field"><span className="sr-only">Export preview</span>
          <textarea id="export-preview" readOnly value={payload} className="export-box" onFocus={(e) => e.target.select()} /></label>
      </div>
    </main>
  );
}
