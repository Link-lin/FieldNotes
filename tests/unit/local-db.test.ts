import { describe, expect, it } from "vitest";
import { isLocalDbUrl } from "../../scripts/local-db";

describe("isLocalDbUrl", () => {
  it("accepts the embedded server's address on this machine", () => {
    expect(isLocalDbUrl("postgres://postgres:postgres@localhost:5433/travel_planner", 5433)).toBe(true);
    expect(isLocalDbUrl("postgres://postgres:postgres@127.0.0.1:5433/travel_planner", 5433)).toBe(true);
    expect(isLocalDbUrl("postgres://postgres:postgres@[::1]:5433/travel_planner", 5433)).toBe(true);
  });

  it("leaves other databases alone", () => {
    expect(isLocalDbUrl("postgres://postgres:postgres@localhost:5432/travel_planner", 5433)).toBe(false);
    expect(isLocalDbUrl("postgres://user:pw@db.example.com:5433/app", 5433)).toBe(false);
    expect(isLocalDbUrl("not a url", 5433)).toBe(false);
  });
});
