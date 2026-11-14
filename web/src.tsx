import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
async function api(path: string, body?: unknown) {
  const r = await fetch(
    "/api" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.message);
  return data;
}
function Json({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}
function App() {
  const [view, setView] = useState("runs"),
    [runs, setRuns] = useState<any[]>([]),
    [pending, setPending] = useState<any[]>([]),
    [trace, setTrace] = useState<any>(null),
    [policy, setPolicy] = useState<any>(null),
    [name, setName] = useState(localStorage.getItem("approver") ?? ""),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [replay, setReplay] = useState<any>(null);
  async function refresh() {
    const [r, p, c] = await Promise.all([
      api("/runs"),
      api("/approvals/pending"),
      api("/policy"),
    ]);
    setRuns(r);
    setPending(p);
    setPolicy(c);
    if (trace) setTrace(await api("/runs/" + trace.id));
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(
      () => void refresh().catch((e) => setError(e.message)),
      3000,
    );
    return () => clearInterval(timer);
  }, [trace?.id]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    setTrace(await api("/runs/" + id));
    setReplay(null);
    setView("trace");
  }
  async function decide(step: any, which: string) {
    await action(async () => {
      localStorage.setItem("approver", name);
      const t = await api(`/steps/${step.id}/${which}`, {
        approver_name: name,
        note,
      });
      setNote("");
      await refresh();
      setTrace(t);
    });
  }
  const badge = (text: string) => (
    <span className={"badge " + text.toLowerCase()}>
      {text.replaceAll("_", " ")}
    </span>
  );
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="#" onClick={() => setView("runs")}>
          <span className="mark">T</span>tracegate
          <span className="version">v1</span>
        </a>
        <p className="aside-label">CONTROL ROOM</p>
        <nav>
          <button
            className={view === "runs" ? "selected" : ""}
            onClick={() => setView("runs")}
          >
            ◫ <span>Runs</span>
            <small>{runs.length}</small>
          </button>
          <button
            className={view === "trace" ? "selected" : ""}
            onClick={() => setView("trace")}
          >
            ≡ <span>Trace viewer</span>
          </button>
          <button
            className={view === "approvals" ? "selected" : ""}
            onClick={() => setView("approvals")}
          >
            ◇ <span>Approval queue</span>
            <small>{pending.length}</small>
          </button>
        </nav>
        <div className="guard">
          <i /> Deterministic guard
          <p>
            No LLM in the middle layer.
            <br />
            Local effects only.
          </p>
        </div>
      </aside>
      <main>
        <header>
          <span>WORKSPACE / LOCAL SANDBOX</span>
          <span className="live">● Postgres backed</span>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {view === "runs" && (
          <>
            <div className="heading">
              <div>
                <p className="eyebrow">OBSERVE & CONTROL</p>
                <h1>Agent runs</h1>
                <p>Every proposal. Every decision. A complete record.</p>
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    const r = await api("/runs", {
                      scenario: "outreach-research",
                    });
                    await open(r.id);
                    await refresh();
                  })
                }
              >
                ＋ Start demo run
              </button>
            </div>
            <div className="stats">
              <article>
                <span>Total runs</span>
                <strong>{runs.length}</strong>
              </article>
              <article>
                <span>Awaiting a decision</span>
                <strong>{pending.length}</strong>
              </article>
              <article>
                <span>Blocked proposals</span>
                <strong>{runs.reduce((n, r) => n + r.blocked, 0)}</strong>
              </article>
            </div>
            <section>
              <div className="section-title">
                <h2>Run history</h2>
                <span>outreach-research · scripted agent</span>
              </div>
              {runs.length === 0 ? (
                <div className="empty">
                  <h3>Your first trace starts here</h3>
                  <p>
                    Start the demo to follow seven proposals through the policy
                    gate.
                  </p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Scenario / run</th>
                        <th>Status</th>
                        <th>Started</th>
                        <th>Outcomes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <button
                              className="link"
                              onClick={() => action(() => open(r.id))}
                            >
                              {r.scenario}
                            </button>
                            <small>{r.id.slice(0, 8)}</small>
                          </td>
                          <td>{badge(r.status)}</td>
                          <td>{new Date(r.started_at).toLocaleString()}</td>
                          <td className="counts">
                            {r.allowed} allowed · {r.blocked} blocked
                            <br />
                            {r.approved} approved · {r.rejected} rejected ·{" "}
                            {r.failed} failed
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <details>
              <summary>Active policy · read only</summary>
              <Json value={policy} />
            </details>
          </>
        )}
        {view === "trace" && (
          <>
            <div className="heading">
              <div>
                <p className="eyebrow">EXECUTION RECORD</p>
                <h1>Trace viewer</h1>
                <p>
                  {trace
                    ? trace.scenario + " / " + trace.id
                    : "Choose a run from the runs list."}
                </p>
              </div>
              {trace && (
                <button
                  disabled={
                    busy || !["completed", "failed"].includes(trace.status)
                  }
                  onClick={() =>
                    action(async () =>
                      setReplay(await api(`/runs/${trace.id}/replay`, {})),
                    )
                  }
                >
                  ↻ Replay trace
                </button>
              )}
            </div>
            {trace && (
              <>
                <div className="trace-summary">
                  {badge(trace.status)}
                  <span>
                    Started {new Date(trace.started_at).toLocaleString()}
                  </span>
                  <span>{trace.steps.length} recorded proposals</span>
                </div>
                {replay && (
                  <section className="replay">
                    <h2>Replay {replay.match ? "matches" : "differs"}</h2>
                    <p>
                      Recorded results and approvals reused. No tools executed.
                    </p>
                    <Json value={replay} />
                  </section>
                )}
                <div className="timeline">
                  {trace.steps.map((s: any) => (
                    <article className={"step " + s.status} key={s.id}>
                      <div className="step-number">
                        {String(s.step_index).padStart(2, "0")}
                      </div>
                      <div className="step-content">
                        <div className="step-title">
                          <h2>{s.tool_name}</h2>
                          {badge(
                            s.status === "succeeded" && s.approval
                              ? "approved"
                              : s.status === "succeeded"
                                ? "allowed"
                                : s.status,
                          )}
                          {s.status === "failed" && badge(s.policy_decision)}
                        </div>
                        <p className="reason">{s.reason_text}</p>
                        <div className="rule">
                          {s.reason_code} <span> / {s.rule_fired}</span>
                        </div>
                        <h3>Full arguments</h3>
                        <Json value={s.arguments} />
                        {s.approval && (
                          <>
                            <h3>Human decision</h3>
                            <Json value={s.approval} />
                          </>
                        )}
                        {s.tool_result !== null && (
                          <>
                            <h3>Recorded result</h3>
                            <Json value={s.tool_result} />
                          </>
                        )}
                        {s.error && <div className="error">{s.error}</div>}
                        {s.status === "waiting_for_approval" && (
                          <button onClick={() => setView("approvals")}>
                            Review in approval queue →
                          </button>
                        )}
                        <div className="timestamps">
                          Proposed {new Date(s.proposed_at).toLocaleString()} ·
                          Decided {new Date(s.decided_at).toLocaleString()}
                          {s.executed_at &&
                            " · Executed " +
                              new Date(s.executed_at).toLocaleString()}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {view === "approvals" && (
          <>
            <div className="heading">
              <div>
                <p className="eyebrow">HUMAN IN CONTROL</p>
                <h1>
                  Approval queue <em>{pending.length}</em>
                </h1>
                <p>Review the full call before allowing a local side effect.</p>
              </div>
            </div>
            <div className="identity">
              <label>
                Approver name
                <input
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Decision note (optional)
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Reason for your decision"
                />
              </label>
            </div>
            {pending.length === 0 ? (
              <section className="empty">
                <h3>No decisions waiting</h3>
                <p>High risk proposals will appear here before execution.</p>
              </section>
            ) : (
              pending.map((s) => (
                <section className="approval" key={s.id}>
                  <div className="step-title">
                    <h2>{s.tool_name}</h2>
                    {badge("approval_required")}
                  </div>
                  <p>
                    {s.scenario} · Step {s.step_index}
                  </p>
                  <p>{s.reason_text}</p>
                  <div className="rule">
                    {s.reason_code} / {s.rule_fired}
                  </div>
                  <h3>Full arguments</h3>
                  <Json value={s.arguments} />
                  <div className="actions">
                    <button
                      className="primary"
                      disabled={busy || !name.trim()}
                      onClick={() => decide(s, "approve")}
                    >
                      Approve & execute
                    </button>
                    <button
                      className="danger"
                      disabled={busy || !name.trim()}
                      onClick={() => decide(s, "reject")}
                    >
                      Reject
                    </button>
                    <button
                      className="link"
                      onClick={() => action(() => open(s.run_id))}
                    >
                      View trace →
                    </button>
                  </div>
                </section>
              ))
            )}
          </>
        )}
        <footer>
          TRACEGATE / Structured calls in. Deterministic decisions out.
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
