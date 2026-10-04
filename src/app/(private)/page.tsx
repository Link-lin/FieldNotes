import { getDb } from "@/server/core/db/client";
import { pageActor } from "@/server/auth/session";
import { getDashboard } from "@/server/modules/dashboard/dashboard.service";
import { Dashboard } from "@/features/dashboard/Dashboard/Dashboard";
import type { Filter } from "@/features/dashboard/Dashboard/TripList/TripList";

const FILTERS = ["all", "upcoming", "ongoing", "past"] as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ focus?: string; filter?: string }> }) {
  const actor = await pageActor();
  const now = new Date();
  const data = await getDashboard(getDb(), actor, now);
  const { focus, filter } = await searchParams;
  const initialFilter: Filter = FILTERS.find((f) => f === filter) ?? "all";
  const focusId = focus && data.trips.some((t) => t.id === focus) ? focus : null;
  return <Dashboard data={data} focus={focusId} initialFilter={initialFilter} />;
}
