import { z } from "zod";
const email = z
  .object({
    to: z.email().max(254),
    subject: z.string().min(1).max(500),
    body: z.string().max(50000),
  })
  .strict();
export const registry = {
  read_document: {
    risk: "low",
    schema: z.object({ id: z.string().min(1).max(100) }).strict(),
  },
  search_records: {
    risk: "low",
    schema: z
      .object({
        query: z.string().max(500),
        limit: z.number().int().min(1).max(10000).default(20),
      })
      .strict(),
  },
  draft_email: { risk: "medium", schema: email },
  send_email: { risk: "high", schema: email },
  create_payment_draft: {
    risk: "high",
    schema: z
      .object({
        payee: z.string().min(1).max(300),
        amount_cents: z.number().int().positive().max(2147483647),
        memo: z.string().max(2000),
      })
      .strict(),
  },
} as const;
export type ToolName = keyof typeof registry;
export type Call = { tool: string; arguments: unknown; risk?: unknown };
export function isTool(name: string): name is ToolName {
  return Object.hasOwn(registry, name);
}
