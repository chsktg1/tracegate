import Fastify from "fastify";
import staticPlugin from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { Runtime, ApiError } from "./runtime.js";
import { scenario } from "./agent.js";
const uuid = z.uuid();
export function buildApp(runtime: Runtime) {
  const app = Fastify({ logger: false, bodyLimit: 100000 });
  app.setErrorHandler((error: any, _req, reply) => {
    if (error instanceof ApiError)
      return reply
        .code(error.status)
        .send({ error: error.code, message: error.message });
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: "INVALID_REQUEST", message: error.message });
    if (error.statusCode && error.statusCode < 500)
      return reply
        .code(error.statusCode)
        .send({ error: "INVALID_REQUEST", message: error.message });
    app.log.error(error);
    return reply.code(500).send({
      error: "INTERNAL_ERROR",
      message: "An internal error occurred.",
    });
  });
  const id = (req: any) => uuid.parse(req.params.id);
  app.post("/api/runs", async (req, reply) => {
    const b = z
      .object({ scenario: z.literal("outreach-research") })
      .strict()
      .parse(req.body);
    return reply
      .code(201)
      .send(await runtime.start(b.scenario, scenario(b.scenario)));
  });
  app.get("/api/runs", () => runtime.list());
  app.get("/api/runs/:id", (req) => runtime.trace(id(req)));
  app.get("/api/approvals/pending", () => runtime.pending());
  for (const [path, decision] of [
    ["approve", "approved"],
    ["reject", "rejected"],
  ] as const)
    app.post(`/api/steps/:id/${path}`, async (req) => {
      const b = z
        .object({
          approver_name: z.string().trim().min(1).max(100),
          note: z.string().max(2000).optional(),
        })
        .strict()
        .parse(req.body);
      return runtime.decide(id(req), decision, b.approver_name, b.note);
    });
  app.post("/api/runs/:id/replay", (req) => runtime.replay(id(req)));
  app.get("/api/policy", () => runtime.policy);
  if (existsSync(resolve("dist/web/index.html"))) {
    app.register(staticPlugin, { root: resolve("dist/web") });
  }
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: "NOT_FOUND", message: "Route not found." }),
  );
  return app;
}
