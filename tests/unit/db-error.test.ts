import { describe, expect, it } from "vitest";
import { describeDbError } from "../../scripts/db-error";

const refused = (address: string) => Object.assign(new Error(`connect ECONNREFUSED ${address}`), { code: "ECONNREFUSED" });

describe("describeDbError", () => {
  it("explains a refused connection that arrives as an AggregateError with no message", () => {
    const err = Object.assign(new AggregateError([refused("::1:5433"), refused("127.0.0.1:5433")], ""), { code: "ECONNREFUSED" });
    const text = describeDbError(err);
    expect(text).toContain("connect ECONNREFUSED ::1:5433; connect ECONNREFUSED 127.0.0.1:5433");
    expect(text).toContain("npm run db:start");
  });

  it("adds the hint to a plain refused connection", () => {
    expect(describeDbError(refused("127.0.0.1:5433"))).toMatch(/^connect ECONNREFUSED 127\.0\.0\.1:5433\nThe database is not running/);
  });

  it("returns other errors' messages unchanged", () => {
    expect(describeDbError(new Error('relation "usage_counts" does not exist'))).toBe('relation "usage_counts" does not exist');
  });

  it("falls back to the error name when there is no message", () => {
    expect(describeDbError(new TypeError(""))).toBe("TypeError");
  });
});
