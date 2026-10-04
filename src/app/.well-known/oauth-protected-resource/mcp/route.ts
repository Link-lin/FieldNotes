import { connectorEnabled } from "@/server/core/env";
import { connectorOff, publicDocument, publicDocumentPreflight } from "@/server/core/http/oauth";
import { protectedResourceMetadata } from "@/server/modules/oauth/oauth.metadata";

/** RFC 9728 protected resource metadata for `/mcp` (the resource's path inserted after the well-known prefix). Public. */
export const GET = () => (connectorEnabled() ? publicDocument(protectedResourceMetadata()) : connectorOff());
export const OPTIONS = () => publicDocumentPreflight();
