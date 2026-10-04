import { handleMcpHttp } from "@/server/modules/connector/mcp.http";

/**
 * The MCP endpoint a Claude or ChatGPT custom connector calls. POST carries one JSON-RPC message; GET and DELETE are
 * answered 405 after authentication (this server offers no stream and keeps no session). It reads no cookie.
 */
export const POST = (req: Request) => handleMcpHttp(req);
export const GET = (req: Request) => handleMcpHttp(req);
export const DELETE = (req: Request) => handleMcpHttp(req);
