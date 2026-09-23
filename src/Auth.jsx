import { useEffect, useState } from "react";
import { supabase } from "./supabase-client.js";
import { Boot } from "./components/ui.jsx";

/** Single-user gate: magic-link sign-in, no signup. Renders children once a Supabase session exists. */
export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined);
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <Boot />;
  if (session) return children;

  async function sendLink(e) {
    e?.preventDefault();
    setError("");
    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
    if (error) { setError(`${error.message}. Check the address and try again.`); setState("idle"); }
    else setState("sent");
  }

  return (
    <main className="auth" data-day="push">
      <div className="boot" style={{ minHeight: 0, justifyItems: "start" }} aria-hidden="true"><div className="plates"><i /><i /><i /><i /></div></div>
      <h1>Iron<br />log</h1>
      {state === "sent" ? (
        <div className="section" role="status">
          <p style={{ fontSize: 18 }}>Check <b>{email}</b> for a sign-in link. Open it on this device.</p>
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={() => sendLink()}>Resend</button>
            <button className="btn btn-ghost" onClick={() => setState("idle")}>Change email</button>
          </div>
        </div>
      ) : (
        <form onSubmit={sendLink}>
          <label className="field"><span className="lbl">Email</span>
            <input id="auth-email" className="input" type="email" required autoComplete="email" placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button type="submit" className="btn btn-day" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send sign-in link"}</button>
          {error && <p className="err" role="alert">{error}</p>}
        </form>
      )}
    </main>
  );
}
