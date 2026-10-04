import { describe, expect, it } from "vitest";
import { createDb } from "@/server/core/db/client";
import { databaseIsUp } from "@/server/core/health";
import { testDb } from "./helpers";

const health = await import("@/app/api/health/route");

describe("health check", () => {
  it("answers ok without a session when the database is up, and says nothing else", async () => {
    const res = await health.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ status: "ok" });
    expect(await databaseIsUp(testDb())).toBe(true);
  });

  it("answers unhealthy, quickly and without detail, when the database is unreachable", async () => {
    const dead = createDb("postgres://nobody:secret-password@127.0.0.1:1/none");
    try {
      const started = Date.now();
      expect(await databaseIsUp(dead, 1500)).toBe(false);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      await dead.destroy();
    }
  });
});
