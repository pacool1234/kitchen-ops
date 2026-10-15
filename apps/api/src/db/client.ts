import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/** A Drizzle client over a connection pool. Call `close()` when done (scripts, shutdown). */
export function createDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}

export type Db = ReturnType<typeof createDb>["db"];
