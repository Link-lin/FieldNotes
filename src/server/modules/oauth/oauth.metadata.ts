import "server-only";
import { appOrigin } from "@/server/core/env";
import { SCOPES_SUPPORTED, SCOPE_READ, SCOPE_WRITE } from "./oauth.rules";

/**
 * The connector's addresses and its two discovery documents (RFC 8414 and RFC 9728). The authorization server and
 * the MCP resource are one app, so the issuer is the app's origin and the resource is `<origin>/mcp`.
 */
export function connectorUrls() {
  const issuer = appOrigin();
  return {
    issuer,
    resource: `${issuer}/mcp`,
    authorization: `${issuer}/oauth/authorize`,
    token: `${issuer}/oauth/token`,
    registration: `${issuer}/oauth/register`,
    revocation: `${issuer}/oauth/revoke`,
    authorizationServerMetadata: `${issuer}/.well-known/oauth-authorization-server`,
    protectedResourceMetadata: `${issuer}/.well-known/oauth-protected-resource/mcp`,
  };
}

export function authorizationServerMetadata() {
  const u = connectorUrls();
  return {
    issuer: u.issuer,
    authorization_endpoint: u.authorization,
    token_endpoint: u.token,
    registration_endpoint: u.registration,
    revocation_endpoint: u.revocation,
    scopes_supported: [...SCOPES_SUPPORTED],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  };
}

export function protectedResourceMetadata() {
  const u = connectorUrls();
  return {
    resource: u.resource,
    authorization_servers: [u.issuer],
    scopes_supported: [SCOPE_READ, SCOPE_WRITE],
    bearer_methods_supported: ["header"],
    resource_name: "Field Notes",
  };
}

/** The `WWW-Authenticate` challenge of a 401 from /mcp: where to find the discovery document, and what to ask for. */
export function bearerChallenge(invalidToken: boolean): string {
  const parts = ['realm="Field Notes"', `resource_metadata="${connectorUrls().protectedResourceMetadata}"`, `scope="${SCOPE_READ} ${SCOPE_WRITE}"`];
  if (invalidToken) parts.push('error="invalid_token"', 'error_description="The access token is missing, expired or revoked."');
  return `Bearer ${parts.join(", ")}`;
}
