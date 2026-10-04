import { connectorEnabled } from "@/server/core/env";
import { connectorOff, publicDocument, publicDocumentPreflight } from "@/server/core/http/oauth";
import { protectedResourceMetadata } from "@/server/modules/oauth/oauth.metadata";

/** RFC 9728 protected resource metadata at the root path, for clients that do not insert the resource's path. Public. */
export const GET = () => (connectorEnabled() ? publicDocument(protectedResourceMetadata()) : connectorOff());
export const OPTIONS = () => publicDocumentPreflight();
