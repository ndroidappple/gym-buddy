import { useEffect, useState } from "react";
import { supabase } from "./supabase-client.js";
import { Boot } from "./components/ui.jsx";

/* The consent screen for connecting GymBuddy to Claude (or another MCP client), at /oauth/consent.
   Supabase Auth sends the lifter here with ?authorization_id=… after Claude asks to connect;
   AuthGate has already made sure they're signed in. Approving hands Claude a token for this
   account only, read through api/mcp.js. The signed-in email is front and centre so nobody
   approves on a phone that's signed in as someone else. */

const WHAT = ["Workouts, sets and lift history", "Your program and goals", "Food log and nutrition targets", "Bodyweight", "Weeks in review"];

export default function OAuthConsent() {
  const id = new URLSearchParams(location.search).get("authorization_id");
  const [details, setDetails] = useState(null);
  const [error, setError] = useState(id ? "" : "This link is missing its request. Start connecting again from Claude.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    supabase.auth.oauth.getAuthorizationDetails(id).then(({ data, error }) => {
      if (error) return setError(`${error.message}. Start connecting again from Claude.`);
      // Approved before: Supabase sends back the redirect straight away.
      if (data && !("authorization_id" in data) && data.redirect_url) return location.assign(data.redirect_url);
      setDetails(data);
    });
  }, [id]);

  async function decide(approve) {
    setBusy(true);
    const fn = approve ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization;
    const { data, error } = await fn.call(supabase.auth.oauth, id, { skipBrowserRedirect: true });
    if (error) { setBusy(false); return setError(error.message); }
    location.assign(data.redirect_url);
  }

  if (!details && !error) return <Boot />;
  const client = details?.client?.name || "An app";

  return (
    <main className="auth" data-day="push">
      <h1>Gym<br />Buddy</h1>
      {error ? <p className="err" role="alert">{error}</p> : (
        <div className="section" style={{ gap: 14 }}>
          <p style={{ fontSize: 18 }}><b>{client}</b> wants to read your GymBuddy log.</p>
          <p>Signed in as <b>{details.user?.email}</b>. It will see this account's data, nobody else's.</p>
          <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>{WHAT.map((w) => <li key={w}>{w}</li>)}</ul>
          <p className="muted">Read-only: it can't log, edit or delete anything.</p>
          <div className="btn-row" style={{ flexDirection: "column", gap: 10 }}>
            <button className="btn btn-day" disabled={busy} onClick={() => decide(true)}>{busy ? "Connecting…" : "Allow"}</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => decide(false)}>Deny</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => supabase.auth.signOut()}>Not you? Sign out</button>
          </div>
        </div>
      )}
    </main>
  );
}
