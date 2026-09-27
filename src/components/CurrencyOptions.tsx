"use client";

import { useMemo } from "react";
import { CURRENCY_CODES } from "@/shared/currencies";

/** Widely used travel currencies, shown after the owner's own recent ones. */
const POPULAR = ["USD", "EUR", "GBP", "JPY", "CNY", "AUD", "CAD", "CHF", "HKD", "SGD", "THB", "MXN"];

function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Options for a currency <select>: the owner's recently used currencies first, then popular
 * ones, then every other code A to Z.
 */
export function CurrencyOptions({ recent, value }: { recent: string[]; value: string }) {
  const groups = useMemo(() => {
    const mine = [...new Set([...recent, ...(recent.includes(value) || POPULAR.includes(value) ? [] : [value])])].filter((c) => CURRENCY_CODES.includes(c as never));
    const popular = POPULAR.filter((c) => !mine.includes(c));
    const rest = CURRENCY_CODES.filter((c) => !mine.includes(c) && !popular.includes(c));
    return [
      { label: "Recently used", codes: mine },
      { label: "Popular", codes: popular },
      { label: "All currencies", codes: rest },
    ].filter((g) => g.codes.length);
  }, [recent, value]);
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.codes.map((c) => (
            <option key={c} value={c}>
              {c} · {currencyName(c)}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

/** Default for a new price or budget: the most recent currency, else US dollars. */
export const defaultCurrency = (recent: string[]) => recent[0] ?? "USD";
