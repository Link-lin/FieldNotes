import { isCurrencyCode } from "./currencies";

/** Nonnegative decimal string: at most 14 integer digits and 4 fractional digits. */
export const AMOUNT_PATTERN = /^(0|[1-9]\d{0,13})(\.\d{1,4})?$/;

export type Money = { amount: string; currency: string };

export function isAmount(value: unknown): value is string {
  return typeof value === "string" && AMOUNT_PATTERN.test(value);
}

export function isMoney(value: unknown): value is Money {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return isAmount(v.amount) && isCurrencyCode(v.currency);
}

/**
 * Format an exact decimal string for display. Intl.NumberFormat accepts decimal
 * strings without converting them to binary floating point first.
 */
export function formatMoney(amount: string, currency: string, locale = "en-US"): string {
  try {
    // Whole amounts show no decimals ("$1,600"); otherwise show at least the currency's usual
    // minor digits so "12.5" reads "$12.50", and up to the 4 digits that are stored.
    const hasFraction = /\.\d*[1-9]/.test(amount);
    const minor = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: hasFraction ? Math.min(minor, 4) : 0,
      maximumFractionDigits: 4,
    }).format(amount as unknown as number);
  } catch {
    return `${currency} ${amount}`;
  }
}

/** Normalize a stored NUMERIC(18,4) string like "620.0000" to "620". */
export function trimAmount(amount: string): string {
  if (!amount.includes(".")) return amount;
  const t = amount.replace(/0+$/, "").replace(/\.$/, "");
  return t === "" ? "0" : t;
}
