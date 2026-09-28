import { describe, expect, it } from "vitest";
import { CURRENCY_CODES, CURRENCY_NAMES, currencyName } from "@/shared/currencies";

describe("currency names", () => {
  it("has a bundled English name for every supported code", () => {
    for (const code of CURRENCY_CODES) expect(CURRENCY_NAMES[code]?.length).toBeGreaterThan(2);
    expect(Object.keys(CURRENCY_NAMES)).toHaveLength(CURRENCY_CODES.length);
  });

  it("falls back to the code itself", () => {
    expect(currencyName("JPY")).toBe("Japanese Yen");
    expect(currencyName("XXX")).toBe("XXX");
  });
});
