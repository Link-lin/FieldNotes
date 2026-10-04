import "server-only";
import type { ConnectionDTO } from "@/shared/dto";
import { hasWrite, redirectHost } from "./oauth.rules";
import type { ConnectorScope } from "@/server/core/db/schema";

type Row = { id: string; scope: ConnectorScope; created_at: Date; last_used_at: Date | null; name: string; redirect_uris: string[] };

/** A live approval to what the account menu shows. */
export function connectionDto(row: Row): ConnectionDTO {
  return {
    id: row.id,
    appName: row.name,
    returnHost: redirectHost(row.redirect_uris[0] ?? ""),
    canChange: hasWrite(row.scope),
    connectedAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
  };
}
