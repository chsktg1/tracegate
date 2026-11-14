import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.BASE_URL ?? "http://127.0.0.1:3100");
  await page
    .getByRole("heading", { name: "Agent runs", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Start demo run" }).click();
  await page
    .getByRole("heading", { name: "Trace viewer", exact: true })
    .waitFor();
  await page.getByText("DOMAIN_NOT_ALLOWED", { exact: false }).waitFor();
  await page.screenshot({ path: "docs/trace-pending.png", fullPage: true });
  await page.getByRole("button", { name: "Review in approval queue" }).click();
  await page.getByLabel("Approver name").fill("suman");
  await page
    .getByLabel("Decision note")
    .fill("Reviewed in browser verification");
  await page
    .getByRole("heading", { name: "send_email", exact: true })
    .waitFor();
  await page.screenshot({ path: "docs/approval-queue.png", fullPage: true });
  await page.getByRole("button", { name: "Approve & execute" }).click();
  await page
    .getByRole("heading", { name: "create_payment_draft", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByRole("heading", { name: "No decisions waiting" }).waitFor();
  await page.getByRole("button", { name: /Trace viewer/ }).click();
  await page.locator(".step.rejected").waitFor();
  assert.equal(await page.locator(".step.blocked").count(), 2);
  assert.equal(await page.locator(".step.rejected").count(), 1);
  await page.getByRole("button", { name: "Replay trace" }).click();
  await page.getByRole("heading", { name: "Replay matches" }).waitFor();
  await page.screenshot({ path: "docs/trace-replay.png", fullPage: true });
  const runId = await page.locator(".heading p").last().textContent();
  const id = runId!.split(" / ")[1];
  const trace = await page.evaluate(
    async (id) => (await fetch("/api/runs/" + id)).json(),
    id,
  );
  await writeFile(
    "docs/sample-trace.json",
    JSON.stringify(trace, null, 2) + "\n",
  );
  const replay = await page.evaluate(
    async (id) =>
      (await fetch("/api/runs/" + id + "/replay", { method: "POST" })).json(),
    id,
  );
  await writeFile(
    "docs/sample-replay.json",
    JSON.stringify(replay, null, 2) + "\n",
  );
  await page.getByRole("button", { name: /Runs/ }).click();
  await page
    .getByRole("heading", { name: "Agent runs", exact: true })
    .waitFor();
  await page.screenshot({ path: "docs/runs.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "docs/mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "BROWSER PASS: start scenario; inspect full arguments; approve send; reject payment; 2 blocks visible; replay matches; runs counts; mobile 390px; 0 page errors.",
  );
} finally {
  await browser.close();
}
