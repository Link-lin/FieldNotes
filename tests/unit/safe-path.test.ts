import { describe, expect, it } from "vitest";
import { safePath } from "@/shared/safe-path";

describe("safePath (post-sign-in redirect)", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safePath("/trips/abc?day=2026-11-17#x")).toBe("/trips/abc?day=2026-11-17#x");
    expect(safePath("/")).toBe("/");
  });
  it.each([
    undefined, null, "", "trips", "https://evil.example/", "//evil.example", "/\\evil.example", "/\\/evil.example",
    "/%0a//evil", "/\tevil", "javascript:alert(1)", `/${"a".repeat(3000)}`,
  ])("rejects %j", (p) => {
    const out = safePath(p as string | undefined);
    expect(out.startsWith("/")).toBe(true);
    expect(out.startsWith("//")).toBe(false);
    if (p !== "/%0a//evil") expect(out).toBe("/");
  });
});
