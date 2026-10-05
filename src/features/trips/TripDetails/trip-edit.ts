import type { FieldError, TripSummaryDTO } from "@/shared/dto";
import { sameValue, type TripFields } from "@/shared/fields";
import { api } from "@/lib/api";
import type { FieldSaveResult } from "@/lib/use-inline-field";

type Fail = { ok: false; status: number; code: string; message: string; fields: FieldError[] };

/**
 * Saves the changed fields of a trip (DASH-6, ATLAS-4), each with the value it had when the edit began, so an event
 * edit (which moves the trip's version) or a change elsewhere to another field is no clash.
 */
export async function saveTripFields(
  tripId: string,
  next: Partial<TripFields>,
  start: Partial<TripFields>,
  zone?: { confirmTimeZoneImpact: true; timeDisambiguationByItem: Record<string, "earlier" | "later"> },
): Promise<{ ok: true; trip: TripSummaryDTO } | Fail> {
  const changes = Object.fromEntries(Object.entries(next).filter(([k, v]) => !sameValue(v, start[k as keyof TripFields])));
  const base = Object.fromEntries(Object.keys(changes).map((k) => [k, start[k as keyof TripFields] ?? null]));
  const r = await api<TripSummaryDTO>("PATCH", `/api/trips/${tripId}/fields`, { changes, base, ...zone });
  return r.ok ? { ok: true, trip: r.data } : r;
}

/** What a failed trip save tells the person. */
export function tripFailure(r: Fail): Extract<FieldSaveResult, { ok: false }> {
  if (r.code === "field_conflict") {
    return { ok: false, message: "This was changed elsewhere (in another tab or window, or by another owner) while you were editing, so yours wasn't saved. Cancel to see it as it is now, then make your change again.", fields: r.fields };
  }
  return { ok: false, message: r.message, fields: r.fields };
}
