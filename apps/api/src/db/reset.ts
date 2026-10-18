// Drops and recreates the database in DATABASE_URL, for the browser tests' fresh start (decision
// 0021). Destructive, so it only ever touches a database whose name ends in _e2e, and never in
// production. Migrate and seed afterwards: `db:migrate`, `db:seed`.
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { ConfigError, loadDatabaseUrl } from "../config";

/** The database's name, if db:reset may drop it. Throws otherwise. */
export function resettableDatabase(
  url: string,
  nodeEnv: string | undefined,
): string {
  if (nodeEnv === "production") {
    throw new Error("db:reset refuses to run: never in production.");
  }
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!name.endsWith("_e2e")) {
    throw new Error(
      `db:reset drops only a database whose name ends in _e2e, not "${name}".`,
    );
  }
  return name;
}

async function reset(url: string, name: string) {
  // DROP and CREATE DATABASE have to run while connected to a different database.
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    await client.query(`drop database if exists ${quoted} with (force)`);
    await client.query(`create database ${quoted}`);
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const url = loadDatabaseUrl(process.env);
    const name = resettableDatabase(url, process.env.NODE_ENV);
    await reset(url, name);
    console.log(`Database ${name} reset: empty, ready for db:migrate.`);
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : error);
    process.exit(1);
  }
}
