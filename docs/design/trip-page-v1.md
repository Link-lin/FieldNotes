# Trip page v1 — trip view, day map, costs and owner actions

**Status:** First-release design, as built. Subordinate to [`PRD.md`](../../PRD.md) (TRIP-1–10, MAP-1–9, BUDGET-4, BUDGET-6–7, ACCESS-8–11) and the [technical design](technical-design.md#trip-page-and-day-map). Last revised 28 Sep 2026.
**Reference:** the interactive "Field Notes Atlas" prototype (private Claude artifact, sample data) shows the look. This document and the PRD govern behavior and data; the prototype's floating-point money, in-memory data, stand-in sign-in and Google Fonts loading do not carry over.

## Visual direction

A warm paper-and-ink look taken from the two reference repositories. It is light only. The Figma screens still show an earlier navy and lake-blue treatment and need updating.

| Token | Value | Use | Contrast |
| --- | --- | --- | --- |
| Paper | `#FAF5E8` | Page background, with a very faint paper grain | — |
| Card | `#FFFDF6` | Cards, tiles, dialogs | — |
| Line | `#E4D9BF` | Dividers and decorative borders only | decorative |
| Control border | `#8E8066` | Input, select and filter borders | 3.5:1 on paper |
| Ink | `#3A3026` | Text, primary buttons, timeline | 11.8:1 |
| Ink 2 | `#675C4C` | Secondary text | 6:1 |
| Ink 3 | `#766A55` | Small labels, help text, times | 4.9:1 on paper, 5.2:1 on card |
| Vermilion | `#DE4F2A` | Fills, markers, bars and large display text only (3.7:1) | not for small text |
| Vermilion ink | `#A63615` | Vermilion text, and the fill behind white text (numbers, danger buttons) | 6.1:1 on paper; white on it 6.6:1 |
| Vermilion soft | `#F8DACD` | Tag and highlight backgrounds | — |
| Forest | `#516B55` (soft `#DDE6D6`) | Booked state and under-budget bar only | — |
| Ticket blue | `#DCEBEE` / `#23414B` | Flight boarding-pass card | 8.9:1 |

Cost breakdown colors by type are neutral inks and blues; they never reuse vermilion or forest, which mean booking and budget state.

Type: Source Serif 4 for headings and figures, IBM Plex Mono for small uppercase labels, the system sans for body text. Fonts are self-hosted (no Google Fonts request). Pill buttons, 24 px card radius. Interactive targets are at least 24 × 24 px, and at least 44 px tall on touch screens for primary actions. **Decision to confirm:** [`atlas-v1.md`](atlas-v1.md) rejected a green theme. Forest is used only as a small semantic accent, never as a brand or surface color.

## Pages and states

**Sign-in.** A single card with **Continue with Google**, plus the ACCESS-9 states. Denied says "This Google account is not set up for Field Notes. Try another account, or ask the trip owner for an invitation." and offers **Switch Google account**. Wrong account says "This invitation is for a different Google account" and offers a switch-account action. Nothing behind the card renders until a session exists; a deep link is kept as the redirect target.

**Dashboard.** Hero with **New trip** and **Create from an AI plan**; a "Travelling now" ticket (day *N* of *M* with a progress bar) and a "Next departure" ticket (days to go); the globe and synchronized list from [Atlas v1](atlas-v1.md). Trip cards offer **Open trip**, a globe action, and a relative-time label ("in 50 days", "day 5 of 8"). Events are added, edited and deleted only on the trip page. The dashboard's **Still to book** list uses the same task rows as the trip page (see Booking lists), with the trip's name after each task.

**Trip page** (`/trips/[tripId]`). Changing tabs replaces the address rather than adding history. Escape returns to the dashboard only when no menu, dialog or text field has focus. Top to bottom:

1. Back to all trips, status and role tags, title, destination, a postmark stamp (city, start month and year, length), and owner actions: **Add to itinerary**, **Edit trip** (which also holds **Delete trip**), **Share**, and **Show on globe** (when the trip has a point). Viewers see only **Show on globe**. **Import AI plan** would join the owner actions if TRIP-7 is approved.
2. Summary tiles (TRIP-4): time to departure or day *N* of *M*, length, events, pinned, straight-line distance, planned versus budget, items to book.
3. Tabs (ARIA tabs with arrow keys): **Whole trip** (default), then one per date in the trip range, plus **Outside trip dates** tabs when needed. Each shows the trip-day number, event and pin counts, and a **Today** marker. Empty days say "Nothing planned". Switching tabs eases the tab colours (0.28 s) and glides the strip to keep the chosen tab in view; the new timeline slides in about 28 px from the side of the chosen tab and fades up (0.32 s), its first eight events settle in 35 ms apart, and the map card's contents settle as it changes. Reduced motion switches instantly.
4. Two columns. Left: day sections with the timeline, then **Undated flights** and **Undated** in Whole trip; right (sticky on wide screens, first on phones): the day map and stop list.
5. **Planned costs**, then **Still to book** (read-only for viewers) and **Globe location**. Events deleted during this visit appear under **Recently deleted** after the last day, each with **Restore**, for 10 minutes.

**Timeline rows.** A numbered marker matches the pin number, then time, title, place with one **Open in [provider]** pill (Google Maps when no link is saved), and tags (type, price, booking state, AI draft). Flights are a boarding-pass card with route codes and price. An item without a pin says **Not on the map yet**. Owners see a three-dot button at the top right of every event row, always visible, with room reserved so titles never run under it. It opens a menu with **Edit event** and **Delete event**: click, Enter or Space opens it, arrow keys move, and Escape, Tab or an outside click closes it and returns focus to the button. Delete takes effect at once and shows a toast with **Undo** that takes focus, stays until dismissed or at least 10 seconds, and pauses while hovered or focused; focus then moves to the next event's menu button, or to the day's add row. Each day ends with a dashed **Add an event to this day** row. A floating **Add to itinerary** button stays on screen for owners; toasts sit above it and never overlap it.

**Day map** (MAP-3 to MAP-9). A subtle grid overlays a bundled outline map with Natural Earth 1:10m coastlines and country borders, plus city labels when room permits. It is labeled "Outline map · no streets". Numbered pins, dashed same-day route lines (no flight legs), scale bar, north arrow, **+**/**−** buttons, wheel zoom only while the pointer is over the map (handing scrolling back to the page at its limits), pinch zoom, drag pan, a one-finger swipe on touch screens that scrolls the page, **Reset view** when zoomed, including zooming out to twice the initial view width. Pins and outlines share one projection. Pins that nearly coincide merge into one marker listing their numbers. Labels hide on collision. Below it, a stop list with straight-line distances ("18 km from 1"). The single-day view adds **Open this day in Google Maps** above the map, with the helper text "Opens Google Maps with this day's pinned locations." Hovering or focusing a timeline row, a stop-list row or a pin highlights all three; Enter or Space on a pin scrolls to and highlights its event. At local zoom the outlines remain approximate. On a day with pinned stops and an Embed API key, **Road route** switches to a user-opened Google iframe with driving or walking routes, Google’s markers, and the same Field Notes stop list below. Flight breaks or more than 22 stops create selectable route segments. **Outline** restores the custom pins and unloads Google. Switching days also resets to Outline. The road view explains that opening it sends that segment’s coordinates to Google; the outline sends none.

**Event view and editor** (TRIP-10, MAP-8). The whole row is clickable (one stretched details button under the row, also opened with Enter or Space; its links and three-dot menu stay above it and keep working). At widths above 600 px, an 820 px panel slides in from the right edge (0.38 s, fast-out ease, transform only) while a paper-coloured wash with a slight blur fades the trip page (0.3 s); closing reverses both in about a quarter of a second. At phone widths, the event opens as a full page at its own URL, with a return to the trip. The sticky bar holds **‹ Previous**, **Next ›**, **Edit event** for the owner, and a close or trip-return control. Content: the day, date and time line with the stop number, title, type and booking tags, Google map (240 px, rounded, a quiet placeholder until it loads; "Map by Google. Opening an event sends its place to Google."), flight card for flights, place with its map link, booking and price, links and notes. The owner edits notes in the view. They save after a short pause in typing, when the field loses focus and when leaving the event, with Saving…, Saved and error states and a counter near 5,000 characters; viewers read them. Leaving through the view controls waits for a pending save; on failure it stays open and asks **Stay** (focused) or **Leave without saving**. **Edit event** changes the same surface into a form: editable large title, saved-place map with an update-after-save note, then Time & type, Booking & planned price, Place & map, and Notes. The editor saves explicitly and asks before discarding unsaved edits through its controls. On desktop, focus goes to the close button on open and back to the row on close; Escape and the faded page also close it. Reduced motion shows and hides it without movement.

**Highlight.** A soft vermilion wash and left accent edge behind the entry, a glow ring on its number, the time in vermilion ink, and a glowing pin. The flight card is never covered by a solid fill.

**Booking lists** (BOOK-3, BOOK-4). Tasks are sorted by book-by date; an overdue task is in vermilion ink with a warning icon. A task's title opens its event: the side panel at widths above 600 px (from the dashboard, over its trip page), or the event page on phones. Closing the panel returns focus to the task, and Back from the trip returns to the dashboard with focus on it. Below each task the owner sees **Mark booked** (for a flight without both airports and times, a note to add them instead) and **Set book-by date** or **Change date**, which turns the book-by line into a date field with **Save**, **Remove date** and **Cancel**; Escape cancels. **Mark booked** removes the task and shows a toast with **Undo** that takes focus, as Delete does; Undo brings the task back with its date, and otherwise focus moves to the next task. Viewers see the tasks and can open them, with no actions.

**Costs** (BUDGET-6–7). One card per currency: code, number of prices, total, a bar for amount left of the budget (vermilion and "Over budget by …" when exceeded) only in the budget currency, a stacked bar and legend by type in neutral colors, and an "unverified AI estimate" note while any AI price remains. When several currencies exist, a note says they are never added or converted and only the budget currency counts toward the budget. Currency codes must be real ISO 4217 codes. Currency conversion is deferred (PRD roadmap).

## Dialogs

One modal pattern: focus trap with the page behind made inert, Escape and backdrop close, focus on the first field (or first button), focus returned to the trigger or its re-rendered equivalent, and error text tied to its field that moves focus there.

- **Add to itinerary / Edit event** (the same TRIP-9 fields): Add uses a dialog; its date is the day in view, or empty from Whole trip. Edit is pre-filled in the event panel or page above. For an item with imported links, **Use as map link** adopts one.
- **Edit trip / New trip:** title, destination, start and end dates, time zone, optional budget and currency. The time-zone picker lists the destination's zones and this device's zone first, then a short list of about 60 zones ordered by offset, with every IANA zone one step away. Event and flight-airport zones use the same picker. Changing dates warns about events that fall outside the new range. Edit trip ends with a **Delete trip** danger zone that opens a typed-name confirmation.
- **Create from an AI plan:** copy a prompt (the optional brief suggests a title from destination and dates), paste JSON v1 (a Markdown code fence is accepted), preview, confirm. The preview shows each item as a card: its title and tags, then its time, place and price on one line (a flight shows its airports with their local times, and a long place name is shortened so the price stays in view). A card opens to edit the item; cards with issues start open and reopen when **Review creation** finds problems, and **Expand all** and **Collapse all** above the list open or close every card. Items arrive as unverified drafts, never Booked, and never pinned. On a trip, **Import AI plan** appends items (TRIP-7, proposed).
- **Event side panel:** the same focus rules through the shared `useDialog` hook, but it slides in from the side and fades the page rather than dimming it. The phone event page uses normal page navigation (see Event view and editor above).
- **Share:** notice of what viewers see, an email field, the one-time link shown once, and the list of people with **Revoke** and **Create new link**.
- **Account menu:** name, email, roles, **Sign out**, **Delete my account** (lists owned trips that will be deleted; type DELETE).

## Motion

Everything here is decorative and off under reduced motion, including pseudo-element animations: page fade and rise, staggered cards, count-up numbers, one globe intro rotation under two seconds, a marker pulse on upcoming trips only, a slowly moving dashed globe ring and selection ring, pins popping in, the marching route line, timeline drawing itself, scroll reveal, stamp-in. Looping motion stops within 10 seconds of the last interaction. Status is always carried by shape, text or number as well.

## Acceptance checks

- An owner reaches **Add** without scrolling on the trip page, and the three-dot menu with Edit and Delete on every event row, at desktop and phone widths; the dashboard shows no add, edit or delete controls for events; a viewer sees no owner controls.
- After Delete, focus is on **Undo**; after Undo or closing any dialog, focus is on a sensible control, never lost to the page body.
- Whole trip and each day show the same events and numbering; the pin numbers equal the timeline numbers; day numbers count from the trip start date.
- A Google Maps, Apple Maps or OpenStreetMap link with coordinates pins the stop; a shortened, Amap, Baidu, look-alike-host or imported link does not; the page makes no request to a tile, geocoding, map or font service until an event's side panel or the optional Road route opens, and then only the Google Maps Embed API frame for that view.
- A trip with two currencies shows two cost cards, no combined total, and a budget comparison only in the budget currency.
- Text meets 4.5:1 and control borders 3:1 against their background.
- With reduced motion set, nothing animates and nothing is hidden waiting for an animation.
- Keyboard: pins, tabs, menus, dialogs, toasts and the floating button are reachable, with visible focus.
