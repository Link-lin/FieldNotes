import { describe, expect, it } from "vitest";
import { formatMoney, isAmount, trimAmount } from "@/shared/money";
import { isCurrencyCode } from "@/shared/currencies";

describe("money", () => {
  it("accepts nonnegative decimal strings with at most 14+4 digits", () => {
    expect(isAmount("0")).toBe(true);
    expect(isAmount("99999999999999.9999")).toBe(true);
    expect(isAmount("100000000000000")).toBe(false);
    expect(isAmount("1.23456")).toBe(false);
    expect(isAmount("-1")).toBe(false);
    expect(isAmount("01")).toBe(false);
    expect(isAmount(12)).toBe(false);
  });
  it("accepts only real ISO 4217 codes", () => {
    expect(isCurrencyCode("JPY")).toBe(true);
    expect(isCurrencyCode("EUR")).toBe(true);
    expect(isCurrencyCode("ABC")).toBe(false);
    expect(isCurrencyCode("QQQ")).toBe(false);
    expect(isCurrencyCode("usd")).toBe(false);
  });
  it("formats exact decimal strings without float rounding", () => {
    expect(formatMoney("99999999999999.9999", "USD")).toBe("$99,999,999,999,999.9999");
    expect(formatMoney("48000", "JPY")).toBe("¥48,000");
    expect(trimAmount("620.0000")).toBe("620");
    expect(trimAmount("0.3000")).toBe("0.3");
    expect(trimAmount("0.0000")).toBe("0");
  });
});
