/**
 * Local development PostgreSQL without a system install: runs an embedded
 * PostgreSQL 17 server with data in ./.pgdata until you press Ctrl+C.
 * Uses DEV_DB_PORT (default 5433). Not for production.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const port = Number(process.env.DEV_DB_PORT || 5433);
const dir = resolve(".pgdata");
const fresh = !existsSync(resolve(dir, "PG_VERSION"));
const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: true });

if (fresh) await server.initialise();
await server.start();
if (fresh) await server.createDatabase("travel_planner");
console.log(`PostgreSQL is running on port ${port}.`);
console.log(`DATABASE_URL=postgres://postgres:postgres@localhost:${port}/travel_planner`);
console.log("Run `npm run db:migrate` in another terminal, then `npm run dev`. Press Ctrl+C to stop.");

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
