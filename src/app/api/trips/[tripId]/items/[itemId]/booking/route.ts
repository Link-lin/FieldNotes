import { route } from "@/server/core/http/route";
import { updateItemBooking } from "@/server/modules/items/items.service";
import { itemBookingSchema } from "@/shared/schemas";

/** BOOK-3, BOOK-4: mark an event booked, or set, change or clear its book-by date, from a booking list. */
export const PATCH = route<{ tripId: string; itemId: string }, typeof itemBookingSchema>({ body: itemBookingSchema }, ({ db, actor, params, body }) =>
  updateItemBooking(db, actor, params.tripId, params.itemId, body),
);
