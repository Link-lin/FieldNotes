import { describe, expect, it } from "vitest";
import { errorTag } from "@/server/core/http/respond";

describe("unexpected-error log tag", () => {
  it("keeps a database error's class, SQLSTATE and constraint but never its message", () => {
    const err = Object.assign(new Error('new row violates check constraint for "Secret trip title"'), { code: "23514", constraint: "plan_items_title_check" });
    expect(errorTag(err)).toBe("Error 23514 plan_items_title_check");
    expect(errorTag(err)).not.toContain("Secret");
  });
  it("drops codes and constraint names that don't look like PostgreSQL's", () => {
    expect(errorTag(Object.assign(new TypeError("x"), { code: "ERR_INVALID_URL", constraint: "Has Spaces" }))).toBe("TypeError");
    expect(errorTag("thrown string")).toBe("Unknown error");
  });
});
