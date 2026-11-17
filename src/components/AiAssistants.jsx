import { useEffect, useState } from "react";
import { Copy, KeyRound, Trash2, Plug, FileJson } from "lucide-react";
import { Sheet } from "./ui.jsx";
import { supabase } from "../supabase-client.js";
import { shortDate } from "../lib/util.js";

/* Settings → AI assistants: how to connect any AI app to this account's log (read-only).
   MCP apps sign in on their own with the server address; apps that want a fixed key get one here.
   A new key shows once, then only its last 4 characters (the database keeps just its hash). */

const copy = async (text, notify, what) => {
  try { await navigator.clipboard.writeText(text); notify?.(`${what} copied`); }
  catch { notify?.("Couldn't copy. Press and hold to select it."); }
};

function CopyRow({ Icon, label, sub, value, notify }) {
  return (
    <button type="button" className="list-row" onClick={() => copy(value, notify, label)}>
      <Icon size={18} aria-hidden="true" />
      <span className="name">{label}<span className="sub" style={{ wordBreak: "break-all" }}>{value}</span>{sub && <span className="sub">{sub}</span>}</span>
      <Copy size={16} aria-hidden="true" className="muted" />
    </button>
  );
}

export default function AiAssistantsSheet({ notify, onClose }) {
  const [keys, setKeys] = useState(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState(null); // { name, key }: the key just made, shown this once
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mcp = `${location.origin}/api/mcp`;

  const load = () => supabase.from("api_keys").select("id, name, hint, created_at, last_used_at").order("created_at")
    .then(({ data, error }) => (error ? setError("Couldn't load your keys.") : setKeys(data)));
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError("");
    const label = name.trim() || "AI assistant";
    const { data, error } = await supabase.rpc("create_api_key", { p_name: label });
    setBusy(false);
    if (error) return setError(error.message);
    setFresh({ name: label, key: data }); setName(""); load();
  }

  async function remove(k) {
    const { error } = await supabase.from("api_keys").delete().eq("id", k.id);
    if (error) return notify?.("Couldn't delete it. Try again.");
    notify?.(`${k.name} key deleted. Apps using it are cut off.`);
    load();
  }

  return (
    <Sheet title="AI assistants" sub="Let an AI app read your log: workouts, food, bodyweight and weeks in review. Read-only, and only your account." onClose={onClose} labelledBy="ai-title">
      <h3 className="lbl">Apps that connect with sign-in</h3>
      <div className="list">
        <CopyRow Icon={Plug} label="Server address" value={mcp} notify={notify}
          sub="Claude, ChatGPT and other apps that take an MCP server: add it as a custom connector and sign in with this email." />
      </div>

      <h3 className="lbl">Apps that want a key</h3>
      {fresh && (
        <div className="note-box" role="status">
          <b>Your {fresh.name} key.</b> Copy it now: it won't be shown again. Give it to the app as <code>Authorization: Bearer</code>, with the server address above or the API below.
          <button type="button" className="list-row" style={{ marginTop: 8 }} onClick={() => copy(fresh.key, notify, "Key")}>
            <KeyRound size={18} aria-hidden="true" /><span className="name" style={{ wordBreak: "break-all", fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{fresh.key}</span><Copy size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {keys?.length > 0 && (
        <div className="list">
          {keys.map((k) => (
            <div className="list-row" key={k.id}>
              <KeyRound size={18} aria-hidden="true" />
              <span className="name">{k.name}<span className="sub">…{k.hint} · made {shortDate(k.created_at.slice(0, 10))}{k.last_used_at ? ` · used ${shortDate(k.last_used_at.slice(0, 10))}` : " · not used yet"}</span></span>
              <button type="button" className="icon-btn" aria-label={`Delete ${k.name} key`} onClick={() => remove(k)}><Trash2 size={18} aria-hidden="true" /></button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={create} style={{ display: "flex", gap: 10 }}>
        <input className="input" style={{ flex: 1 }} maxLength={60} placeholder="Name it, e.g. Muse" value={name} onChange={(e) => setName(e.target.value)} aria-label="Key name" />
        <button type="submit" className="btn btn-ink" style={{ flex: "none" }} disabled={busy}>{busy ? "Making…" : "Make a key"}</button>
      </form>
      {error && <p className="err" role="alert">{error}</p>}

      <div className="list">
        <CopyRow Icon={FileJson} label="API description (OpenAPI)" value={`${location.origin}/api/tools/openapi.json`} notify={notify}
          sub="For apps that call a web API instead: custom GPT actions, assistants that write their own connector." />
      </div>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Done</button>
    </Sheet>
  );
}
