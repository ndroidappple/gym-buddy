import { useEffect, useState } from "react";
import { ChevronLeft, Copy, Download, KeyRound, Trash2 } from "lucide-react";
import { supabase } from "../supabase-client.js";
import { shortDate } from "../lib/util.js";

/* Settings → AI assistants (#/settings/ai): connect an AI app to this account's log, read-only.
   Step-by-step setup for Claude, ChatGPT and Meta Muse. Only Muse needs a key, so keys are made in
   its first step and listed on its tab.

   Claude and ChatGPT add the MCP server and sign in through /oauth/consent: no key. Muse builds its
   own connector from the OpenAPI description and takes a key. A new key shows once; the database
   keeps only its hash, so afterwards the list shows just its last 4 characters.

   Menu names in the AI apps move around; the steps say where things were in November 2026. */

const APPS = [["claude", "Claude"], ["chatgpt", "ChatGPT"], ["muse", "Muse"]];

async function copy(text, notify, what) {
  try { await navigator.clipboard.writeText(text); notify?.(`${what} copied`); }
  catch { notify?.("Couldn't copy. Try again, or use another browser."); }
}

function CopyButton({ text, label, what, notify }) {
  return (
    <button type="button" className="btn btn-ghost ai-copy" onClick={() => copy(text, notify, what)}>
      <Copy size={17} aria-hidden="true" /> {label}
    </button>
  );
}

function Steps({ items }) {
  return (
    <ol className="steps">
      {items.map((s, n) => (
        <li key={n}><span className="step-n">{n + 1}</span><div className="step-text">{s}</div></li>
      ))}
    </ol>
  );
}

export default function AiAssistants({ back, notify }) {
  const [app, setApp] = useState("claude");
  const [email, setEmail] = useState("");
  const [keys, setKeys] = useState(null);
  const [fresh, setFresh] = useState(null); // { name, key }: the key just made, shown this once
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const origin = location.origin;
  const mcp = `${origin}/api/mcp`;
  const openapi = `${origin}/api/tools/openapi.json`;
  const museMessage = `Connect to my GymBuddy workout log API. Its OpenAPI description is at ${openapi}. It authenticates with an API key sent in the Authorization header as "Bearer <key>". It's read-only. Once connected, call getOverview.`;

  const load = () => supabase.from("api_keys").select("id, name, hint, created_at, last_used_at").order("created_at")
    .then(({ data, error }) => (error ? setError("Couldn't load your keys.") : setKeys(data)));
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || ""));
    load();
  }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError("");
    const label = "Muse";
    const { data, error } = await supabase.rpc("create_api_key", { p_name: label });
    setBusy(false);
    if (error) return setError(error.message);
    setFresh({ name: label, key: data }); load();
  }

  async function remove(k) {
    const { error } = await supabase.from("api_keys").delete().eq("id", k.id);
    if (error) return notify?.("Couldn't delete it. Try again.");
    if (fresh && k.hint === fresh.key.slice(-4)) setFresh(null);
    notify?.(`${k.name} key deleted. Apps using it are cut off.`);
    load();
  }

  // Muse's step 1: the key, shown once just made, else the button that makes it.
  const keyMaker = fresh ? (
    <span className="ai-fresh">
      <code className="ai-key">{fresh.key}</code>
      <span className="muted">It won't be shown again.</span>
      <CopyButton text={fresh.key} label="Tap to copy key" what="Key" notify={notify} />
    </span>
  ) : (
    <form onSubmit={create} className="ai-make">
      <button type="submit" className="btn btn-ink ai-copy" disabled={busy}><KeyRound size={17} aria-hidden="true" /> {busy ? "Making…" : "Make a key"}</button>
    </form>
  );
  const signIn = <>GymBuddy opens. Sign in as <b>{email || "you"}</b> if asked, check the email shown is yours, and tap <b>Allow</b>.</>;
  const steps = {
    claude: [
      <>On <b>claude.ai</b> or in the Claude app, open <b>Settings → Connectors</b>.</>,
      <>Tap <b>Add custom connector</b> and name it <b>GymBuddy</b>.</>,
      <>Paste the server address as the URL, then tap <b>Add</b>.<CopyButton text={mcp} label="Tap to copy server address" what="Server address" notify={notify} /></>,
      <>Tap <b>Connect</b> next to GymBuddy. {signIn}</>,
      <>Start a chat and ask: <b>"How's my bench trending?"</b></>,
    ],
    chatgpt: [
      <>On <b>chatgpt.com</b> (a paid plan), open <b>Settings → Apps &amp; Connectors → Advanced settings</b> and turn on <b>Developer mode</b>.</>,
      <>Back in <b>Apps &amp; Connectors</b>, tap <b>Create</b>, name it <b>GymBuddy</b>, and add the icon if it asks for one.
        <a className="btn btn-ghost ai-copy" href="/icons/connector-128.png" download="GymBuddy.png"><Download size={17} aria-hidden="true" /> Save GymBuddy icon</a></>,
      <>Paste the server address as the <b>MCP server URL</b>, choose <b>OAuth</b>, tick that you trust it, and tap <b>Create</b>.<CopyButton text={mcp} label="Tap to copy server address" what="Server address" notify={notify} /></>,
      signIn,
      <>In a new chat, turn on <b>GymBuddy</b> from the <b>+</b> menu and ask about your training.</>,
    ],
    muse: [
      <>Make a key for Muse, then tap to copy it.{keyMaker}</>,
      <>Start a new chat at <b>muse.ai</b> and paste this message.<CopyButton text={museMessage} label="Tap to copy the message" what="Message" notify={notify} /></>,
      <>When Muse shows a <b>connector card</b>, tap <b>Connect</b> and paste your key.</>,
      <>When Muse offers to <b>save it as a skill</b>, say yes, so GymBuddy is there in every chat.</>,
      <>Ask: <b>"What did I eat on the days I trained this week?"</b></>,
    ],
  };

  return (
    <main className="screen ai-screen">
      <header className="top ruled">
        <button className="icon-btn boxed" onClick={() => back("#/settings")} aria-label="Back"><ChevronLeft size={20} /></button>
        <h1 className="top-title">AI assistants</h1>
        <span className="spacer" />
      </header>
      <div className="body" style={{ paddingTop: 12 }}>
        <p className="muted">Let an AI app read your log: workouts, food, bodyweight and weeks in review. It's read-only, and it only ever sees your account.</p>

        <div className="segctl" role="group" aria-label="AI app">
          {APPS.map(([id, label]) => <button key={id} aria-pressed={app === id} onClick={() => setApp(id)}>{label}</button>)}
        </div>

        <Steps items={steps[app]} />
        {app !== "muse" && <p className="note-box">No key needed: you sign in with your GymBuddy email. To disconnect, remove GymBuddy in {app === "claude" ? "Claude's" : "ChatGPT's"} settings.</p>}
        {app === "chatgpt" && <p className="note-box">Can't find Developer mode? OpenAI moves it around: search ChatGPT's help for "developer mode".</p>}

        {app === "muse" && error && <p className="err" role="alert">{error}</p>}
        {app === "muse" && keys?.length > 0 && (
          <section className="section" aria-labelledby="keys-title">
            <h2 className="lbl" id="keys-title">Your keys</h2>
            <div className="list">
              {keys.map((k) => (
                <div className="list-row" key={k.id}>
                  <KeyRound size={18} aria-hidden="true" />
                  <span className="name">{k.name}<span className="sub">ends {k.hint} · made {shortDate(k.created_at.slice(0, 10))}{k.last_used_at ? ` · used ${shortDate(k.last_used_at.slice(0, 10))}` : ""}</span></span>
                  <button type="button" className="icon-btn" aria-label={`Delete ${k.name} key`} onClick={() => remove(k)}><Trash2 size={18} aria-hidden="true" /></button>
                </div>
              ))}
            </div>
            <p className="muted">Deleting a key cuts off whatever app uses it, right away.</p>
          </section>
        )}
      </div>
    </main>
  );
}
