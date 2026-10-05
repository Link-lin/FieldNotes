import type { PlanItemDTO } from "@/shared/dto";
import { api } from "@/lib/api";

/** IMPORT-7: mark AI drafts reviewed (or, to undo, drafts again), all or none, at the versions the page shows. */
export function sendReview(tripId: string, list: PlanItemDTO[], reviewed: boolean) {
  return api<PlanItemDTO[]>("POST", `/api/trips/${tripId}/items/review`, { items: list.map((i) => ({ id: i.id, expectedVersion: i.version })), reviewed });
}

/** What to say when a review was refused because an event changed after the page showed it. */
export const REVIEW_CHANGED = "Something changed in the meantime, so nothing was marked. The page now shows the events as they are: check them, then try again.";
