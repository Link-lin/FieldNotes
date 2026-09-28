/**
 * The embedded PostgreSQL used for local development (not tests, not production). Data lives
 * in ./.pgdata; the server listens on DEV_DB_PORT (default 5433).
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";

export const LOCAL_DB_NAME = "travel_planner";

export function localDbPort(): number {
  return Number(process.env.DEV_DB_PORT || 5433);
}

/** True when the URL points at the embedded server on this machine, so it is ours to start. */
export function isLocalDbUrl(url: string, port = localDbPort()): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    return ["localhost", "127.0.0.1", "::1"].includes(host) && Number(u.port || 5432) === port;
  } catch {
    return false;
  }
}

/** Whether something already accepts connections on the port (for example `npm run db:start`). */
export function isListening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: "localhost", port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); done(true); });
    socket.once("timeout", () => { socket.destroy(); done(false); });
    socket.once("error", () => done(false));
  });
}

/** Starts the embedded server, creating the data folder and database on first use. */
export async function startLocalDb(port: number, options: { quiet?: boolean } = {}): Promise<EmbeddedPostgres> {
  const dir = resolve(".pgdata");
  const fresh = !existsSync(resolve(dir, "PG_VERSION"));
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
    ...(options.quiet ? { onLog: () => {} } : {}),
  });
  if (fresh) await server.initialise();
  await server.start();
  if (fresh) await server.createDatabase(LOCAL_DB_NAME);
  return server;
}

/**
 * Stops the server. Ctrl+C in a terminal also reaches PostgreSQL itself, which may already have
 * exited; the library would then wait forever, so give up after a few seconds.
 */
export async function stopLocalDb(server: EmbeddedPostgres): Promise<void> {
  await Promise.race([server.stop().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
}
