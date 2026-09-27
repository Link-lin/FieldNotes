import { getDb } from "@/server/db";
import { pageActor } from "@/server/session";
import { getDashboard } from "@/server/trips";
import { Dashboard, type Filter } from "@/components/Dashboard";

const FILTERS = ["all", "upcoming", "ongoing", "past"] as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ focus?: string; filter?: string }> }) {
  const actor = await pageActor("/");
  const now = new Date();
  const data = await getDashboard(getDb(), actor, now);
  const { focus, filter } = await searchParams;
  const initialFilter: Filter = FILTERS.find((f) => f === filter) ?? "all";
  const focusId = focus && data.trips.some((t) => t.id === focus) ? focus : null;
  return <Dashboard data={data} today={now.toISOString().slice(0, 10)} focus={focusId} initialFilter={initialFilter} />;
}
