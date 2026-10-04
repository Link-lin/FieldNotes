import "server-only";
import { sql, type Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";

/** True when the database answers a trivial query within `timeoutMs`. It reports nothing else. */
export async function databaseIsUp(db: Kysely<DB>, timeoutMs = 2000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    });
    await Promise.race([sql`select 1`.execute(db), timeout]);
    return true;
  } catch (err) {
    // Class name only: a database message can contain the connection string.
    console.error(`[health] ${err instanceof Error ? err.name : "Unknown error"}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
