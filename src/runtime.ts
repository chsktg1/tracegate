import type { Pool, PoolClient } from "pg";
import { evaluate, type Policy } from "./policy.js";
import { execute } from "./tools.js";
import type { Call, ToolName } from "./registry.js";
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export class Runtime {
  constructor(
    public db: Pool,
    public policy: Policy,
  ) {}
  async transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.db.connect();
    try {
      await db.query("BEGIN");
      const value = await fn(db);
      await db.query("COMMIT");
      return value;
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async start(name: string, calls: Call[]) {
    const id = await this.transaction(async (db) => {
      const {
        rows: [run],
      } = await db.query(
        "INSERT INTO runs(scenario,status,policy,proposals) VALUES($1,'running',$2,$3) RETURNING *",
        [name, this.policy, JSON.stringify(calls)],
      );
      await this.advance(db, run);
      return run.id;
    });
    return this.trace(id);
  }
  async trace(id: string) {
    const {
      rows: [run],
    } = await this.db.query("SELECT * FROM runs WHERE id=$1", [id]);
    if (!run) throw new ApiError("RUN_NOT_FOUND", "Run not found", 404);
    const { rows: steps } = await this.db.query(
      "SELECT s.*,row_to_json(a) AS approval FROM steps s LEFT JOIN approvals a ON a.step_id=s.id WHERE s.run_id=$1 ORDER BY s.step_index",
      [id],
    );
    return { ...run, steps };
  }
  async list() {
    return (
      await this.db
        .query(`SELECT r.id,r.scenario,r.status,r.started_at,r.finished_at,
 count(s.id)::int AS total,count(*) FILTER(WHERE s.policy_decision='ALLOW')::int AS allowed,
 count(*) FILTER(WHERE s.status='blocked')::int AS blocked,
 count(*) FILTER(WHERE a.decision='approved')::int AS approved,
 count(*) FILTER(WHERE s.status='rejected')::int AS rejected,
 count(*) FILTER(WHERE s.status='failed')::int AS failed
 FROM runs r LEFT JOIN steps s ON s.run_id=r.id LEFT JOIN approvals a ON a.step_id=s.id GROUP BY r.id ORDER BY r.started_at DESC`)
    ).rows;
  }
  async pending() {
    return (
      await this.db.query(
        "SELECT s.*,r.scenario FROM steps s JOIN runs r ON r.id=s.run_id WHERE s.status='waiting_for_approval' ORDER BY s.proposed_at",
      )
    ).rows;
  }
  private async runTool(db: PoolClient, step: any, p: Policy) {
    await db.query(
      "UPDATE steps SET status='executing',executed_at=clock_timestamp() WHERE id=$1",
      [step.id],
    );
    // A failed SQL tool must not abort the trace transaction: recover at the savepoint.
    await db.query("SAVEPOINT tool_execution");
    try {
      const output = await execute(
        db,
        step.tool_name as ToolName,
        step.arguments,
        step.id,
        p,
      );
      await db.query(
        "UPDATE steps SET status='succeeded',tool_result=$2 WHERE id=$1",
        [step.id, JSON.stringify(output)],
      );
      await db.query("RELEASE SAVEPOINT tool_execution");
    } catch (e) {
      await db.query("ROLLBACK TO SAVEPOINT tool_execution");
      await db.query("RELEASE SAVEPOINT tool_execution");
      await db.query("UPDATE steps SET status='failed',error=$2 WHERE id=$1", [
        step.id,
        e instanceof Error ? e.message : String(e),
      ]);
    }
  }
  private async advance(db: PoolClient, run: any) {
    const {
      rows: [{ count }],
    } = await db.query(
      "SELECT count(*)::int AS count FROM steps WHERE run_id=$1",
      [run.id],
    );
    for (let i = count; i < run.proposals.length; i++) {
      const call = run.proposals[i] as Call;
      const {
        rows: [step],
      } = await db.query(
        "INSERT INTO steps(run_id,step_index,tool_name,arguments,status) VALUES($1,$2,$3,$4,'proposed') RETURNING *",
        [run.id, i + 1, call.tool, JSON.stringify(call.arguments ?? null)],
      );
      const d = evaluate(call, run.policy);
      const status =
        d.decision === "BLOCK"
          ? "blocked"
          : d.decision === "REQUIRE_APPROVAL"
            ? "waiting_for_approval"
            : "proposed";
      await db.query(
        "UPDATE steps SET status=$2,policy_decision=$3,reason_code=$4,reason_text=$5,rule_fired=$6,decided_at=clock_timestamp() WHERE id=$1",
        [
          step.id,
          status,
          d.decision,
          d.reason_code,
          d.reason_text,
          d.rule_fired,
        ],
      );
      if (status === "waiting_for_approval") {
        await db.query(
          "UPDATE runs SET status='waiting_for_approval' WHERE id=$1",
          [run.id],
        );
        return;
      }
      if (d.decision === "ALLOW") await this.runTool(db, step, run.policy);
    }
    await db.query(
      "UPDATE runs SET status=CASE WHEN EXISTS(SELECT 1 FROM steps WHERE run_id=$1 AND status='failed') THEN 'failed' ELSE 'completed' END,finished_at=clock_timestamp() WHERE id=$1",
      [run.id],
    );
  }
  async decide(
    id: string,
    decision: "approved" | "rejected",
    name: string,
    note?: string,
  ) {
    const runId = await this.transaction(async (db) => {
      const {
        rows: [ref],
      } = await db.query("SELECT run_id FROM steps WHERE id=$1", [id]);
      if (!ref) throw new ApiError("STEP_NOT_FOUND", "Step not found", 404);
      // Lock the run first; concurrent decisions serialize before checking status.
      const {
        rows: [run],
      } = await db.query("SELECT * FROM runs WHERE id=$1 FOR UPDATE", [
        ref.run_id,
      ]);
      const {
        rows: [step],
      } = await db.query("SELECT * FROM steps WHERE id=$1 FOR UPDATE", [id]);
      if (step.status !== "waiting_for_approval")
        throw new ApiError(
          "STEP_NOT_PENDING",
          `Step is ${step.status}; only waiting_for_approval steps can be decided. A BLOCK cannot be overridden.`,
        );
      await db.query(
        "INSERT INTO approvals(step_id,decision,approver_name,note) VALUES($1,$2,$3,$4)",
        [id, decision, name, note ?? null],
      );
      await db.query("UPDATE steps SET status=$2 WHERE id=$1", [id, decision]);
      if (decision === "approved") await this.runTool(db, step, run.policy);
      await db.query("UPDATE runs SET status='running' WHERE id=$1", [run.id]);
      await this.advance(db, run);
      return run.id;
    });
    return this.trace(runId);
  }
  async replay(id: string) {
    const run = await this.trace(id);
    if (run.status === "running" || run.status === "waiting_for_approval")
      throw new ApiError(
        "RUN_NOT_FINISHED",
        "Finish pending approvals before replay.",
      );
    // Re-evaluate recorded proposals against the policy snapshot. Reuse recorded
    // results/errors and approvals; NEVER call execute() or create another run.
    const original = run.steps.map((s: any) => ({
      step_index: s.step_index,
      tool_name: s.tool_name,
      decision: s.policy_decision,
      reason_code: s.reason_code,
      status: s.status,
    }));
    const replay = run.steps.map((s: any) => {
      const d = evaluate(
        { tool: s.tool_name, arguments: s.arguments },
        run.policy,
      );
      let status: string;
      if (d.decision === "BLOCK") status = "blocked";
      else if (
        d.decision === "REQUIRE_APPROVAL" &&
        s.approval?.decision !== "approved"
      )
        status =
          s.approval?.decision === "rejected"
            ? "rejected"
            : "waiting_for_approval";
      else status = s.error !== null ? "failed" : "succeeded";
      return {
        step_index: s.step_index,
        tool_name: s.tool_name,
        decision: d.decision,
        reason_code: d.reason_code,
        status,
      };
    });
    const differing = original.findIndex(
      (s: any, i: number) => JSON.stringify(s) !== JSON.stringify(replay[i]),
    );
    return {
      run_id: id,
      policy_source: "recorded snapshot",
      original,
      replay,
      match: differing === -1,
      first_differing_step:
        differing === -1 ? null : original[differing].step_index,
      recorded: run.steps.map((s: any) => ({
        step_index: s.step_index,
        approval: s.approval,
        tool_result: s.tool_result,
        error: s.error,
      })),
    };
  }
}
