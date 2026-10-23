import React from "react";

/* When something on screen throws while drawing, React clears the whole app: a blank screen with no
   way back. This catches it instead. The full version (around the app) says what went wrong, with the
   error's own words so a screenshot shows the cause, and offers a way back to Today or a reload.
   The quiet version (around one part, e.g. the heart rate section) just leaves that part out with a
   line saying so, and the rest of the screen carries on. */
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(this.props.quiet ? `${this.props.quiet} failed to draw` : "GymBuddy hit an error", error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    // Moving to another screen gives it a fresh try.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const detail = `${error.name || "Error"}: ${error.message || String(error)}`;
    if (this.props.quiet) return <p className="small muted">Couldn't show {this.props.quiet} here. ({detail})</p>;
    return (
      <main className="screen">
        <div className="body crash">
          <h1 className="page-title">Something went wrong</h1>
          <p>GymBuddy hit a problem drawing this screen. Your workouts and food are saved.</p>
          <p className="note-box crash-detail">{detail}</p>
          <button type="button" className="btn btn-ink" onClick={() => { location.hash = "#/today"; this.setState({ error: null }); }}>Back to Today</button>
          <button type="button" className="btn btn-ghost" onClick={() => location.reload()}>Reload GymBuddy</button>
          <p className="small muted">If it keeps happening, a screenshot of this screen shows what broke.</p>
        </div>
      </main>
    );
  }
}
