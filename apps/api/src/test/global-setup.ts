import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import { createDb } from "../db/client";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

// A separate database on the same server as development, so tests never touch dev data.
const DEFAULT_TEST_DATABASE_URL =
  "postgres://kitchen_ops:kitchen_ops@127.0.0.1:5432/kitchen_ops_test";

export default async function setup(project: TestProject) {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const name = new URL(url).pathname.slice(1);

  // CREATE DATABASE has to run while connected to a different database.
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  const client = new Client({ connectionString: maintenance.toString() });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      "API tests need Postgres. Start it with `docker compose up -d` (or set TEST_DATABASE_URL).",
      { cause: error },
    );
  }
  try {
    const exists = await client.query(
      "select 1 from pg_database where datname = $1",
      [name],
    );
    if (exists.rowCount === 0) {
      await client.query(`create database "${name.replaceAll('"', '""')}"`);
    }
  } finally {
    await client.end();
  }

  const { db, close } = createDb(url);
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../drizzle", import.meta.url),
      ),
    });
  } finally {
    await close();
  }

  project.provide("testDatabaseUrl", url);
}
