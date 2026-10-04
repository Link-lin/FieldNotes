import { connectorEnabled } from "@/server/core/env";
import { connectorOff, publicDocument, publicDocumentPreflight } from "@/server/core/http/oauth";
import { authorizationServerMetadata } from "@/server/modules/oauth/oauth.metadata";

/** RFC 8414 authorization server metadata. Public; it holds no trip data. */
export const GET = () => (connectorEnabled() ? publicDocument(authorizationServerMetadata()) : connectorOff());
export const OPTIONS = () => publicDocumentPreflight();
