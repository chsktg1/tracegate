import { pool, setup } from "../src/db.js";
try {
  await setup(pool);
  console.log("Schema and seed ready");
} finally {
  await pool.end();
}
