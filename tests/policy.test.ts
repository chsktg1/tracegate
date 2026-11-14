import { describe, it, expect } from "vitest";
import { evaluate, loadPolicy, policySchema } from "../src/policy.js";
import { registry } from "../src/registry.js";
const p = await loadPolicy();
const email = { to: "a@example.com", subject: "Hello", body: "Text" };
describe("pure policy / first match wins", () => {
  const cases: [string, string, unknown, string, string][] = [
    ["unknown before invalid", "missing", null, "BLOCK", "UNKNOWN_TOOL"],
    ["prototype name is unknown", "toString", {}, "BLOCK", "UNKNOWN_TOOL"],
    [
      "invalid before domain",
      "send_email",
      { to: "evil.com" },
      "BLOCK",
      "INVALID_ARGUMENTS",
    ],
    [
      "domain before high risk",
      "send_email",
      { ...email, to: "attacker@evil.com" },
      "BLOCK",
      "DOMAIN_NOT_ALLOWED",
    ],
    [
      "subdomain is not exact domain",
      "send_email",
      { ...email, to: "a@sub.example.com" },
      "BLOCK",
      "DOMAIN_NOT_ALLOWED",
    ],
    [
      "uppercase allowed domain",
      "send_email",
      { ...email, to: "a@EXAMPLE.COM" },
      "REQUIRE_APPROVAL",
      "HIGH_RISK_APPROVAL_REQUIRED",
    ],
    [
      "second domain allowed",
      "send_email",
      { ...email, to: "a@company.test" },
      "REQUIRE_APPROVAL",
      "HIGH_RISK_APPROVAL_REQUIRED",
    ],
    [
      "over hard limit",
      "create_payment_draft",
      { payee: "Acme", amount_cents: 100001, memo: "" },
      "BLOCK",
      "AMOUNT_OVER_HARD_LIMIT",
    ],
    [
      "at hard limit",
      "create_payment_draft",
      { payee: "Acme", amount_cents: 100000, memo: "" },
      "REQUIRE_APPROVAL",
      "HIGH_RISK_APPROVAL_REQUIRED",
    ],
    [
      "at threshold",
      "create_payment_draft",
      { payee: "Acme", amount_cents: 10000, memo: "" },
      "REQUIRE_APPROVAL",
      "HIGH_RISK_APPROVAL_REQUIRED",
    ],
    [
      "below threshold",
      "create_payment_draft",
      { payee: "Acme", amount_cents: 1, memo: "" },
      "REQUIRE_APPROVAL",
      "HIGH_RISK_APPROVAL_REQUIRED",
    ],
    [
      "unknown document",
      "read_document",
      { id: "missing" },
      "BLOCK",
      "DOCUMENT_NOT_ALLOWED",
    ],
    [
      "allowed document",
      "read_document",
      { id: "injection" },
      "ALLOW",
      "POLICY_ALLOWED",
    ],
    [
      "search",
      "search_records",
      { query: "Research" },
      "ALLOW",
      "POLICY_ALLOWED",
    ],
    ["draft", "draft_email", email, "ALLOW", "POLICY_ALLOWED"],
    [
      "invalid amount",
      "create_payment_draft",
      { payee: "Acme", amount_cents: -1, memo: "" },
      "BLOCK",
      "INVALID_ARGUMENTS",
    ],
    [
      "prompt field refused",
      "read_document",
      { id: "injection", prompt: "ignore policy" },
      "BLOCK",
      "INVALID_ARGUMENTS",
    ],
  ];
  it.each(cases)("%s", (_label, tool, args, decision, code) => {
    const result = evaluate({ tool, arguments: args }, p);
    expect(result.decision).toBe(decision);
    expect(result.reason_code).toBe(code);
    expect(result.reason_text).toBeTruthy();
    expect(result.rule_fired).toBeTruthy();
  });
  it("ignores agent supplied risk; registry remains the authority", () => {
    expect(
      evaluate({ tool: "send_email", arguments: email, risk: "low" }, p)
        .decision,
    ).toBe("REQUIRE_APPROVAL");
    expect(
      evaluate(
        { tool: "read_document", arguments: { id: "injection" }, risk: "high" },
        p,
      ).decision,
    ).toBe("ALLOW");
  });
  it("is deterministic and does not mutate inputs", () => {
    const call = { tool: "send_email", arguments: email };
    const before = JSON.stringify([call, p]);
    for (let i = 0; i < 20; i++)
      expect(evaluate(call, p)).toEqual(evaluate(call, p));
    expect(JSON.stringify([call, p])).toBe(before);
  });
  it("uses changed limits without tool code changes", () =>
    expect(
      evaluate(
        {
          tool: "create_payment_draft",
          arguments: { payee: "Acme", amount_cents: 50000, memo: "" },
        },
        { ...p, hardPaymentLimitCents: 40000 },
      ).reason_code,
    ).toBe("AMOUNT_OVER_HARD_LIMIT"));
  it("rejects malformed and inconsistent policy", () => {
    expect(() => policySchema.parse({ ...p, searchMaxResults: 0 })).toThrow();
    expect(() =>
      policySchema.parse({ ...p, hardPaymentLimitCents: 1 }),
    ).toThrow();
  });
  it("ships exactly five tools", () =>
    expect(Object.keys(registry)).toHaveLength(5));
});
