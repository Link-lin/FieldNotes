import type { ImportPreviewDTO } from "@/shared/import";
import { formatMoney, isMoney } from "@/shared/money";
import { isLocalDateTime } from "@/shared/time";

type Values = ImportPreviewDTO["items"][number]["values"];
/** What a collapsed preview card shows on one line. A part is null when the item has none. */
export type PreviewGlance = { time: string | null; place: string | null; price: string | null };

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | null => typeof value === "string" ? value.trim() || null : typeof value === "number" ? String(value) : null;

/** One end of a flight as "SFO 08:05": its airport code and local time, as far as they are known. */
function flightEnd(value: unknown): string | null {
  const end = record(value);
  const at = text(end.localDateTime);
  return [text(end.airportCode), at && isLocalDateTime(at) ? at.slice(11) : at].filter(Boolean).join(" ") || null;
}

/**
 * I3: the time, place and price of an unsaved AI item, for its collapsed card. A flight's time is
 * its route with local times ("SFO 08:05 → HNL 10:45"); an event in another zone names it. Values
 * that still need fixing are shown as typed, and a price is formatted only when it is valid.
 */
export function previewGlance(values: Values, tripZone: string | null): PreviewGlance {
  let time: string | null;
  if (values.type === "flight") {
    const details = record(values.flightDetails);
    const departure = flightEnd(details.departure);
    const arrival = flightEnd(details.arrival);
    time = departure || arrival ? `${departure ?? "···"} → ${arrival ?? "···"}` : null;
  } else {
    const at = text(values.localTime);
    const zone = text(values.timeZone);
    time = at ? `${at}${zone && zone !== tripZone ? ` (${zone})` : ""}` : null;
  }
  const price = record(values.plannedPrice);
  const amount = text(price.amount);
  const currency = text(price.currency);
  return {
    time,
    place: text(values.location),
    price: isMoney(values.plannedPrice) ? formatMoney(price.amount as string, price.currency as string) : [amount, currency].filter(Boolean).join(" ") || null,
  };
}
