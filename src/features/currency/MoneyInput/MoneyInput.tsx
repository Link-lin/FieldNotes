import { CurrencyOptions } from "../CurrencyOptions/CurrencyOptions";
import styles from "./MoneyInput.module.css";

type Props = {
  amountId: string;
  currencyId: string;
  amount: string;
  currency: string;
  onAmount: (v: string) => void;
  onCurrency: (v: string) => void;
  /** The owner's recently used currencies, listed first. */
  recent: string[];
  currencyLabel: string;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
};

/** Amount and currency as one control, both the same height. Place it inside a Field. */
export function MoneyInput({ amountId, currencyId, amount, currency, onAmount, onCurrency, recent, currencyLabel, placeholder, invalid, describedBy }: Props) {
  return (
    <div className={styles.money}>
      <input id={amountId} inputMode="decimal" value={amount} onChange={(e) => onAmount(e.target.value)} placeholder={placeholder} aria-invalid={invalid || undefined} aria-describedby={describedBy} />
      <select id={currencyId} aria-label={currencyLabel} value={currency} onChange={(e) => onCurrency(e.target.value)}>
        <CurrencyOptions recent={recent} value={currency} />
      </select>
    </div>
  );
}
