import { pool } from "./db.js";
import { loadPolicy } from "./policy.js";
import { Runtime } from "./runtime.js";
import { buildApp } from "./app.js";
try {
  const policy = await loadPolicy();
  const { rows } = await pool.query("SELECT id FROM documents");
  const ids = new Set(rows.map((r) => r.id));
  if (policy.allowedDocumentIds.some((id) => !ids.has(id)))
    throw new Error(
      "Invalid policy config: allowedDocumentIds must exist in seeded documents; run npm run db:setup",
    );
  const app = buildApp(new Runtime(pool, policy));
  await app.listen({
    port: Number(process.env.PORT ?? 3100),
    host: process.env.HOST ?? "127.0.0.1",
  });
  console.log(
    `Tracegate listening at http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 3100}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await app.close();
      await pool.end();
      process.exit(0);
    });
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  await pool.end();
  process.exitCode = 1;
}
