# Travel Planner import prompt v1

Field Notes offers two copyable prompts. For an itinerary already discussed in ChatGPT, Gemini, or another AI chat, use **Copy conversion prompt** on the import page in that same conversation. It asks the AI to use the existing plan, ask there for any missing required trip details, and return JSON v1. No trip brief is required on the Field Notes page; a response already in JSON v1 can be pasted immediately.

The prompt below is for starting with an idea. The optional brief form on the import page fills its final block. The AI chat is outside Field Notes; its data handling is controlled by that provider. Both prompts use the same JSON v1 rules and schema.

```text
Create a draft travel itinerary for me from the trip brief at the end of this prompt.

Return exactly one JSON object and nothing else: no Markdown fences, explanations, citations outside JSON, or comments. The object must follow Travel Planner external itinerary import v1 and use exactly these top-level keys:

{
  "formatVersion": 1,
  "trip": {
    "title": "...",
    "destination": "...",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "timeZone": "IANA/Zone",
    "budget": { "amount": "decimal string", "currency": "USD" }
  },
  "items": []
}

`budget` is optional. Include it only when the owner explicitly supplied a budget in the trip brief, and copy its amount and currency exactly. Do not estimate or invent a trip budget. Trip `title` must be 1–120 characters and `destination` 1–160 characters. Dates use valid ISO calendar dates and the end date is inclusive. Use a real IANA time zone no longer than 100 characters as the trip time zone unless the brief specifies another zone. `startDate` must be on or before `endDate`.

Each item has required `type`, `title`, and `bookingStatus`; supported `type` values are `flight`, `lodging`, `transport`, `meal`, `activity`, and `other`. `bookingStatus` must be exactly `Needs booking` or `Not required`. Optional item fields are `location`, `notes`, `links`, `plannedPrice`, `localDate`, `localTime`, `timeZone`, `durationMinutes`, and `flightDetails`.

For `plannedPrice` and optional trip `budget`, use `{ "amount": "decimal string", "currency": "USD" }`. Currency must be a supported uppercase ISO 4217 code. Amounts are nonnegative strings with up to 14 integer digits and 4 decimal places; never use JSON numbers. Travel Planner will treat every imported item price as an estimate. Do not output a price label. Omit unknown or unreliable item prices instead of guessing. The trip budget is never an AI estimate: include it only if the owner supplied it and preserve it exactly.

For `links`, use an array of at most 20 `{ "label": "...", "url": "https://..." }` objects per item. Labels must be 1–80 characters and URLs at most 2048 characters. Use only HTTP(S) URLs that you know are real and relevant; otherwise omit the link. Do not invent reservation links, review scores, opening hours, weather, transit status, or current availability. Notes can explain that an idea needs checking, but must not imply it is booked or verified.

Use `localDate` and optional `localTime` for non-flight items. A local time requires a valid local date; it is local wall-clock time in the activity location. Omit `timeZone` when it inherits the trip time zone; include the correct IANA zone when the activity location uses a different zone. `localTime` uses 24-hour `HH:mm`. `durationMinutes`, if supplied, must be an integer from 1 to 1440. Titles must be 1–200 characters; `location` may be up to 500 characters and `notes` up to 5000. Do not add `flightDetails` to non-flight items. Represent each flight segment as its own item; do not combine an outbound/return journey or a connection into one item. For each flight, always include a `flightDetails` object, even if it is `{}`; include any known values among `plannedDepartureDate`, `airline`, `flightNumber`, `departure`, and `arrival`. Airline may be up to 120 characters and flight number up to 24. Airport codes must be 3–4 uppercase alphanumeric characters. Each endpoint may contain `airportCode`, `localDateTime` (YYYY-MM-DDTHH:mm without an offset), and `timeZone`; a local date-time requires its correct IANA airport time zone. `plannedDepartureDate` is only a fallback for a placeholder and must be omitted when `departure.localDateTime` is supplied. Do not provide a DST `timeDisambiguation` choice in the JSON; Travel Planner will ask the owner to resolve an ambiguous local time in preview. A flight is always `Needs booking` in this import format. Include only flight numbers, airports, and times supplied in the brief or verified from reliable information available to you. Never invent flight details. If only the need for a flight is known, create a placeholder flight with an empty or partially filled `flightDetails` object.

Do not claim anything is booked. Do not output payment or booking-confirmation codes, passport details, card details, or sensitive identity information. Never set a booking status to `Booked`. Do not use fields that are not listed above. Unknown optional values should be omitted. An empty `items` array is valid. Keep the full output to at most 250 items and each item to at most 20 links. Keep the complete JSON response at or below 400 KiB of UTF-8 text to leave room for the app request envelope; if necessary, shorten notes and omit optional links while preserving essential itinerary details.

Trip brief:
[PASTE YOUR TRIP DETAILS, PREFERENCES, CONSTRAINTS, AND ANY ALREADY-KNOWN BOOKINGS HERE]
```

The normative machine-readable contract is [`json-v1.schema.json`](json-v1.schema.json). The representative output fixture is [`import-example-v1.json`](import-example-v1.json). Server validation also checks real calendar dates, time zones, supported currency codes, URL parsing, and cross-field rules that JSON Schema alone cannot establish.
