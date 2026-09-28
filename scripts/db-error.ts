/**
 * Readable text for a database error in the CLI scripts. On macOS `localhost` resolves to both
 * ::1 and 127.0.0.1, so a refused connection arrives as an AggregateError with an empty
 * message; this reports the inner errors and says how to start the local database.
 */
export function describeDbError(err: unknown): string {
  const inner = err instanceof AggregateError ? err.errors : [];
  const code = (e: unknown) => (e && typeof e === "object" && "code" in e ? String(e.code) : "");
  const refused = code(err) === "ECONNREFUSED" || inner.some((e) => code(e) === "ECONNREFUSED");
  const text =
    [err, ...inner]
      .map((e) => (e instanceof Error ? e.message : typeof e === "string" ? e : ""))
      .filter(Boolean)
      .join("; ") || (err instanceof Error ? err.name : String(err));
  return refused
    ? `${text}\nThe database is not running. Start it with \`npm run db:start\` in another terminal (or check DATABASE_URL), then try again.`
    : text;
}
