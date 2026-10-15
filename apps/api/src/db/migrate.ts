// Applies every migration in ./drizzle that the database has not seen yet.
// Uses Drizzle's runtime migrator, not drizzle-kit, so the same command can run on Render.
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { ConfigError, loadDatabaseUrl } from "../config";
import { createDb } from "./client";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

try {
  const { db, close } = createDb(loadDatabaseUrl(process.env));
  try {
    await migrate(db, { migrationsFolder });
    console.log("Migrations applied.");
  } finally {
    await close();
  }
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}
