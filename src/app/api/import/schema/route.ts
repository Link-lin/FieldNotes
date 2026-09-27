import { route } from "@/server/core/http/route";
import schema from "../../../../../docs/design/json-v1.schema.json";

/** IMPORT-1: publish the exact versioned contract to signed-in owners. */
export const GET = route({ ownerAccount: true }, async () => schema);
