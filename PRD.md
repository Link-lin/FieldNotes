# Travel Planner — Product Requirements Document

**Status:** Draft v1.1, implementation baseline  
**Updated:** September 26, 2026  
**Revision:** Added the full-page trip view, per-item map links, a schematic day map, budget display, owner trip actions, and the account/sharing screens validated in the interactive prototype (v1.1), then reconciled with the technical design after a design review. See [`docs/design/trip-page-v1.md`](docs/design/trip-page-v1.md).  
**Product:** Private multi-trip dashboard with editable itineraries imported from external AI plans

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

- Google sign-in and private trips, with named, read-only viewers invited by email. The owner copies the invite link and sends it outside the app; the product does not send invitation email.
- A dashboard for multiple owned/shared trips, grouped by date status.
- An interactive global trip view on the dashboard with one approximate destination marker per located trip, linked to the same authorized trip list. The list remains fully usable when the globe cannot render.
- Manual trip creation with an empty itinerary and owner-only permanent deletion.
- Owner editing of trip title, destination, dates, time zone, budget, and budget currency.
- A short trip brief and a copyable prompt for use in an external AI chat.
- Paste one supported, versioned JSON response; validate it, preview it, and create a trip only after owner approval.
- Guided editing of imported items and ordinary manual add/edit/delete actions afterward. Scheduled order follows item times; owners change order by editing times.
- Multiple booked flight segments entered manually; unbooked flights remain booking tasks/placeholders.
- Per-item planned price and currency, plus a trip budget, same-currency totals, and an amount-left or over-budget comparison for the budget's currency.
- Booking tasks with owner-selected due dates and an in-app upcoming/overdue list. These are due-date tasks, not proactive notifications.
- External directions links and one optional owner-saved map link (any https link; Google Maps, Apple Maps and OpenStreetMap links with coordinates can also pin the stop) for itinerary items.
- A full-page trip view with a whole-trip timeline and per-day tabs, and a schematic day map (no street basemap) of the stops the owner has pinned with a map link.
- Owner actions on the trip page: add an itinerary item (floating button or the row at the end of any day), edit or delete each event from its own row, edit trip details, share the trip, and delete it. Events are changed only on the trip page; the dashboard offers **New trip** and **Create from an AI plan**. Importing an AI plan into an existing trip is proposed (TRIP-7) and not part of the baseline until confirmed.

### Build later

- Paid amounts and a yearly **Recorded trip spending** summary. Count only actual amounts the owner marks paid, by payment date, on trips they own; group currencies separately. This is not full expense tracking.
- Email notifications for booking reminders.
- Importing arbitrary prose or arbitrary AI responses through an AI conversion service.
- Generating or refining trip plans inside the webpage, including an in-page copilot.
- Weather forecasts, live flight status, and related data providers.
- Packing lists, document/PDF upload, email/calendar/booking integrations, automatic currency conversion (an owner-entered exchange rate per trip, shown as a labeled display-only converted total, is a candidate; live rates need a server-side provider and privacy review), standalone expenses, split payments, shared editing, and offline use.

### Do not build

- Booking flights, hotels, restaurants, or activities.
- Public trip pages, anonymous share links, or custom permission systems.
- Street-level basemaps or map-tile services, routing or turn-by-turn navigation, geocoding of item locations, review search, or rating aggregation. The dashboard globe is limited to trip destinations; itinerary stops appear only on the schematic day map on the trip page (MAP-1 to MAP-7).
- AI claims of current prices, availability, opening hours, or confirmed booking details.
- Payment processing, receipt reconciliation, or general-purpose accounting.

## 4. Core user flows

### Create a trip from an external AI response

1. The owner signs in and selects **Create from an AI plan**.
2. The owner enters a trip title (pre-filled from destination and dates), destination, planned start/end dates, trip time zone, interests, pace, optional constraints, and optional budget/currency. The brief avoids asking for itinerary items individually.
3. The app makes a prompt containing the brief and format instructions. The owner copies it to an AI chat of their choice.
4. The owner copies the AI response back and pastes it into the importer. The MVP accepts the supported JSON format only; the webpage does not call an AI service to repair or generate the response.
5. The app validates the response and presents a day-by-day preview. The owner can correct parsed fields in a form, skip an item, or cancel. No trip data is written until the owner confirms.
6. Accepted items become editable plan items and are visibly tagged as AI-drafted, unverified suggestions. This origin tag is separate from booking status; the owner must confirm a booking in the app.

### Add to an existing trip

- On a trip the owner owns, **Add to itinerary** (floating button and the row at the end of each day) opens the item form described in TRIP-9. The date defaults to the day being viewed; in **Whole trip** it starts empty. Saving adds the item and returns to that trip.
- *(Proposed, TRIP-7.)* **Import AI plan** on a trip would accept the same JSON v1 response through the same validate, preview, confirm flow and append its items as unverified AI drafts without changing trip fields.

### Create and share trips manually

- To create manually, the owner selects **New trip**, then enters a title, destination, start/end dates, and time zone. The app creates an empty trip where the owner can add items. Manual creation is available without using the AI import flow.
- To invite a viewer, the owner enters that person's email. The app creates a trip-specific invitation link that expires after seven days and provides a copyable message. The owner sends it through their own email or messaging app; the app does not send invitation email.
- The invitee opens the link and signs in with the Google account matching the invited, verified email. If the wrong account is active, the app explains the mismatch and offers an account-switch path. The owner can revoke or recreate an invitation.
- Viewers cannot edit trip contents. The owner can permanently delete a trip after confirmation; deletion revokes invitations and removes the trip and all associated data.

### Repair an import

- If the response is not valid JSON or uses an unsupported schema version, show the errors and offer **Copy errors only** or **Copy response and errors for repair**. Before the second action, show exactly what will be copied and require the owner to choose it. The owner can paste that content into the external AI and retry. Do not copy or transmit the response automatically.
- If JSON is valid but one item has a correctable field error, let the owner fix that field in the preview form or skip the item.
- The app does not require the owner to edit raw JSON.
- A failed attempt creates no partial trip. Before acceptance, the preview states what confirming will do (create a new trip, or, if TRIP-7 is approved, append N items to a named trip). Cross-trip duplicate-response detection is out of scope.

### Dashboard and trip management

- The dashboard lists every trip the user owns or has been invited to view.
- The dashboard globe and list show the same authorized trips. A marker selects a trip and can open it; status filters update both views. Trips without a known destination point remain in the list with a clear **Set globe location** action for their owner.
- Trips are grouped as **Upcoming**, **Ongoing**, or **Past**. Use the trip’s date range and time zone; the end date is inclusive.
- A trip card shows title, destination, dates, and whether the user is the owner or a viewer.
- The owner can return to any trip, add items manually, and edit imported items without regenerating the whole plan.
- The owner can edit trip details. Changing the trip date range does not move or delete itinerary items; items outside the new date range remain visible with a warning. Changing the trip time zone reinterprets non-flight date-times that inherit the trip time zone and recalculates booking due/overdue status; item-specific and airport time zones do not change. Before saving a time-zone change, show that these local-time items and due dates may be affected.
- Changing the trip budget or its currency does not convert or alter item prices; planned totals remain grouped by their own currencies.
- The dashboard shows upcoming/overdue booking tasks for trips the user owns. Viewer trips appear in the trip list but do not contribute to owner-only summaries.
- The owner can permanently delete a trip after confirmation. This revokes invitations and deletes its items and associated booking state. Past trips remain in the dashboard until deleted.

## 5. Functional requirements

### Authentication and sharing

- **ACCESS-1:** Owners sign in with Google before viewing or changing trip data.
- **ACCESS-2:** Trips are private to the owner unless they invite a specific email address as a viewer.
- **ACCESS-3:** The owner can create an invitation for one email and copy a trip-specific, unguessable, single-use link that expires after seven days. The link identifies the invitation but grants no trip access until a matching verified Google identity signs in. The app does not send the invitation email.
- **ACCESS-4:** An invitee must sign in with a Google account whose verified email matches the invitation. A mismatched account is denied access and shown a switch-account path.
- **ACCESS-5:** Viewers can read a shared trip but cannot create, edit, delete, invite others, or change access.
- **ACCESS-6:** The owner can revoke viewer access or recreate an expired invitation. An accepted invitation grants access to that verified account until revoked. Revocation blocks subsequent protected requests; expired or revoked links cannot be accepted.
- **ACCESS-7:** Invitation links do not grant anonymous access. The public app address may show sign-in, but unauthenticated visitors cannot retrieve trip content or APIs.
- **ACCESS-8:** The invite flow tells the owner that viewers can see all trip items, place names, map links and exact pinned positions, planned prices, booking state, and links. Field-level sharing permissions are not supported.
- **ACCESS-9:** The sign-in screen offers only **Continue with Google**. States: ready; denied (an unlisted identity with no staged invitation is told this account is not set up for the app and offered **Try another Google account**); invitation landing (the visitor sees only that they have been invited to view a trip, with no trip, owner or invited-email details); and wrong account (a staged invitation is present but the signed-in identity does not match: "This invitation is for a different Google account" with a switch-account action, never revealing the invited email, trip or owner). A signed-out visitor who opens a trip address sees only the sign-in screen; no trip content is loaded.
- **ACCESS-10:** A signed-in user has an account menu showing name, email and role summary, with **Sign out** and **Delete my account**. Deleting an account also permanently deletes every trip the user owns, with DASH-5 effects for each, and removes the user's viewer grants. The confirmation lists the owned trips by title and requires typing DELETE.
- **ACCESS-11:** The owner's **Share** dialog shows the viewer-visibility notice (ACCESS-8) before an invitation is created, lists current viewers and invitations with status and expiry, creates an invitation for one email (copyable message, no email sent), and revokes access. **Create new link** is available for pending, expired and revoked entries and invalidates any previous link. A new link is shown once, in the dialog that created it, and is never listed afterwards.

### Dashboard and trips

- **DASH-1:** A user can own multiple trips and open them from one dashboard.
- **DASH-2:** The dashboard lists owned and shared trips, grouped by date status. A trip is Upcoming before its start date, Ongoing from start through end date inclusive, and Past after its end date, evaluated in the trip time zone.
- **DASH-3:** A trip can be created from an imported plan or manually. A trip requires a title, destination, start/end date, and IANA time zone in the MVP. Start date must be the same as or earlier than end date.
- **DASH-4:** An empty dashboard explains how to create a trip. A trip with no itinerary items remains valid and can be edited manually.
- **DASH-5:** The owner can permanently delete a trip after confirmation. Deletion revokes invitations and removes the trip’s items and associated booking state. Past trips remain until deleted.
- **DASH-6:** The owner can edit a trip’s title, destination, start/end dates, time zone, optional budget, and budget currency. Start date must remain the same as or earlier than end date. Editing the date range does not shift or delete itinerary item dates; items outside the range remain visible with a warning. Changing the trip time zone reinterprets non-flight local date-times that inherit it and recalculates booking due/overdue status; item-specific time zones and flight airport time zones are unchanged. Before saving a time-zone change, the UI identifies inherited local-time items and booking dates affected. Budget or budget-currency edits do not change item prices or convert currencies.

### Global trip view

- **ATLAS-1:** The dashboard displays an interactive globe with one approximate destination marker per located trip. It displays only trips returned by the user's authorized dashboard query; a viewer sees only trips they may read. Markers never represent live user position, a flight path, or every itinerary stop.
- **ATLAS-2:** The globe and accessible trip list share **All**, **Upcoming**, **Ongoing**, and **Past** filters. Each trip remains findable and openable from the list, including trips without a marker. Selecting a marker identifies the trip and offers **Open trip**.
- **ATLAS-3:** On trip creation/import, the app attempts an exact, unambiguous match of the trip destination to its bundled place catalog. If no unique match exists, it leaves the trip unlocated and does not guess a point. AI-provided text is never treated as a verified coordinate.
- **ATLAS-4:** The owner can set or correct one trip destination point by searching the bundled catalog or selecting a point on the globe. Saving a point requires an explicit action and updates only that trip. The owner can clear a point. Viewers cannot change it.
- **ATLAS-5:** Automatic points are labeled **Approximate destination** until the owner corrects them. A changed destination rematches only an automatic point; an owner-set point is preserved with a prompt to check it. A missing point is not treated as a missing trip.
- **ATLAS-6:** The list remains usable without WebGL, on small screens, with reduced motion, and while globe assets are loading or fail. Globe selection has a keyboard-operable list equivalent and visible focus; color alone never communicates status.
- **ATLAS-7:** Globe assets and place lookup do not send private trip titles, destinations, coordinates, or session data to an external map/geocoding service. The globe uses bundled map/place data in the MVP.

### External AI response import

- **IMPORT-1:** The app provides a copyable prompt and a versioned JSON schema. The prompt is provider-independent, but the product does not guarantee every AI tool will follow it; test compatibility with the AI tools used in the pilot.
- **IMPORT-2:** JSON v1 contains `formatVersion`, trip title/destination/start date/end date/time zone, and an `items` array. Each item requires a type, title, and `bookingStatus` (`Needs booking` or `Not required`); it may also include location, notes, links, and an optional planned amount/currency pair. An item's planned amount is a nonnegative decimal and requires an ISO 4217 currency code. Non-flight items can include optional date/time/duration/time zone. A flight item uses a structured `flightDetails` object instead of generic item date/time fields. It contains optional planned departure date (in the trip time zone), airline and flight number, departure and arrival airport codes, and separate local departure and arrival date-times and IANA time zones. A placeholder flight may omit unknown segment details but must be marked **Needs booking**; the importer must not fabricate flight numbers, airports, or times.
- **IMPORT-3:** A non-flight item may have neither a date nor a time and appears under **Undated**. A non-flight item with a date but no time appears under **Unscheduled** for that date. A flight placeholder without `plannedDepartureDate` appears under **Undated flights**. A trip may have zero items.
- **IMPORT-4:** The importer accepts pasted JSON, including JSON surrounded by a standard Markdown code fence. File upload and free-form text parsing are deferred.
- **IMPORT-5:** The validator explains malformed JSON, unsupported format versions, missing required trip/item fields, start dates after end dates, invalid date/time/time-zone/currency/URL values, a price without currency, unsupported booking states, and invalid or incomplete supplied flight fields (for example, a local departure date-time without its time zone). Partial flight placeholders are allowed when marked **Needs booking**. It never silently drops or invents data.
- **IMPORT-6:** Parsed fields are shown in a preview. Correctable item fields can be edited in a form; invalid items can be skipped; no data is committed until the owner confirms.
- **IMPORT-7:** Imported items are visibly tagged as AI-drafted, unverified suggestions. JSON v1 permits only `Needs booking` or `Not required` booking states; it cannot establish `Booked`. Only the owner can set an item to **Booked** in the app.
- **IMPORT-8:** Failed import attempts create no partial trips. Before acceptance, the preview states what confirming will do: create a new trip, or (TRIP-7, if approved) append N items to a named trip. Cross-trip duplicate-response detection is out of scope.
- **IMPORT-9:** The prompt and importer warn users not to send passport, payment-card, or booking-confirmation codes to an external AI tool.
- **IMPORT-10:** Before copying a repair prompt containing the submitted response, the app shows the exact content and requires explicit user action. The owner can copy errors without the response instead.

**Required format details:** Use ISO dates (`YYYY-MM-DD`), 24-hour local times, ISO 4217 currency codes, and IANA time-zone names. A general non-flight timed item’s date/time uses its own time zone when supplied and otherwise inherits the trip time zone. A timed non-flight item with no date is invalid and must be corrected or skipped; an item with no date or time is allowed and appears under **Undated**. A date-only non-flight item appears under that local date’s **Unscheduled** section. For flight placeholders, `plannedDepartureDate` is date-only in the trip time zone and is used only for display; when exact departure details exist, the departure local date-time and airport time zone are authoritative and determine chronological ordering. A flight placeholder without a planned departure date appears under **Undated flights**. A complete example and schema must be published before implementation. The app should accept only the current schema version and explain how to obtain a corrected response; it should not make a user repair JSON by hand.

### Itinerary and flights

- **PLAN-1:** For non-flight items, group by item-local date using the item's time zone or, if absent, the trip time zone. Items with a date but no time appear in that day’s **Unscheduled** section; items without a date appear in **Undated**. Sort timed items by their corresponding instant and retain creation order when times are equal. Items without a time retain creation order within their section.
- **PLAN-2:** A non-flight item can have a type (lodging, transport, meal, activity, or other), title, optional local date/time/duration/time zone, location, notes, links, and optional planned cost. A time without a date is invalid; a date without a time is valid and shown as unscheduled for that date; absence of both is valid and shown under **Undated**. Flights use the fields and display rules in FLIGHT-1 and FLIGHT-2.
- **PLAN-3:** The owner can manually add a non-flight item, edit its fields, change its date/time, duplicate it, and delete it. Display position is derived from its date/time; editing date/time moves it to the corresponding day and position. There is no independent drag-to-reorder control. Flight fields are edited according to FLIGHT-2. The UI shows save status and preserves edits after a recoverable save failure.
- **PLAN-4:** An item with a location can open a search or directions link in an external maps app, and an item with a saved map link opens that link (MAP-1).
- **PLAN-5:** Imported place names and times are unverified suggestions. The app does not present them as current opening hours, availability, appointments, or reservations.
- **FLIGHT-1:** One trip can contain multiple flight items; each flight item represents one segment. A placeholder with `plannedDepartureDate` appears on that date; a placeholder without it appears under **Undated flights**. A segment with exact departure details appears on its departure local date and is ordered by its departure instant. Segments display departure and arrival dates/times in their respective airport time zones.
- **FLIGHT-2:** A booked segment stores departure and arrival airport codes, local date/time at each airport, and each airport’s IANA time zone. Airline and flight number are optional. The owner can manually create a flight item and enter or correct these fields. Before an item can be marked **Booked**, departure and arrival airport codes, local date-times, and time zones are required; airline and flight number can remain unknown.
- **FLIGHT-3:** An unbooked flight is a booking task/placeholder, not a confirmed flight segment. Live flight status and delays are out of scope.

### Booking tasks and due dates

- **BOOK-1:** The owner can mark a reservable item **Needs booking** or **Booked**. Non-reservable items do not need a booking state.
- **BOOK-2:** The owner sets a date-only due date for a booking task. The due date uses the trip time zone. A task is due on that local calendar date and becomes overdue at the start of the next local calendar date. The app does not guess the best booking deadline.
- **BOOK-3:** Items marked **Needs booking** appear in a booking list on the trip page. Items with due dates also appear on the owner’s dashboard as upcoming or overdue. The MVP does not send email, push, or background notifications; this is an in-app list.
- **BOOK-4:** Marking an item **Booked** removes it from the booking list and clears its due date. The owner can edit or clear a due date while an item is **Needs booking**.

### Trip page

- **TRIP-1:** Opening a trip shows it on its own page with a stable, deep-linkable address. Back or **All trips** returns to the dashboard with its filter and scroll position preserved, and focus returns to that trip's card. Changing tabs replaces the address rather than adding history, so one Back always returns to the dashboard. Escape returns only when no menu, dialog or text field has focus.
- **TRIP-2:** The trip page offers **Whole trip** (the default) and one tab for every date in the trip's range, plus a tab for any item date outside the range, labeled **Outside trip dates**. Day numbers count from the trip start date (Day 1 is the start date). Empty days show "Nothing planned" and, for the owner, the add row. **Undated** and **Undated flights** sections appear only in Whole trip, after the last day; within a day, **Unscheduled** items follow timed items (PLAN-1). Pins are numbered in that order; undated items are unnumbered. Whole trip shows every day with the same headings, timeline and numbering as the single-day tabs, followed by costs, the booking list (read-only for viewers) and the globe-location section.
- **TRIP-3:** Only the owner sees add, edit, import, share and delete actions. **Add to itinerary** stays reachable while scrolling, is repeated at the end of each day, and defaults its date to the day in view. A viewer sees none of these controls.
- **TRIP-4:** Summary tiles show only values derived from stored data: time to departure, day *N* of *M* or trip ended (in the trip time zone, as DASH-2); length in days; item count; pinned count; total straight-line distance between same-day stops; planned versus budget; and items to book (all **Needs booking** items, with or without a due date). No tile shows an invented, sample, or cross-currency-summed figure.
- **TRIP-5:** The dashboard summary can show the ongoing trip (day *N* of *M*) and the next upcoming trip (days to go). Each trip card shows a relative-time label (for example "in 50 days" or "day 5 of 8"). Both derive from the same status calculation as DASH-2.
- **TRIP-6:** Decorative motion (page transitions, count-up, marker pulse, route animation, one intro globe rotation) must never be the only way information is conveyed, must not delay use, and must be disabled when the user prefers reduced motion. Looping motion stops by itself within 10 seconds of the last interaction.
- **TRIP-7 (proposed; confirm before implementation):** **Import AI plan** on an owned trip appends items only. Every appended item is tagged as an unverified AI draft, none can be **Booked**, and nothing is written until the owner confirms the preview. The response's trip block is ignored except for warnings: trip-block errors do not block the import; a different `timeZone` warns that items without their own zone will use this trip's zone; items dated outside the trip range get the DASH-6 warning. The preview names the trip and the number of items to be added, and the result confirms it.
- **TRIP-8:** Each event row on the trip page shows the owner a visible three-dot actions menu (not hover-only) containing **Edit event** and **Delete event**. The menu follows the menu-button pattern: it opens on click, Enter or Space, arrow keys move between items, and Escape, Tab or an outside click closes it and returns focus to its button. Edit opens the item form (TRIP-9) filled with the event's current values. Delete takes effect on the server at once and shows a confirmation with **Undo** that stays until dismissed or for at least 10 seconds, pauses while hovered or focused, and receives keyboard focus. Undo restores the same item (same origin tag, order and values) within 10 minutes; after that the deletion is final. Focus then moves to the next event's menu button, or to the day's add row. Viewers see no menu.
- **TRIP-9:** The item form has: date (or **No date**), optional time, title, type, booking state (**Booked** offered for a flight only when FLIGHT-2 fields are present), optional due date when it needs booking, optional planned price with currency and estimate or quote, optional place name, optional map link, and optional notes. Flights use their FLIGHT-2 fields instead of date and time. Errors appear next to their field and are announced.

### Map links and day map

- **MAP-1:** An item may have a place name (`location`) and one optional map link of at most 2,048 characters. Any https link without user information (`user@`) is accepted. The provider label comes from an exact hostname match (for example `www.google.com` with a `/maps` path, `maps.app.goo.gl`, `maps.apple.com`, `www.openstreetmap.org`, `*.amap.com`, `map.baidu.com`); every other link is labeled by its host. Known tracking parameters are removed on save. Links open in a new tab only on click. The app never fetches, resolves, or previews them.
- **MAP-2:** A stop's coordinates come only from a Google Maps, Apple Maps or OpenStreetMap link the owner saves that contains decimal coordinates, or, for an owner-entered or **Booked** flight, the arrival airport in a bundled airport list. Amap and Baidu links are labeled but never pinned, because they use different coordinate systems. The app does not geocode place names, does not resolve shortened links, and never treats AI-provided text or links as verified coordinates. Import never sets an item's map link; the owner can choose **Use as map link** on one of its imported links, and coordinates are read only when the saved map link changes.
- **MAP-3:** The trip page shows a schematic map of pinned stops for the selected day or the whole trip: numbered pins in timeline order, dashed straight lines between consecutive non-flight stops of the same day, a scale bar and north marker. It draws no basemap and makes no tile or map-service request. Zoom works with the wheel (only while the pointer is over the map, and page scrolling continues once zoom reaches its limit), pinch, and **+**/**−** buttons; drag pans; **Reset view** appears when zoomed. Pins at nearly the same place are drawn as one marker listing their numbers, and labels hide where they would collide. On touch screens a one-finger swipe scrolls the page.
- **MAP-4:** The map is labeled as a sketch without streets, and distances are described as straight-line, never as travel distance or time. Flight legs are excluded from distances and route lines.
- **MAP-5:** Every pin has a text equivalent. The timeline and the stop list carry the same numbers and highlight together with the pin. Pins are keyboard-focusable, and Enter or Space scrolls to and highlights the matching event. An item with no coordinates is marked **Not on the map yet**. Meaning never depends on color alone.
- **MAP-6:** A single-day view offers **Open this day in Google Maps**, built from the stops' coordinates (origin, destination and up to eight waypoints, so at most the first 10 stops; a note says so when a day has more) and opened only on click. Helper text says it opens Google Maps with this day's pinned locations. The whole-trip view offers per-item links only.
- **MAP-7:** The map uses only data in the authorized trip response, so a viewer sees the same pins as the owner. ATLAS-7 applies. The globe never shows itinerary stops.

### Planned prices and budgets

- **BUDGET-1:** The owner can enter an optional nonnegative planned amount and currency for any trip item and label it as an estimate or quote. A price cannot be saved without its currency.
- **BUDGET-2:** The owner can set an optional nonnegative trip budget with a currency and see planned totals by currency and item type.
- **BUDGET-3:** Costs are compared to the trip budget only when currencies match. Unlike currencies are never added together.
- **BUDGET-4:** Amounts supplied by external AI are marked as unverified estimates until the owner saves the price (amount, currency or label) in the item form, which makes it owner-entered. Price provenance is separate from the item's AI-draft tag. The app does not generate prices.
- **BUDGET-5:** Paid amounts, annual spending totals, split payments, and standalone expense entries are out of MVP scope.
- **BUDGET-6:** The trip page shows, for each currency used, the planned total and its breakdown by item type. For the budget's currency it also shows the amount left or the amount over budget. Other currencies are listed separately with a note that they are neither added nor converted. AI-supplied amounts carry an "unverified estimate" label per BUDGET-4. Type colors in breakdowns are neutral and never reuse the status colors for booking or budget state.
- **BUDGET-7:** The trip page shows a **Planned vs budget** tile only when a budget exists, and shows a planned total only when at least one price exists.

## 6. Data model and status definitions

- **User:** Google identity and verified email.
- **Trip:** owner, title, destination, start/end dates (start <= end), IANA time zone, optional nonnegative budget and currency, and optional approximate globe point with automatic/owner-set provenance.
- **TripViewer:** trip, invitee email, accepted Google user and verified email (when applicable), invitation status, invitation expiry, grant/revocation timestamps, and a single-use invitation token stored only as a cryptographic hash.
- **PlanItem:** trip, type, title, optional non-flight local date/time and time zone, location (place name), optional https map link, optional coordinates read from that link, notes, links, origin (external AI or owner), booking state and optional date-only due date, and optional planned amount/currency/estimate-or-quote label with price provenance (AI or owner). Flight items use structured `flightDetails` instead of generic date/time: optional planned departure date; airline; flight number; departure/arrival airport codes; and each airport's local date-time and IANA time zone. The trip's IANA time zone determines booking due/overdue state.

The booking list is derived from plan items marked **Needs booking**; it is not a separate task record. Import workflow states are **Pasted response** → **Preview** → **Accepted trip items** or **Cancelled/Rejected**. Accepted AI-drafted items retain a visible unverified origin tag; there is no separate suggestion workflow state. Booking state is independent: **Not required**, **Needs booking**, or **Booked**. Imported AI data never sets **Booked**. Planned prices are distinct from actual paid amounts; actual payment data is not collected in the MVP. Invitation states are **Pending**, **Accepted**, **Expired**, or **Revoked**. An invitation is accepted only after a matching verified Google identity signs in.

## 7. Security, privacy, and reliability

- Deny access by default. Check authentication and trip ownership/viewer membership on the server for every protected page, API request, and dashboard aggregate.
- Use HTTPS and secure `HttpOnly` session cookies. Keep OAuth secrets server-side and out of the browser bundle/local storage.
- The MVP does not send prompts or imported responses to an AI provider. The user chooses an external AI tool and copies the trip brief there; explain that the external provider’s data policies apply.
- Do not collect passport or payment-card data. Warn against sending booking codes to external AI tools. All trip data fields in the MVP are visible to invited viewers.
- Validate URLs (imported and item links http or https; map links https only; bounded length; no user information) and render user-provided text safely. Do not log map links or coordinates. Open external links in a new tab with `noopener noreferrer`, and never fetch them server-side. Do not expose trip content in anonymous routes, public metadata, search indexes, or shared caches.
- If hosted at a public address, only sign-in is public. A VPN-only deployment is optional and requires each viewer to connect to the private network.
- Google sign-in unavailability must not expose trip data. Import validation errors must preserve the pasted response in the current session so the owner can retry; save failures must preserve unsaved edits and provide a retry path. The app has no AI or email provider dependency in the MVP.
- Core trip viewing and editing must work on current mobile and desktop browsers, with keyboard-accessible forms, controls, and error messages.
- Define account/trip deletion and backup retention before launch.

## 8. Validation and MVP acceptance

Validate the import workflow with real trips before expanding integrations. In a small pilot, observe whether owners can get a usable response from their chosen external AI, how often import succeeds without JSON editing, how many imported items they keep/edit/skip, and whether they use booking due dates. Measure the time spent in the app separately from time spent in the external AI chat.

The MVP is acceptable when:

- An owner can create multiple trips and find owned/shared trips from the dashboard.
- Authorized trips with resolved points appear on the globe and all trips remain available in the synchronized list; an owner can correct/clear a point, while a viewer cannot. The list still works when the globe fails to load.
- The supplied prompt produces a response that can be pasted, validated, previewed, and accepted without the owner editing raw JSON.
- Invalid responses explain how to recover and never create partial or misleading trip data.
- A trip can be created with zero items; date-only non-flight items appear under **Unscheduled** for their date, non-flight items without a date appear under **Undated**, and flight placeholders without a planned date appear under **Undated flights**.
- An owner can edit trip details. Changing the trip date range preserves item dates and warns about out-of-range items; changing the trip time zone warns about and consistently updates inherited local date-time interpretation and booking due/overdue status without changing explicit item or airport time zones.
- Imported items are never shown as confirmed bookings without owner confirmation, and every accepted item can be manually edited.
- A flight item cannot be marked **Booked** until departure and arrival airport codes, local date-times, and time zones are present.
- A user can enter item prices and a trip budget and see correct same-currency planned totals, with amount left or over budget only for the budget's currency and unlike currencies never combined.
- An owner can add an itinerary item from the trip page (floating button or the end of any day) and can edit or delete any event from the three-dot menu on its row; a deletion survives closing the tab and can be undone for 10 minutes; the dashboard has no event controls; a viewer sees none of these controls. All of this works by keyboard with focus kept on a sensible control.
- A saved Google Maps, Apple Maps or OpenStreetMap link with coordinates pins its stop; a shortened, Amap or Baidu link, or one the app cannot read, leaves the item unpinned with a clear message. Import never pins. A look-alike host is labeled by its real host. No map, tile, geocoding or font request to a third party is made by the trip page.
- Whole trip and per-day views show the same items and numbering, and a single-day view can open that day in Google Maps on click.
- Booking tasks with date-only due dates appear as due on that date and overdue beginning the next date in the trip time zone; they clear when marked booked.
- An unauthenticated visitor cannot retrieve trip content; a viewer can see only invited trips and cannot edit them; access revocation takes effect on subsequent requests.

## 9. Roadmap and decisions

### Later: paid spending

If itemized planned prices prove useful, add actual paid amount and paid date to each trip item. A dashboard **Recorded trip spending** summary could then total paid amounts by payment year across trips the owner owns, grouped by currency. It must not imply complete accounting; shared trips and unrecorded purchases would be excluded. Split payments and standalone expenses remain separate decisions.

### Later: currency conversion (deferred)

Unlike currencies are never combined in the MVP (BUDGET-3). Two later options: an owner-entered exchange rate per trip that yields a clearly labeled, display-only converted total beside the per-currency totals (no external request); or live rates fetched server-side from a rates provider, which needs a provider decision, a privacy review (only currency codes leave the server), a rate timestamp shown with every converted figure, and a fallback when rates are unavailable. Stored prices are never rewritten by conversion.

### Later: reduce import friction

Allow arbitrary AI responses or free-form itinerary text and use an AI provider inside the webpage to convert them into the same validated internal format. This removes strict JSON requirements but adds cost, data processing, privacy review, and parsing uncertainty.

### Later: native planning and trip data

Generate/refine plans in the webpage and add the in-page AI copilot after the import flow is validated. Weather, live flight status, packing lists, file uploads/OCR, email/calendar/booking integrations, automatic currency conversion, email reminders, offline use, and companion editing are also later candidates.

### Decisions before implementation

1. Confirm JSON v1 and publish the schema, example, and repair prompt.
2. Choose which external AI tool(s) to test in the pilot; do not promise compatibility with every model.
3. Confirm that viewer access exposes all item prices and links and that shared editing can wait.
4. Confirm that dashboard due dates are sufficient for MVP without email notifications.
5. Choose public sign-in hosting or VPN-only access for all participants before deployment; the implementation baseline is an allowlisted public sign-in shell with all trip data private.
6. Approve or drop TRIP-7 (import an AI plan into an existing trip).
7. Approve the visual direction in [`trip-page-v1.md`](docs/design/trip-page-v1.md), including the forest accent for Booked and under budget.
8. Choose the later currency-conversion option (owner-entered rate or server-side live rates).
