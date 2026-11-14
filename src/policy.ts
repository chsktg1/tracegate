import { readFile } from "node:fs/promises";
import { z } from "zod";
import { registry, isTool, type Call } from "./registry.js";
export const policySchema = z
  .object({
    allowedEmailDomains: z
      .array(z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/))
      .min(1),
    hardPaymentLimitCents: z.number().int().positive().max(2147483647),
    approvalPaymentThresholdCents: z.number().int().nonnegative(),
    searchMaxResults: z.number().int().min(1).max(1000),
    allowedDocumentIds: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .refine((p) => p.approvalPaymentThresholdCents <= p.hardPaymentLimitCents, {
    message: "Approval threshold must not exceed hard limit",
  });
export type Policy = z.infer<typeof policySchema>;
export type Decision = {
  decision: "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL";
  reason_code: string;
  reason_text: string;
  rule_fired: string;
};
const result = (
  decision: Decision["decision"],
  reason_code: string,
  reason_text: string,
  rule_fired: string,
): Decision => ({ decision, reason_code, reason_text, rule_fired });
// Pure: no database, clock, network, randomness or document text is consulted.
export function evaluate(call: Call, p: Policy): Decision {
  if (!isTool(call.tool))
    return result(
      "BLOCK",
      "UNKNOWN_TOOL",
      "Tool is not registered.",
      "1.unknown_tool",
    );
  const parsed = registry[call.tool].schema.safeParse(call.arguments);
  if (!parsed.success)
    return result(
      "BLOCK",
      "INVALID_ARGUMENTS",
      "Arguments do not match the tool schema.",
      "2.arguments",
    );
  const args = parsed.data as Record<string, unknown>;
  if (
    call.tool === "send_email" &&
    !p.allowedEmailDomains.includes(
      (args.to as string).split("@")[1].toLowerCase(),
    )
  )
    return result(
      "BLOCK",
      "DOMAIN_NOT_ALLOWED",
      "Recipient domain is not allowed.",
      "3.email_domain",
    );
  if (
    call.tool === "create_payment_draft" &&
    (args.amount_cents as number) > p.hardPaymentLimitCents
  )
    return result(
      "BLOCK",
      "AMOUNT_OVER_HARD_LIMIT",
      "Amount exceeds the hard payment limit.",
      "3.payment_limit",
    );
  if (
    call.tool === "read_document" &&
    !p.allowedDocumentIds.includes(args.id as string)
  )
    return result(
      "BLOCK",
      "DOCUMENT_NOT_ALLOWED",
      "Document is outside the allowed set.",
      "3.document_allowlist",
    );
  if (registry[call.tool].risk === "high")
    return result(
      "REQUIRE_APPROVAL",
      "HIGH_RISK_APPROVAL_REQUIRED",
      "High risk tools require human approval.",
      "4.high_risk",
    );
  return result("ALLOW", "POLICY_ALLOWED", "Call passes policy.", "5.allow");
}
export async function loadPolicy(
  path = process.env.POLICY_PATH ?? "./policy.json",
): Promise<Policy> {
  try {
    return policySchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    throw new Error(
      `Invalid policy config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
