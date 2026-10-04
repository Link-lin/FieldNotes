import type { PlannedTotalDTO, TripDetailDTO } from "@/shared/dto";
import { formatMoney } from "@/shared/money";
import { Card } from "@/components/ui/Card/Card";
import { Section } from "@/components/ui/Section/Section";
import { cx } from "@/lib/cx";
import { plural, TYPE_LABEL } from "@/lib/format";
import styles from "./CostsSection.module.css";

/**
 * BUDGET-6 and 7: one card per currency (never added or converted), the budget bar in the
 * budget's currency only, a breakdown by type, and a note while AI estimates remain.
 */
export function CostsSection({ data, owner }: { data: TripDetailDTO; owner: boolean }) {
  const { trip, plannedTotals: totals, budgetComparison: cmp } = data;
  const budgetOnly = trip.budget && !totals.some((t) => t.currency === trip.budget!.currency);
  const cards: PlannedTotalDTO[] = [...(budgetOnly ? [{ currency: trip.budget!.currency, total: "0", priceCount: 0, unverifiedCount: 0, byType: [] }] : []), ...totals]
    .sort((a, b) => Number(b.currency === trip.budget?.currency) - Number(a.currency === trip.budget?.currency));
  return (
    <Section title="Planned costs" titleId="costs-title">
      {!totals.length && !trip.budget ? (
        <Card><p className="note">No prices yet.{owner ? " Add a price to an event, or set a trip budget with Edit trip." : ""}</p></Card>
      ) : (
        <>
          <div className={styles.costs}>
            {cards.map((t) => (
              <Card className={styles.cost} key={t.currency}>
                <div className={cx("mono", styles.head)}><span>{t.currency}</span><span>{plural(t.priceCount, "price")}</span></div>
                <b className={styles.total}>{formatMoney(t.total, t.currency)}</b>
                {cmp && cmp.currency === t.currency ? (
                  <>
                    <div className={styles.budgetBar} data-over={cmp.over} aria-hidden="true">
                      <i style={{ width: `${Math.min(100, Number(cmp.budget) > 0 ? (Number(cmp.planned) / Number(cmp.budget)) * 100 : 100)}%` }} />
                    </div>
                    <span className={styles.budgetText} data-over={cmp.over}>
                      {cmp.over
                        ? `Over budget by ${formatMoney(cmp.remaining, cmp.currency)} (budget ${formatMoney(cmp.budget, cmp.currency)})`
                        : `${formatMoney(cmp.remaining, cmp.currency)} left of your ${formatMoney(cmp.budget, cmp.currency)} budget`}
                    </span>
                  </>
                ) : null}
                {t.byType.length ? (
                  <>
                    <div className={styles.stack} aria-hidden="true">
                      {t.byType.map((b) => (
                        <i key={b.type} data-type={b.type} style={{ flex: `${Math.max(Number(b.amount), 0.0001)} 1 0` }} />
                      ))}
                    </div>
                    <ul className={styles.breakdown}>
                      {t.byType.map((b) => (
                        <li key={b.type}><i data-type={b.type} aria-hidden="true" /><span>{TYPE_LABEL[b.type]}</span><b>{formatMoney(b.amount, t.currency)}</b></li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {t.unverifiedCount ? <p className="note">Includes {plural(t.unverifiedCount, "unverified AI estimate")}.</p> : null}
              </Card>
            ))}
          </div>
          {cards.length > 1 ? (
            <p className="note">Different currencies are never added together or converted.{trip.budget ? ` Only ${trip.budget.currency} costs count toward the budget.` : ""}</p>
          ) : null}
        </>
      )}
    </Section>
  );
}
