/** Browser copy of the published JSON v1 instructions in docs/design/import-prompt-v1.md. */
export type TripBrief = {
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  interests: string;
  pace: string;
  constraints: string;
  budgetAmount: string;
  budgetCurrency: string;
};

const instructions = `Return exactly one JSON object and nothing else: no Markdown fence, explanation, or comments. Follow Travel Planner external itinerary import formatVersion 1. Use exactly these top-level keys: formatVersion, trip, items. The shape is {"formatVersion":1,"trip":{"title":"...","destination":"...","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","timeZone":"IANA/Zone"},"items":[]}.

The trip object requires title (1–120 characters), destination (1–160), startDate and endDate (valid YYYY-MM-DD, inclusive, start on or before end), and a real IANA timeZone (1–100). Include trip.budget only if the brief explicitly gives a budget, and copy the amount and currency exactly. Never invent a trip budget. items is an array of at most 250 items and may be empty.

Every item requires type, title, and bookingStatus. Types: flight, lodging, transport, meal, activity, other. Title is 1–200 characters. bookingStatus is exactly "Needs booking" or "Not required"; never use "Booked" or claim a reservation is confirmed. Optional fields: location (up to 500 characters), notes (up to 5000), links, plannedPrice, localDate, localTime, timeZone, durationMinutes, and flightDetails. Do not add unknown fields.

For plannedPrice, and for owner-supplied trip.budget, use {"amount":"decimal string","currency":"USD"}. The amount must be nonnegative, with at most 14 integer digits and 4 decimal places, never a JSON number. Currency must be a supported uppercase ISO 4217 code. Imported prices are unverified estimates: omit unknown or unreliable prices rather than guessing. Do not output a price label.

For links, use at most 20 {"label":"...","url":"https://..."} objects per item. Labels are 1–80 characters; URLs at most 2048 characters. Use only real, relevant HTTP(S) links. Do not invent reservation links, reviews, ratings, opening hours, weather, transit status, or current availability.

For non-flight items, optional localDate is YYYY-MM-DD and localTime is 24-hour HH:mm. A localTime requires localDate. Omit timeZone when it inherits the trip zone; include the correct IANA zone for a different location. durationMinutes, if provided, is an integer from 1 to 1440. An item may have no date and no time.

Represent each flight segment as a separate item. A flight must have bookingStatus "Needs booking" and a flightDetails object (even if empty), and cannot use the non-flight date/time/duration fields. flightDetails may contain plannedDepartureDate, airline (up to 120 characters), flightNumber (up to 24), departure, and arrival. Each endpoint may contain airportCode (3–4 uppercase letters or digits), localDateTime (YYYY-MM-DDTHH:mm without an offset), and timeZone. A localDateTime requires its IANA airport timeZone. plannedDepartureDate is only a fallback for a placeholder; omit it when departure.localDateTime is present. Do not supply timeDisambiguation; the app asks the owner to resolve ambiguous times. Never invent flight numbers, airports, or times. A flight whose details are unknown is a placeholder.

Do not include booking-confirmation codes, passport details, payment-card details, or sensitive identity information. Omit unknown optional values. Keep the full JSON response at or below 400 KiB of UTF-8 text; shorten notes and omit optional links first if needed. Do not split the response.`;

export function buildImportPrompt(brief: TripBrief): string {
  const lines = [
    `Trip title: ${brief.title.trim()}`,
    `Destination: ${brief.destination.trim()}`,
    `Dates: ${brief.startDate} through ${brief.endDate}`,
    `Trip time zone: ${brief.timeZone}`,
    `Interests: ${brief.interests.trim() || "Not specified"}`,
    `Pace: ${brief.pace.trim() || "Not specified"}`,
    `Constraints: ${brief.constraints.trim() || "None specified"}`,
    brief.budgetAmount.trim() ? `Owner-supplied budget: ${brief.budgetAmount.trim()} ${brief.budgetCurrency}` : "No trip budget supplied; omit trip.budget.",
  ];
  return `${instructions}\n\nTrip brief (use these details, while following the JSON format above):\n${lines.join("\n")}`;
}

/** Converts an itinerary already discussed in an external AI conversation to JSON v1. */
export function buildConversionPrompt(): string {
  return `Use the travel plan we have already discussed in this chat and convert it into a Field Notes import. Preserve the trip details and itinerary we agreed on, including separate flight segments. If the trip title, destination, dates, or IANA time zone are still unknown, ask me for those details in this chat before producing the final JSON. Do not invent missing bookings, prices, flight details, or a budget. If this is a new chat, I will paste the existing plan after this prompt.\n\n${instructions}\n\nUse the agreed plan in this conversation as the source. Return the final JSON only after you have the required trip details.`;
}
