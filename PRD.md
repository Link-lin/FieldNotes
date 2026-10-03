# Travel Planner — Product Requirements Document

**Status:** MVP implementation baseline (v1.2)

Last revised 1 Oct 2026. Change history is in git.

**Product:** Private multi-trip dashboard with editable itineraries imported from external AI plans

This document states what the product must do and why. Layout, visual style, motion and component behaviour are specified in [`trip-page-v1.md`](docs/design/trip-page-v1.md) and [`atlas-v1.md`](docs/design/atlas-v1.md).

## 1. Product objective

Travel Planner lets a traveler manage multiple trips from one private dashboard and see their destinations on an interactive globe. For each trip, the owner can use an AI tool outside the app to draft an itinerary, then import the response into a structured, editable trip page. The app helps track items that still need booking, planned item prices, and trip budgets.

The MVP does not generate or repair plans with an AI model inside the webpage. It provides a short trip brief and a copyable prompt/schema, then validates, previews, and imports the external AI response.

**Primary job:** “Help me get an AI-created trip plan into an editable place, keep track of what I still need to book, and find my trips later.”

## 2. User and assumptions

**Initial user:** A traveler who plans multiple personal leisure trips over time. The owner may invite family or friends to view a specific trip. Invitees cannot edit trips in the MVP.

The PRD assumes, but has not yet validated, that:

- Travelers prefer planning in an AI chat they already use.
- A copyable prompt and structured response format can make importing easier than item-by-item entry.
- The owner wants one dashboard for upcoming, ongoing, and past trips.
- Read-only sharing is useful; shared editing is not necessary at launch.
- Booking due dates are useful even before email notifications are added.

Validate these assumptions with real trips before adding native AI, live data, or more integrations.

## 3. MVP scope

### Build now

- Google sign-in, private trips, and read-only viewers invited by email. The owner sends the invite link outside the app.
- A dashboard of owned and shared trips by date status, with a globe of approximate destinations and a trip list that works without it.
- Manual trip creation, and owner editing and permanent deletion of trips.
- Copyable prompts for an external AI chat, and import of one supported, versioned JSON response after validation, preview and owner approval.
- Manual itinerary editing, including booked flight segments. Order follows item times; unbooked flights stay booking tasks.
- Planned item prices, a trip budget, same-currency totals, and amount left or over in the budget's currency.
- Booking tasks with owner-set due dates in an in-app list, not notifications.
- A full-page trip view with a timeline, day tabs, an outline map, per-item map links, an event view with a live Google map and notes, and an optional Google road map the user opens deliberately.
- Owner actions on the trip page only: add, edit and delete events, manage bookings and book-by dates, edit trip details, share, and delete the trip. The dashboard offers **New trip** and **Create from an AI plan**; each owned trip card can open that trip's booking view (BOOK-3). Importing an AI plan into an existing trip is proposed (TRIP-7) and not in the baseline until confirmed.

### Build later

- Paid amounts and a yearly **Recorded trip spending** summary. Count only actual amounts the owner marks paid, by payment date, on trips they own; group currencies separately. This is not full expense tracking.
- Email notifications for booking reminders.
- Importing arbitrary prose or arbitrary AI responses through an AI conversion service.
- Generating or refining trip plans inside the webpage, including an in-page copilot.
- Weather forecasts, live flight status, and related data providers.
- Packing lists, document/PDF upload, email/calendar/booking integrations, automatic currency conversion (see the roadmap), standalone expenses, split payments, shared editing, and offline use.

### Do not build

- Booking flights, hotels, restaurants, or activities.
- Public trip pages, anonymous share links, or custom permission systems.
- An app-owned street basemap, map-tile service, routing engine, turn-by-turn navigation, background geocoding outside an owner-triggered import preview or event edit, review search, or rating aggregation. The optional Google Maps Embed road view (MAP-9) is the only street-map exception. The dashboard globe shows trip destinations only; itinerary stops appear only on the trip page map (MAP-1 to MAP-9).
- AI claims of current prices, availability, opening hours, or confirmed booking details.
- Payment processing, receipt reconciliation, or general-purpose accounting.

## 4. Core user flows

These summaries show how the requirements fit together. The rules are in the functional requirements.

**Create a trip from an AI plan.** The owner chooses **Create from an AI plan**. If the trip was already planned in an AI chat, they copy a conversion prompt into it; the AI returns JSON v1 and asks there for any missing trip details. Starting from an idea, an optional brief (title, destination, dates, time zone, interests, pace, constraints, budget) makes a planning prompt instead. Neither path asks for items one by one. The owner pastes the response, reviews a day-by-day preview, fixes or skips items, reviews any suggested map matches, and confirms. Accepted items are tagged as unverified AI drafts (IMPORT-1 to IMPORT-7, IMPORT-9).

**Repair an import.** Invalid JSON or an unsupported version shows the errors, with **Copy errors only** or **Copy response and errors for repair** for a retry in the external AI (IMPORT-5, IMPORT-10). A correctable item error is fixed in the preview form or the item is skipped (IMPORT-6). The owner never edits raw JSON, and a failed attempt creates nothing (IMPORT-8).

**Add to an existing trip.** On an owned trip, **Add to itinerary** opens the item form with the date of the day in view (TRIP-3, TRIP-9). Importing an AI plan into the trip is proposed (TRIP-7).

**Create and share trips manually.** **New trip** creates an empty trip from its required details (DASH-3). To share, the owner enters an email, copies the invitation and sends it themselves; the invitee signs in with the matching Google account (ACCESS-3 to ACCESS-6, ACCESS-11). The owner can revoke access or delete the trip (DASH-5).

**Use the dashboard.** The dashboard lists every trip the user owns or can view, grouped as Upcoming, Ongoing or Past, with a synchronized globe (DASH-1, DASH-2, ATLAS-1 to ATLAS-6). Each trip card shows title, destination, dates, and whether the user is the owner or a viewer. An owned trip card with pending bookings shows their count and any overdue count, with a direct link to that trip's booking view (BOOK-3). Owners edit trip details (DASH-6), add items by hand, and edit imported items without regenerating the whole plan (PLAN-3).

## 5. Functional requirements

### Authentication and sharing

- **ACCESS-1:** Owners sign in with Google before viewing or changing trip data.
- **ACCESS-2:** Trips are private to the owner unless they invite a specific email address as a viewer.
- **ACCESS-3:** The owner can create an invitation for one email and copy a trip-specific, unguessable, single-use link that expires after seven days. The link grants no trip access until a matching verified Google identity signs in. The app does not send the invitation email.
- **ACCESS-4:** An invitee must sign in with a Google account whose verified email matches the invitation. A mismatched account is denied access and shown a switch-account path.
- **ACCESS-5:** Viewers can read a shared trip but cannot create, edit, delete, invite others, or change access.
- **ACCESS-6:** The owner can revoke viewer access or recreate an expired invitation. An accepted invitation grants access to that verified account until revoked. Revocation blocks subsequent protected requests; expired or revoked links cannot be accepted.
- **ACCESS-7:** Invitation links never grant anonymous access. The public address may show sign-in, but unauthenticated visitors cannot retrieve trip content or APIs.
- **ACCESS-8:** The invite flow tells the owner that viewers can see all trip items, place names, map links and exact pinned positions, planned prices, booking state, and links. Field-level sharing permissions are not supported.
- **ACCESS-9:** The sign-in screen offers only **Continue with Google**. Its states are: ready; denied (an unlisted identity with no staged invitation is told the account is not set up and offered another Google account); invitation landing (says only that the visitor was invited to view a trip); and wrong account (the signed-in identity does not match a staged invitation; offers to switch account). No state reveals the trip, its owner or the invited email. A signed-out visitor who opens a trip address sees only sign-in; no trip content loads.
- **ACCESS-10:** A signed-in user has an account menu showing name, email and role summary, with **Sign out** and **Delete my account**. Deleting an account also permanently deletes every trip the user owns, with DASH-5 effects for each, and removes the user's viewer grants. The confirmation lists the owned trips by title and requires typing DELETE.
- **ACCESS-11:** The owner's **Share** dialog shows the ACCESS-8 notice before an invitation is created, lists current viewers and invitations with status and expiry, and offers the ACCESS-3 and ACCESS-6 actions. **Create new link** is available for pending, expired and revoked entries and invalidates any previous link. A new link is shown once, in the dialog that created it, and is never listed afterwards.

### Dashboard and trips

- **DASH-1:** A user can own multiple trips and open them from one dashboard. Once trips exist, the dashboard prioritizes finding and opening them; introductory guidance belongs to the empty state.
- **DASH-2:** The dashboard lists owned and shared trips, grouped by date status. A trip is Upcoming before its start date, Ongoing from start through end date inclusive, and Past after its end date, evaluated in the trip time zone.
- **DASH-3:** A trip can be created from an imported plan or manually. A trip requires a title, destination, start/end date, and IANA time zone in the MVP. Start date must be the same as or earlier than end date.
- **DASH-4:** An empty dashboard explains how to create a trip. A trip with no itinerary items remains valid and can be edited manually.
- **DASH-5:** The owner can permanently delete a trip after confirmation. Deletion revokes invitations and removes the trip’s items and associated booking state. Past trips remain until deleted.
- **DASH-6:** The owner can edit a trip’s title, destination, dates, time zone, optional budget, and budget currency, with start on or before end. Editing dates never shifts or deletes item dates; items outside the new range stay visible, with a warning that counts only the items the new range pushes outside. Changing the time zone reinterprets non-flight local date-times that inherit it and recalculates booking due/overdue status; item-specific and airport time zones are unchanged. Before saving a time-zone change, the UI names the inherited local-time items and booking dates affected. Budget edits never change item prices or convert currencies.
- **DASH-7:** On desktop, the dashboard starts with a wider trip-list pane beside the globe. The user can resize the two panes by dragging their divider or using the keyboard; both panes retain usable space, the chosen width persists on that browser, and the user can reset it. On narrow screens, the panes stack and the divider is hidden.

### Global trip view

- **ATLAS-1:** The dashboard displays an interactive globe with one approximate destination marker per located trip. It displays only trips returned by the user's authorized dashboard query; a viewer sees only trips they may read. Markers never represent live user position, a flight path, or every itinerary stop.
- **ATLAS-2:** The globe and accessible trip list share **All**, **Upcoming**, **Ongoing**, and **Past** filters. Each trip remains findable and openable from the list, including trips without a marker. Selecting a marker identifies the trip and offers **Open trip**.
- **ATLAS-3:** On trip creation or import, the app attempts an exact, unambiguous match of the trip destination to its bundled place catalog. If no unique match exists, it leaves the trip unlocated and does not guess a point. AI-provided text is never treated as a verified coordinate.
- **ATLAS-4:** The owner can set or correct one trip destination point by searching the bundled catalog or selecting a point on the globe. Saving a point requires an explicit action and updates only that trip. The owner can clear a point. Viewers cannot change it.
- **ATLAS-5:** Automatic points are labeled **Approximate destination** until the owner corrects them. A changed destination rematches only an automatic point; an owner-set point is preserved with a prompt to check it. A missing point is not treated as a missing trip.
- **ATLAS-6:** The list remains usable without WebGL, on small screens, with reduced motion, and while globe assets are loading or fail. Globe selection has a keyboard-operable list equivalent and visible focus; color alone never communicates status.
- **ATLAS-7:** The dashboard globe uses bundled map and place data and sends no trip or session data to a map service. An owner-triggered item place lookup is a separate MAP-2/IMPORT-6 action: it may send only the entered place name and trip destination to the configured geocoder, never the trip title, notes, prices, links, saved coordinates, raw imported response, or session data.

### External AI response import

- **IMPORT-1:** The app provides a copyable conversion prompt for an itinerary already discussed in an external AI chat, an optional brief-based prompt for a new trip, and a versioned JSON schema. Pasting a JSON v1 response needs no brief fields. Both prompts ask for specific known physical places in `location` and for unknown or multi-stop locations to be described without invented venues, addresses, coordinates, or map URLs. The prompts are provider-independent, but compatibility is not guaranteed; test with the AI tools used in the pilot.
- **IMPORT-2:** JSON v1 contains `formatVersion`, trip title/destination/start date/end date/time zone, and an `items` array. Each item requires a type, title, and `bookingStatus` (`Needs booking` or `Not required`); it may also include location, notes, links, and an optional planned amount/currency pair. A planned amount is a nonnegative decimal and requires an ISO 4217 currency code. Non-flight items can include optional date/time/duration/time zone. A flight item uses a structured `flightDetails` object instead of generic date/time fields: optional planned departure date (in the trip time zone), airline and flight number, departure and arrival airport codes, and separate local departure and arrival date-times and IANA time zones. A placeholder flight may omit unknown segment details but must be marked **Needs booking**; the importer must not fabricate flight numbers, airports, or times.
- **IMPORT-3:** Imported items may be undated or unscheduled and are grouped under **Unscheduled**, **Undated** and **Undated flights** as PLAN-1 and FLIGHT-1 describe. A trip may have zero items.
- **IMPORT-4:** The importer accepts pasted JSON, including JSON wrapped in a standard Markdown code fence. File upload and free-form text parsing are deferred.
- **IMPORT-5:** The validator explains malformed JSON, unsupported format versions, missing required trip/item fields, start dates after end dates, invalid date/time/time-zone/currency/URL values, a price without currency, unsupported booking states, and invalid or incomplete supplied flight fields (for example, a local departure date-time without its time zone). Partial flight placeholders are allowed when marked **Needs booking**. It never silently drops or invents data.
- **IMPORT-6:** Parsed fields are shown in a day-by-day preview, with undated items still visible. Correctable item fields can be edited in a form; invalid items can be skipped; no data is committed until the owner confirms. When place lookup is configured, the preview resolves non-flight place names using their supplied locality and, when needed, the trip destination. Suggestions must match the requested place and region. Clear venue matches may be preselected for review; missing or ambiguous matches stay unselected. The owner can inspect, change or decline each suggestion without entering coordinates. Refresh preserves explicit choices for unchanged places, including a decision not to pin; editing a place invalidates its previous suggestion. Only the selections accepted at confirmation become pins.
- **IMPORT-7:** Imported items are visibly tagged as AI-drafted, unverified suggestions. JSON v1 permits only `Needs booking` or `Not required`; it cannot establish `Booked`. Only the owner can set an item to **Booked** in the app.
- **IMPORT-8:** Failed import attempts create no partial trips. Before acceptance, the preview states what confirming will do: create a new trip, or (TRIP-7, if approved) append N items to a named trip. Cross-trip duplicate-response detection is out of scope.
- **IMPORT-9:** The prompt and importer warn users not to send passport, payment-card, or booking-confirmation codes to an external AI tool.
- **IMPORT-10:** Before copying a repair prompt containing the submitted response, the app shows the exact content and requires explicit user action. The owner can copy errors without the response instead.

**Format rules:** ISO dates (`YYYY-MM-DD`), 24-hour local times, ISO 4217 currency codes, and IANA time-zone names. A non-flight item uses its own time zone when supplied and otherwise the trip's. A flight's `plannedDepartureDate` is date-only in the trip time zone and used only for display; exact departure date-time and airport time zone, when present, are authoritative and decide order. A complete example and schema must be published before implementation. Only the current schema version is accepted.

### Itinerary and flights

- **PLAN-1:** For non-flight items, group by item-local date using the item's time zone or, if absent, the trip time zone. Items with a date but no time appear in that day’s **Unscheduled** section; items without a date appear in **Undated**. Sort timed items by their instant and keep creation order when times are equal. Items without a time keep creation order within their section.
- **PLAN-2:** A non-flight item can have a type (lodging, transport, meal, activity, or other), title, optional local date/time/duration/time zone, location, notes, links, and optional planned cost. A time without a date is invalid; a date without a time, or neither, is valid and placed as PLAN-1 describes. Flights use FLIGHT-1 and FLIGHT-2.
- **PLAN-3:** The owner can manually add, edit, duplicate and delete a non-flight item. Its position comes from its date/time, so editing them moves it to the matching day and position; there is no drag-to-reorder. Flights are edited per FLIGHT-2. The UI shows save status and keeps edits after a recoverable save failure.
- **PLAN-4:** An item with a saved map link opens that link (MAP-1); otherwise an item with a location opens a Google Maps search for it, where details, reviews and directions are available. The app shows one such link per place.
- **PLAN-5:** Imported place names and times are unverified suggestions. The app does not present them as current opening hours, availability, appointments, or reservations.
- **FLIGHT-1:** One trip can contain multiple flight items; each represents one segment. A placeholder with `plannedDepartureDate` appears on that date; one without it appears under **Undated flights**. A segment with exact departure details appears on its departure local date and is ordered by its departure instant. Departure and arrival dates/times display in their own airport time zones.
- **FLIGHT-2:** The owner can manually create a flight item and enter or correct its fields. A flight can be marked **Booked** only when it has departure and arrival airport codes, the local date-time at each airport, and each airport’s IANA time zone. Airline and flight number are optional.
- **FLIGHT-3:** An unbooked flight is a booking task or placeholder, not a confirmed segment. Live flight status and delays are out of scope.

### Booking tasks and due dates

- **BOOK-1:** The owner can mark a reservable item **Needs booking** or **Booked**. Non-reservable items do not need a booking state.
- **BOOK-2:** The owner sets a date-only due date for a booking task, in the trip time zone. A task is due on that local date and becomes overdue at the start of the next local date. The app does not guess a booking deadline.
- **BOOK-3:** Each trip has a **Bookings** view beside **Itinerary**. It shows all **Needs booking** items for that trip, grouped as due now (overdue or due today), coming up, or without a book-by date. The view shows the count and overdue count near the top of the trip page; an owned trip's dashboard card links to it with a compact count. A task opens its event view (TRIP-10), and the owner can mark it **Booked** (a flight only with its FLIGHT-2 fields) or set, change or clear its due date without opening the item form. Viewers can read the trip's booking list but cannot change it. The MVP sends no email, push, or background notifications.
- **BOOK-4:** Marking an item **Booked** removes it from the booking list and clears its due date. The owner can edit or clear a due date while an item is **Needs booking**.

### Trip page

- **TRIP-1:** Opening a trip shows it on its own page with a stable, deep-linkable address, including its booking view. Back or **All trips** returns to the dashboard with its filter and scroll position preserved and focus on that trip's card or booking shortcut. Switching between itinerary, bookings and days adds no browser history, so one Back always returns to the dashboard. A phone event opened from bookings returns to that view.
- **TRIP-2:** The trip page opens in **Itinerary**, with **Whole trip** as the default day view, one tab per date in the trip range, and an **Outside trip dates** tab for any item date outside it. Day numbers count from the trip start date (Day 1). Empty days say "Nothing planned" and, for the owner, offer the add row. Within a day, **Unscheduled** items follow timed items (PLAN-1); **Undated** and **Undated flights** appear only in Whole trip, after the last day. Pins are numbered in that order; undated items are unnumbered. Whole trip shows every day with the same headings, timeline and numbering as the day tabs, then costs and the globe location. **Bookings** is a separate view of the same trip (BOOK-3).
- **TRIP-3:** Only the owner sees add, edit, import, share and delete actions. **Add to itinerary** stays reachable while scrolling, is repeated at the end of each day, and defaults its date to the day in view. A viewer sees none of these controls.
- **TRIP-4:** Itinerary summary tiles show only values derived from stored data: time to departure, day *N* of *M* or trip ended (in the trip time zone, as DASH-2); length in days; item count; pinned count; total straight-line distance between same-day stops; and planned versus budget. The booking count and overdue count appear in the trip's **Bookings** switch (BOOK-3). No tile shows an invented, sample, or cross-currency-summed figure.
- **TRIP-5:** The dashboard can show the ongoing trip (day *N* of *M*) and the next upcoming trip (days to go), and each trip card shows a relative-time label. All use the DASH-2 status calculation.
- **TRIP-6:** Decorative motion (listed in the design specs) must never be the only way information is conveyed, must not delay use, and is disabled when the user prefers reduced motion. Looping motion stops by itself within 10 seconds of the last interaction.
- **TRIP-7 (proposed; confirm before implementation):** **Import AI plan** on an owned trip appends items only. Every appended item is tagged as an unverified AI draft, none can be **Booked**, and nothing is written until the owner confirms the preview. The response's trip block is ignored except for warnings: trip-block errors do not block the import; a different `timeZone` warns that items without their own zone will use this trip's zone; items dated outside the trip range get the DASH-6 warning. The preview names the trip and the number of items to be added, and the result confirms it.
- **TRIP-8:** Each event row shows the owner a visible (not hover-only) three-dot menu with **Edit event** and **Delete event**, following the standard menu-button keyboard pattern. Edit opens the event editor (TRIP-9) with the event's current values. Delete takes effect on the server at once and shows an **Undo** confirmation that receives keyboard focus and stays until dismissed or for at least 10 seconds. Undo restores the same item (same origin tag, order and values) within 10 minutes; after that the deletion is final. Focus then moves to the next event's menu button, or to the day's add row. Viewers see no menu.
- **TRIP-9:** The item form has date (or **No date**), optional time, title, type, booking state, a due date when it needs booking, and optional planned price (with currency and estimate or quote), place name, map link and notes. **Booked** is offered for a flight only when its FLIGHT-2 fields are present. Flights use their FLIGHT-2 fields instead of date and time. An event may have its own time zone and a flight its airport zones, chosen with the same zone picker as the trip form. A date outside the trip range shows a note that the event will be listed under **Outside trip dates**; saving is still allowed. Errors appear next to their field and are announced.
- **TRIP-10:** The timeline summarizes events for quick scanning; full notes and additional links are available in the event view. Activating an event row (outside its map link and menu, by pointer or keyboard) opens the event: a side panel over the faded trip page on desktop, or its own URL with a return to the trip on phones. It shows the event's day, time, title, type, booking state, planned price, place and map link, other links, a flight's boarding-pass card, notes, and a live map (MAP-8). **Previous** and **Next** follow the current tab's order. The owner edits notes in place; they save automatically with visible saving, saved and error states. A failed or conflicting save keeps the typed text, and leaving through the view's controls then asks whether to stay (the default) or leave without saving. **Edit event** opens the full editor in the same panel or page; it saves explicitly and confirms before discarding unsaved changes. Viewers see details read-only. Closing the desktop panel returns focus to the event row.

### Map links and day map

- **MAP-1:** An item may have a place name (`location`) and one optional map link of at most 2,048 characters. Any https link without user information (`user@`) is accepted. The provider label comes from an exact hostname match (for example `www.google.com` with a `/maps` path, `maps.app.goo.gl`, `maps.apple.com`, `www.openstreetmap.org`, `*.amap.com`, `map.baidu.com`); every other link is labeled by its host. Known tracking parameters are removed on save. Links open in a new tab only on click. The app never fetches, resolves, or previews them.
- **MAP-2:** A stop's coordinates come from a Google Maps, Apple Maps or OpenStreetMap link the owner saves that contains decimal coordinates; decimal coordinates the owner pastes into the map-link field; an owner-selected place lookup result in the AI import preview or event editor; or, for an owner-entered or **Booked** flight, the arrival airport in a bundled airport list. Lookup starts only after an owner previews an import, refreshes suggestions, or chooses **Find place on map** in the event editor. Its candidates may appear on the app's outline map only after the owner accepts one. Amap and Baidu links are labeled but never pinned, because they use different coordinate systems. The app never treats AI-provided text or links as verified coordinates and does not resolve shortened links. Without a configured lookup provider, imported place names remain unpinned and event editing remains usable without lookup. Coordinates are read only when the saved map link changes.
- **MAP-3:** The trip page shows an outline map of pinned stops for the selected day or the whole trip: numbered pins in timeline order, and straight lines between consecutive non-flight stops of the same day, over bundled coastlines, country borders and city labels drawn in the pins' projection. The outline makes no tile or map-service request. Users can zoom, pan and reset the view by mouse, touch or on-screen buttons, without the map trapping page scrolling. Pins at nearly the same place share one marker listing their numbers.
- **MAP-4:** The map is labeled as an outline map without streets. Its coastlines and borders are approximate at local zoom. Distances are described as straight-line, never as travel distance or time. Flight legs are excluded from distances and route lines.
- **MAP-5:** Every pin has a text equivalent. The timeline and the stop list carry the same numbers and highlight together with the pin. Pins are keyboard-operable and lead to the matching event. An item with no coordinates is marked **Not on the map yet**. Meaning never depends on color alone.
- **MAP-6:** A single-day view offers **Open this day in Google Maps**, built from the stops' coordinates (origin, destination and up to eight waypoints, so at most the first 10 stops; a note says so when a day has more) and opened only on click. The whole-trip view offers per-item links only.
- **MAP-7:** The map uses only data in the authorized trip response, so a viewer sees the same pins as the owner. ATLAS-7 applies. The globe never shows itinerary stops.
- **MAP-8:** The event view and editor (TRIP-10) embed a Google map through the Maps Embed API. A flight with both airport codes shows the route between them; one known airport shows that airport; another event shows its pin, or else its place name (with the trip's main destination added when the name does not mention it). An event with no place says so. The map loads only when the event panel or page opens, for owners and viewers, and states that opening an event sends its place to Google. In the editor, the map shows the last saved place until changes are saved. The frame sends only the site's origin as the referrer. Without a configured Embed API key, no map is shown. The outline map (MAP-3) still makes no map-service request.
- **MAP-9:** On a selected day with pinned stops and a configured Maps Embed API key, owners and viewers can switch the outline to a Google road map. The iframe loads only after **Road route** is chosen, with a notice that the day’s pinned coordinates and arrival-airport codes are sent to Google. Owner pins are sent as coordinates; a flight arrival pinned from the bundled airport list is sent as its airport code (for example "HNL airport"). Directions run through pinned stops in itinerary order, by **Driving** or **Walking**. A flight arrival may start a ground route to later stops, but no route joins a pre-flight stop to a flight arrival. Routes longer than 22 stops, or split by flights, become selectable segments of at most 20 intermediate stops each. A single stop shows a place map. Switching day returns to the outline and unloads the iframe. Without the key, the outline and external Google Maps link remain. The app does not store Google’s route result or present straight-line distances as road distances.

### Planned prices and budgets

- **BUDGET-1:** The owner can enter an optional nonnegative planned amount and currency for any trip item and label it as an estimate or quote. A price cannot be saved without its currency.
- **BUDGET-2:** The owner can set an optional nonnegative trip budget with a currency and see planned totals by currency and item type.
- **BUDGET-3:** Costs are compared to the trip budget only when currencies match. Unlike currencies are never added together.
- **BUDGET-4:** Amounts supplied by external AI are marked as unverified estimates until the owner saves the price (amount, currency or label) in the item form, which makes it owner-entered. Price provenance is separate from the item's AI-draft tag. The app does not generate prices.
- **BUDGET-5:** Paid amounts, annual spending totals, split payments, and standalone expense entries are out of MVP scope.
- **BUDGET-6:** For each currency used, the trip page shows the planned total and its breakdown by item type; in the budget's currency it also shows the amount left or over. Other currencies are listed separately with a note that they are neither added nor converted. AI amounts carry the BUDGET-4 label. Breakdown colors never reuse the colors that mean booking or budget state.
- **BUDGET-7:** The trip page shows a **Planned vs budget** tile only when a budget exists, and shows a planned total only when at least one price exists.

## 6. Data model and status definitions

- **User:** Google identity and verified email.
- **Trip:** owner, title, destination, start/end dates (start <= end), IANA time zone, optional nonnegative budget and currency, and optional approximate globe point with automatic/owner-set provenance.
- **TripViewer:** trip, invitee email, accepted Google user and verified email (when applicable), invitation status, invitation expiry, grant/revocation timestamps, and a single-use invitation token stored only as a cryptographic hash.
- **PlanItem:** trip, type, title, optional non-flight local date/time and time zone, location (place name), optional https map link, optional coordinates read from that link, notes, links, origin (external AI or owner), booking state and optional date-only due date, and optional planned amount/currency/estimate-or-quote label with price provenance (AI or owner). Flight items use structured `flightDetails` instead of generic date/time: optional planned departure date; airline; flight number; departure/arrival airport codes; and each airport's local date-time and IANA time zone. The trip's IANA time zone determines booking due/overdue state.

The booking list is derived from plan items marked **Needs booking**; it is not a separate task record. Import workflow states are **Pasted response** → **Preview** → **Accepted trip items** or **Cancelled/Rejected**. Accepted AI-drafted items keep a visible unverified origin tag; there is no separate suggestion workflow state. Booking state is independent: **Not required**, **Needs booking**, or **Booked**. Imported AI data never sets **Booked**. Planned prices are distinct from actual paid amounts; actual payment data is not collected in the MVP. Invitation states are **Pending**, **Accepted**, **Expired**, or **Revoked**. An invitation is accepted only after a matching verified Google identity signs in.

## 7. Security, privacy, and reliability

- Deny access by default. Check authentication and trip ownership or viewer membership on the server for every protected page, API request, and dashboard aggregate.
- Use HTTPS and secure `HttpOnly` session cookies. Keep OAuth secrets server-side and out of the browser bundle and local storage.
- The MVP does not send prompts or imported responses to an AI provider. The user chooses an external AI tool and copies the trip brief there; explain that the external provider’s data policies apply.
- Do not collect passport or payment-card data. Warn against sending booking codes to external AI tools. All trip data fields in the MVP are visible to invited viewers.
- Validate URLs (imported and item links http or https; map links https only; bounded length; no user information) and render user-provided text safely. Do not log map links or coordinates. The event view's embedded Google map (MAP-8) sends that event's place or airports to Google when it opens. The optional road view (MAP-9) sends its selected segment’s pinned coordinates to Google only after the user opens it. No other trip content is sent. Open external links in a new tab with `noopener noreferrer`, and never fetch them server-side. Do not expose trip content in anonymous routes, public metadata, search indexes, or shared caches.
- If hosted at a public address, only sign-in is public. A VPN-only deployment is optional and requires each viewer to connect to the private network.
- Google sign-in unavailability must not expose trip data. Import validation errors must preserve the pasted response in the current session so the owner can retry; save failures must preserve unsaved edits and provide a retry path. The app has no AI or email provider dependency in the MVP.
- Core trip viewing and editing must work on current mobile and desktop browsers, with keyboard-accessible forms, controls, and error messages.
- Define account/trip deletion and backup retention before launch.

## 8. Validation and MVP acceptance

Validate the import workflow with real trips before expanding integrations. In a small pilot, observe whether owners can get a usable response from their chosen external AI, how often import succeeds without JSON editing, how many imported items they keep, edit or skip, and whether they use booking due dates. Measure time spent in the app separately from time spent in the external AI chat.

The app records these measures as daily totals only, with no account, trip or content attached: import previews (clean, needing fixes, or rejected), trips created by import and by hand, items created, skipped in preview and later edited or deleted, book-by dates set, and items marked **Booked**. `npm run pilot:report` prints the totals, weekly figures and rates. Time spent and the quality of each external AI's response are observed with the pilot owners, not measured by the app.

The MVP is acceptable when:

- An owner can create multiple trips and find owned and shared trips from the dashboard.
- Authorized trips with resolved points appear on the globe and all trips remain available in the synchronized list; an owner can correct or clear a point, while a viewer cannot. The list still works when the globe fails to load.
- The supplied prompt produces a response that can be pasted, validated, previewed, and accepted without the owner editing raw JSON.
- Invalid responses explain how to recover and never create partial or misleading trip data.
- A trip can be created with zero items, and date-only, undated and undated-flight items appear under **Unscheduled**, **Undated** and **Undated flights** (IMPORT-3).
- An owner can edit trip details. Date-range changes preserve item dates and warn about out-of-range items; time-zone changes warn, then update inherited local date-times and due/overdue status without changing explicit item or airport zones (DASH-6).
- Imported items are never shown as confirmed bookings without owner confirmation, and every accepted item can be manually edited.
- A flight item cannot be marked **Booked** until departure and arrival airport codes, local date-times, and time zones are present.
- A user can enter item prices and a trip budget and see correct same-currency planned totals, with amount left or over budget only for the budget's currency and unlike currencies never combined.
- An owner can add an itinerary item from the trip page (floating button or the end of any day) and can edit or delete any event from the three-dot menu on its row; a deletion survives closing the tab and can be undone for 10 minutes; booking actions appear in the trip's **Bookings** view. A viewer sees none of these controls. All of this works by keyboard with focus kept on a sensible control.
- A saved Google Maps, Apple Maps or OpenStreetMap link with coordinates, pasted decimal coordinates, or an owner-selected import lookup result pins its stop. A shortened, Amap or Baidu link, or one the app cannot read, leaves the item unpinned with a clear message. A look-alike host is labeled by its real host. A successful import preview may send each place name and trip destination to the configured lookup provider; it never sends raw JSON, notes, or prices. The trip page makes no map, tile, geocoding or font request to a third party, except the Google Maps Embed frame once an event view (MAP-8) or the road view (MAP-9) is opened.
- Whole trip and per-day views show the same items and numbering, and a single-day view can open that day in Google Maps on click.
- Booking tasks with date-only due dates appear as due on that date and overdue from the next date in the trip time zone; they clear when marked booked. The owner can mark a task booked or set its due date in that trip's **Bookings** view, reached directly from its dashboard card.
- An unauthenticated visitor cannot retrieve trip content; a viewer can see only invited trips and cannot edit them; access revocation takes effect on subsequent requests.

## 9. Roadmap and decisions

### Later: paid spending

If itemized planned prices prove useful, add actual paid amount and paid date to each trip item. A dashboard **Recorded trip spending** summary could then total paid amounts by payment year across trips the owner owns, grouped by currency. It must not imply complete accounting; shared trips and unrecorded purchases would be excluded. Split payments and standalone expenses remain separate decisions.

### Later: currency conversion (deferred)

Unlike currencies are never combined in the MVP (BUDGET-3). Two later options: an owner-entered exchange rate per trip that yields a clearly labeled, display-only converted total beside the per-currency totals (no external request); or live rates fetched server-side from a rates provider, which needs a provider decision, a privacy review (only currency codes leave the server), a rate timestamp shown with every converted figure, and a fallback when rates are unavailable. Stored prices are never rewritten by conversion.

### Later: reduce import friction

Allow arbitrary AI responses or free-form itinerary text and use an AI provider inside the webpage to convert them into the same validated internal format. This removes strict JSON requirements but adds cost, data processing, privacy review, and parsing uncertainty.

### Later: native planning and trip data

Generate and refine plans in the webpage, and add the in-page AI copilot, after the import flow is validated. The other **Build later** items, plus file OCR and companion editing, remain later candidates.

### Decisions before implementation

1. Confirm JSON v1 and publish the schema, example, and repair prompt.
2. Choose which external AI tool(s) to test in the pilot; do not promise compatibility with every model.
3. Confirm that viewer access exposes all item prices and links and that shared editing can wait.
4. Confirm that dashboard due dates are sufficient for MVP without email notifications.
5. Choose public sign-in hosting or VPN-only access for all participants before deployment; the implementation baseline is an allowlisted public sign-in shell with all trip data private.
6. Approve or drop TRIP-7 (import an AI plan into an existing trip).
7. Approve the visual direction in [`trip-page-v1.md`](docs/design/trip-page-v1.md), including the forest accent for Booked and under budget.
8. Choose the later currency-conversion option (owner-entered rate or server-side live rates).
