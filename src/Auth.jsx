import { useEffect, useState } from "react";
import { supabase } from "./supabase-client.js";
import { Boot } from "./components/ui.jsx";

/** Single-user gate: magic-link sign-in, no signup. Renders children once a Supabase session exists. */
export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined);
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const standalone = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone);

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
    else { setCode(""); setState("sent"); }
  }

  async function verifyCode(e) {
    e.preventDefault();
    setError("");
    setVerifying(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    setVerifying(false);
    if (error) setError("That code didn't work. It may have expired, so tap Resend for a new one.");
  }

  return (
    <main className="auth" data-day="push">
      <div className="boot" style={{ minHeight: 0, justifyItems: "start" }} aria-hidden="true"><div className="plates"><i /><i /><i /><i /></div></div>
      <h1>Iron<br />log</h1>
      {state === "sent" ? (
        <div className="section" role="status" style={{ gap: 14 }}>
          <p style={{ fontSize: 18 }}>We emailed <b>{email}</b>. Enter the code from the email here{standalone ? "" : ", or tap the link in it on this device"}.</p>
          <form onSubmit={verifyCode} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label className="field"><span className="lbl">Sign-in code</span>
              <input id="auth-code" className="input tn" inputMode="numeric" autoComplete="one-time-code" maxLength={10}
                style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 32, letterSpacing: "0.2em", textAlign: "center" }}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></label>
            <button type="submit" className="btn btn-day" disabled={code.length < 6 || verifying}>{verifying ? "Checking…" : "Sign in"}</button>
            {error && <p className="err" role="alert">{error}</p>}
          </form>
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
