import { Field, FieldGrid } from "@/components/ui/Field/Field";
import { MoneyInput } from "@/features/currency/MoneyInput/MoneyInput";
import { errorId, fieldId, type PriceDraft } from "../event-edit";

type Props = {
  value: PriceDraft;
  onChange: (patch: Partial<PriceDraft>) => void;
  error: (path: string) => string | undefined;
  recentCurrencies: string[];
  describedBy?: string;
};

/** A planned price (BUDGET-1, BUDGET-4): an exact amount in one currency, an estimate or a quote. Empty means none. */
export function PriceFields({ value: v, onChange, error, recentCurrencies, describedBy }: Props) {
  const err = error("plannedPrice.amount") ?? error("plannedPrice.currency");
  return (
    <FieldGrid>
      <Field label={<>Planned price <span className="muted">optional</span></>} htmlFor={fieldId("plannedPrice.amount")} wide error={err} errorId={errorId("plannedPrice.amount")}>
        <MoneyInput
          amountId={fieldId("plannedPrice.amount")}
          currencyId={fieldId("plannedPrice.currency")}
          amount={v.amount}
          currency={v.currency}
          onAmount={(amount) => onChange({ amount })}
          onCurrency={(currency) => onChange({ currency })}
          recent={recentCurrencies}
          currencyLabel="Price currency"
          placeholder="120"
          invalid={!!err}
          describedBy={[err ? errorId("plannedPrice.amount") : null, describedBy].filter(Boolean).join(" ") || undefined}
        />
      </Field>
      {v.amount.trim() ? (
        <Field label="The price is a" htmlFor={fieldId("plannedPrice.label")} wide>
          <select id={fieldId("plannedPrice.label")} value={v.label} onChange={(e) => onChange({ label: e.target.value as PriceDraft["label"] })} aria-describedby={describedBy}>
            <option value="estimate">Estimate</option>
            <option value="quote">Quote</option>
          </select>
        </Field>
      ) : null}
    </FieldGrid>
  );
}
