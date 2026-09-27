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

import { fmtDay, fmtMonth, fmtShort } from "@/components/format";
describe("date labels", () => {
  it("are identical on server and client and never shift by zone", () => {
    expect(fmtDay("2026-11-15")).toBe("Sun 15 Nov");
    expect(fmtShort("2027-01-01")).toBe("1 Jan");
    expect(fmtMonth("2026-09-26")).toBe("SEP");
  });
});

describe("formatMoney keeps minor units when there is a fraction", () => {
  it("pads to the currency's usual digits", () => {
    expect(formatMoney("12.5", "USD")).toBe("$12.50");
    expect(formatMoney("12.5000", "USD")).toBe("$12.50");
    expect(formatMoney("1600", "USD")).toBe("$1,600");
    expect(formatMoney("1600.0000", "USD")).toBe("$1,600");
    expect(formatMoney("12.345", "USD")).toBe("$12.345");
    expect(formatMoney("52200", "JPY")).toBe("¥52,200");
  });
});
