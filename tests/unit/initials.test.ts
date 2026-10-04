import { describe, expect, it } from "vitest";
import { initials } from "@/lib/format";

describe("avatar initials", () => {
  it("takes the first letter of up to two words", () => {
    expect(initials("Link Lin")).toBe("LL");
    expect(initials("sam")).toBe("S");
    expect(initials("Mary Jane Watson")).toBe("MJ");
  });

  it("skips punctuation, so a name with a bracketed note still reads as a name", () => {
    expect(initials("Mei (WeChat)")).toBe("MW");
    expect(initials('"Sam"')).toBe("S");
  });

  it("copes with Chinese names and emoji, never showing half a character", () => {
    expect(initials("张伟")).toBe("张");
    expect(initials("小明 王")).toBe("小王");
    expect(initials("🌸 Mei")).toBe("M");
    expect(initials("🌸")).toBe("?");
  });

  it("falls back to a question mark", () => {
    expect(initials("")).toBe("?");
    expect(initials("  ")).toBe("?");
  });
});
