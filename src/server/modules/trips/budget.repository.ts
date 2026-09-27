import "server-only";
import { sql } from "kysely";
import type { Conn } from "@/server/core/db/client";
import type { BudgetComparisonDTO, PlannedTotalDTO } from "@/shared/dto";
import { trimAmount } from "@/shared/money";

/** Money queries. Sums run in PostgreSQL NUMERIC and come back as decimal strings; nothing is converted. */

/** BUDGET-6: exact decimal sums per currency and per type, with the count of unverified AI prices. */
export async function plannedTotals(db: Conn, tripId: string): Promise<PlannedTotalDTO[]> {
  const rows = await sql<{ currency: string; type: string | null; amount: string; n: number; unv: number }>`
    select planned_currency as currency, type, sum(planned_amount)::text as amount,
           count(*)::int as n, (count(*) filter (where price_source = 'ai'))::int as unv
    from plan_items
    where trip_id = ${tripId} and deleted_at is null and planned_amount is not null
    group by grouping sets ((planned_currency, type), (planned_currency))
    order by planned_currency, type nulls first`.execute(db);
  const out = new Map<string, PlannedTotalDTO>();
  for (const r of rows.rows) {
    if (r.type === null) out.set(r.currency, { currency: r.currency, total: trimAmount(r.amount), priceCount: r.n, unverifiedCount: r.unv, byType: [] });
    else out.get(r.currency)?.byType.push({ type: r.type as PlannedTotalDTO["byType"][number]["type"], amount: trimAmount(r.amount) });
  }
  for (const t of out.values()) t.byType.sort((a, b) => Number(b.amount) - Number(a.amount));
  return [...out.values()];
}

/** BUDGET-7: planned vs budget in the budget's own currency only. */
export async function budgetComparison(db: Conn, tripId: string): Promise<BudgetComparisonDTO | null> {
  const r = await sql<{ currency: string | null; budget: string | null; planned: string; remaining: string; over: boolean }>`
    select t.budget_currency as currency, t.budget_amount::text as budget,
           coalesce(sum(i.planned_amount), 0)::text as planned,
           (t.budget_amount - coalesce(sum(i.planned_amount), 0))::text as remaining,
           coalesce(sum(i.planned_amount), 0) > t.budget_amount as over
    from trips t
    left join plan_items i on i.trip_id = t.id and i.deleted_at is null and i.planned_currency = t.budget_currency
    where t.id = ${tripId}
    group by t.id`.execute(db);
  const row = r.rows[0];
  if (!row || !row.currency || row.budget === null) return null;
  return { currency: row.currency, budget: trimAmount(row.budget), planned: trimAmount(row.planned), remaining: trimAmount(row.remaining.replace(/^-/, "")), over: row.over };
}

/**
 * The user's currencies across their own trips (budgets and live item prices), most recently used
 * first, then most used. A budget counts from its trip's creation, because every event change
 * touches the trip's updated_at.
 */
export async function recentCurrencies(db: Conn, userId: string, limit = 5): Promise<string[]> {
  const r = await sql<{ currency: string }>`
    select currency from (
      select budget_currency as currency, created_at as at from trips
       where owner_user_id = ${userId} and budget_currency is not null
      union all
      select p.planned_currency, p.updated_at from plan_items p join trips t on t.id = p.trip_id
       where t.owner_user_id = ${userId} and p.planned_currency is not null and p.deleted_at is null
    ) u
    group by currency
    order by max(at) desc, count(*) desc, currency
    limit ${limit}`.execute(db);
  return r.rows.map((x) => x.currency);
}
