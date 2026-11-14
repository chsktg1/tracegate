import "dotenv/config";
import pg from "pg";
import { readFile } from "node:fs/promises";
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://localhost:5432/tracegate",
});
export async function setup(db: pg.Pool) {
  await db.query(
    await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
  );
  await db.query(
    await readFile(new URL("../db/seed.sql", import.meta.url), "utf8"),
  );
}
