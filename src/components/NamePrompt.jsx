import React, { useEffect, useState } from "react";
import { supabase } from "../supabase-client.js";
import { Sheet } from "./ui.jsx";
import Coach from "./Coach.jsx";

/* Asks for a first name once per account, right after sign-in. The answer (or a "Not now")
   lives in the Supabase user's metadata, so it follows the email to every device. */
export default function NamePrompt({ onName }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata || {};
      if (meta.first_name) onName(meta.first_name);
      else if (data.user && !meta.name_asked) setOpen(true);
    });
  }, [onName]);

  const finish = async (first) => {
    setSaving(true);
    setOpen(false);
    if (first) onName(first);
    // Saved even when skipped, so the question never comes back.
    await supabase.auth.updateUser({ data: first ? { first_name: first, name_asked: true } : { name_asked: true } }).catch(() => {});
  };
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);

  if (!open) return null;
  return (
    <Sheet title="What should we call you?" sub="Just your first name. Your coaches will use it." onClose={() => finish(null)} labelledBy="name-title">
      <div style={{ display: "grid", placeItems: "center" }}><Coach id="tank" mood="hyped" size={76} decorative /></div>
      <form onSubmit={(e) => { e.preventDefault(); if (clean) finish(clean); }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label className="field"><span className="lbl">First name</span>
          <input id="first-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" autoCapitalize="words" enterKeyHint="done" maxLength={40} placeholder="e.g. Sam" /></label>
        <button className="btn btn-ink" type="submit" disabled={!clean || saving}>Save</button>
        <button className="btn-quiet" type="button" onClick={() => finish(null)}>Not now</button>
      </form>
    </Sheet>
  );
}
