import "server-only";
import type { Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import { addUsage } from "./usage.repository";
import type { UsageEvent } from "./usage.rules";

/**
 * Records pilot measures after the action they describe has succeeded. Counting never blocks or
 * fails the owner's action: an error here (for example a missing migration) is logged by class
 * name only and ignored.
 */
export async function countUsage(db: Kysely<DB>, events: UsageEvent[]): Promise<void> {
  if (!events.length) return;
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.name, (counts.get(e.name) ?? 0) + (e.count ?? 1));
  try {
    await addUsage(db, counts);
  } catch (err) {
    console.error(`[usage] ${err instanceof Error ? err.name : "Unknown error"}`);
  }
}
