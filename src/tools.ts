import type { PoolClient } from "pg";
import { registry, type ToolName } from "./registry.js";
import type { Policy } from "./policy.js";
// Only the runtime imports execution. The scripted agent has no tool references.
export async function execute(
  db: PoolClient,
  tool: ToolName,
  input: unknown,
  stepId: string,
  p: Policy,
): Promise<unknown> {
  const a = registry[tool].schema.parse(input) as Record<string, any>;
  switch (tool) {
    case "read_document": {
      const r = await db.query("SELECT * FROM documents WHERE id=$1", [a.id]);
      if (!r.rowCount) throw new Error("Document unavailable");
      return r.rows[0];
    }
    case "search_records":
      return (
        await db.query(
          "SELECT * FROM records WHERE strpos(lower(name || ' ' || email || ' ' || company),lower($1))>0 ORDER BY id LIMIT $2",
          [a.query, Math.min(a.limit, p.searchMaxResults)],
        )
      ).rows;
    case "draft_email":
      return (
        await db.query(
          "INSERT INTO email_drafts(step_id,recipient,subject,body) VALUES($1,$2,$3,$4) RETURNING *",
          [stepId, a.to, a.subject, a.body],
        )
      ).rows[0];
    case "send_email":
      return (
        await db.query(
          "INSERT INTO outbox(step_id,recipient,subject,body) VALUES($1,$2,$3,$4) RETURNING *",
          [stepId, a.to, a.subject, a.body],
        )
      ).rows[0];
    case "create_payment_draft":
      return (
        await db.query(
          "INSERT INTO payment_drafts(step_id,payee,amount_cents,memo) VALUES($1,$2,$3,$4) RETURNING *",
          [stepId, a.payee, a.amount_cents, a.memo],
        )
      ).rows[0];
  }
}
