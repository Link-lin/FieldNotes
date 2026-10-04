import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { migrateToLatest } from "../../db/migrate";

// embedded-postgres registers an exit hook (async-exit-hook) that ends the process with status 0 once the event loop empties,
// which hid failing tests from the exit status of `npm test`. Once teardown has stopped the server nothing is left for it to do.
const exitHook = createRequire(import.meta.url)("async-exit-hook") as { hookedEvents(): string[]; unhookEvent(event: string): void };

/** Starts a throwaway PostgreSQL for the db test project and applies migrations. */
export default async function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), "tp-pg-"));
  const port = 55432 + Math.floor(Math.random() * 1000);
  const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  await server.createDatabase("tp_test");
  const url = `postgres://postgres:postgres@localhost:${port}/tp_test`;
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 1 }) }) });
  await migrateToLatest(db);
  await db.destroy();
  project.provide("databaseUrl", url);
  return async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
    for (const event of exitHook.hookedEvents()) exitHook.unhookEvent(event);
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
