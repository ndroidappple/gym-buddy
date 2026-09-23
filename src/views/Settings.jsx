import React, { useEffect, useState } from "react";
import { ChevronRight, Download, LogOut } from "lucide-react";
import { DAYS } from "../data/program.js";
import { href } from "../lib/router.js";
import { supabase } from "../supabase-client.js";

export default function Settings({ program, sessions }) {
  const [email, setEmail] = useState("");
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || "")); }, []);

  return (
    <main className="screen has-tabs">
      <header className="top"><h1 className="page-title">Settings</h1></header>
      <div className="body">
        <section className="section">
          <h2 className="lbl">Program</h2>
          <div className="list">
            {DAYS.map((d) => (
              <a key={d} className="list-row" href={href("settings", "program", d)} data-day={d}>
                <span className="dot" aria-hidden="true" />
                <span className="name">{program[d].name}<span className="sub">{program[d].detail} · {program[d].exercises.length} lifts</span></span>
                <ChevronRight size={18} aria-hidden="true" className="muted" />
              </a>
            ))}
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Data</h2>
          <div className="list">
            <a className="list-row" href="#/settings/export">
              <Download size={18} aria-hidden="true" />
              <span className="name">Export<span className="sub">{sessions.length} sessions as CSV or JSON</span></span>
              <ChevronRight size={18} aria-hidden="true" className="muted" />
            </a>
          </div>
        </section>

        <section className="section">
          <h2 className="lbl">Account</h2>
          <div className="list">
            <div className="list-row"><span className="name">Signed in<span className="sub">{email || "—"}</span></span></div>
            <button className="list-row" onClick={() => supabase.auth.signOut()}>
              <LogOut size={18} aria-hidden="true" />
              <span className="name">Sign out<span className="sub">Your data stays saved to your account.</span></span>
            </button>
          </div>
        </section>

        <p className="small muted">Light and dark follow your phone's setting. Weights are in pounds.</p>
      </div>
    </main>
  );
}
