import "server-only";
import type { Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import type { Actor } from "@/server/auth/actor";

/** ACCESS-10: delete the account; owned trips, items, sessions and grants cascade; import receipts are unlinked. */
export async function deleteAccount(db: Kysely<DB>, actor: Actor): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const owned = await tx.selectFrom("trips").select("id").where("owner_user_id", "=", actor.userId).forUpdate().execute();
    if (owned.length) {
      await tx.updateTable("import_receipts").set({ trip_id: null, payload_hash: null }).where("trip_id", "in", owned.map((t) => t.id)).execute();
    }
    await tx.deleteFrom("User").where("id", "=", actor.userId).execute();
  });
}
