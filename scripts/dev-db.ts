/**
 * Local development PostgreSQL without a system install: runs an embedded
 * PostgreSQL 17 server with data in ./.pgdata until you press Ctrl+C.
 * Uses DEV_DB_PORT (default 5433). Not for production. `npm run dev` starts
 * it on its own when needed; use this to run the database by itself.
 */
import { LOCAL_DB_NAME, localDbPort, startLocalDb, stopLocalDb } from "./local-db";

const port = localDbPort();
const server = await startLocalDb(port);
console.log(`PostgreSQL is running on port ${port}.`);
console.log(`DATABASE_URL=postgres://postgres:postgres@localhost:${port}/${LOCAL_DB_NAME}`);
console.log("Run `npm run db:migrate` in another terminal, then `npm run dev`. Press Ctrl+C to stop.");

const stop = async () => {
  await stopLocalDb(server);
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
