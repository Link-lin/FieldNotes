import "server-only";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./db-schema";

// Keep calendar values as the strings PostgreSQL stores; never let the driver
// reinterpret a DATE or TIMESTAMP WITHOUT TIME ZONE in the server's local zone.
pg.types.setTypeParser(1082, (v) => v); // date
pg.types.setTypeParser(1114, (v) => v); // timestamp without time zone
pg.types.setTypeParser(20, (v) => Number(v)); // bigint (Account.expires_at)

const globalForDb = globalThis as unknown as { __tpDb?: Kysely<DB> };

export function createDb(connectionString: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 10 }) }),
  });
}

/** Process-wide Kysely instance; the only database client (server-only DAL). */
export function getDb(): Kysely<DB> {
  if (!globalForDb.__tpDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__tpDb = createDb(url);
  }
  return globalForDb.__tpDb;
}
