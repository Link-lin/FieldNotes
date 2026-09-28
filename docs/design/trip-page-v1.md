# Trip page v1 — trip view, day map, costs and owner actions

**Status:** First-release design, subordinate to [`PRD.md`](../../PRD.md) (TRIP-1–9, MAP-1–7, BUDGET-4, BUDGET-6–7, ACCESS-8–11) and the [technical design](technical-design.md#trip-page-and-day-map). Revised 26 Sep 2026 after a design and accessibility review.
**Reference:** the interactive "Field Notes Atlas" prototype (private Claude artifact, sample data). The prototype shows behavior and look. This document and the PRD govern behavior and data. The prototype's money sums use floating-point, its data lives in memory, its sign-in is a stand-in, and it loads fonts from Google Fonts; none of that carries over.

## Visual direction

A warm paper-and-ink look taken from the two reference repositories, replacing the navy and lake-blue treatment in the earlier Figma screens (the Figma file still needs updating). It is light only.

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

**Sign-in.** A single card with **Continue with Google**, plus the denied, invitation-landing and wrong-account states from ACCESS-9. Nothing behind it renders until a session exists; a deep link is kept as the redirect target.

**Dashboard.** Hero with **New trip** and **Create from an AI plan**; a "Travelling now" ticket (day *N* of *M* with a progress bar) and a "Next departure" ticket (days to go); the globe and synchronized list from [Atlas v1](atlas-v1.md). Trip cards offer **Open trip** and a globe action. The dashboard has no event controls: events are added, edited and deleted only on the trip page.

**Trip page** (`/trips/[tripId]`), top to bottom:

1. Back to all trips, status and role tags, title, destination, a postmark stamp (city, start month and year, length), and owner actions: **Add to itinerary**, **Edit trip** (which also holds **Delete trip**), **Share**, **Import AI plan** (only if TRIP-7 is approved), and **Show on globe**. Viewers see only **Show on globe**.
2. Summary tiles (TRIP-4): time to departure or day *N* of *M*, length, events, pinned, straight-line distance, planned versus budget, items to book.
3. Tabs (ARIA tabs with arrow keys): **Whole trip** (default), then one per date in the trip range, plus **Outside trip dates** tabs when needed. Each shows the trip-day number, event and pin counts, and a **Today** marker. Empty days say "Nothing planned".
4. Two columns. Left: day sections with the timeline, then **Undated** in Whole trip; right (sticky on wide screens, first on phones): the day map and stop list.
5. **Planned costs**, then **Still to book** (read-only for viewers) and **Globe location**.

**Timeline rows.** A numbered marker matches the pin number, then time, title, place with **Open in [provider]** and **Directions** pills, and tags (type, price, booking state, AI draft). Flights are a boarding-pass card with route codes and price. An item without a pin says **Not on the map yet**. Owners see a three-dot button at the top right of every event row, always visible, with room reserved so titles never run under it. It opens a menu with **Edit event** and **Delete event** (Enter or Space opens, arrows move, Escape or Tab closes). Delete takes effect at once and shows a toast with **Undo** that takes focus and stays until dismissed or at least 10 seconds; focus then moves to the next event's menu. Each day ends with a dashed **Add an event to this day** row. A floating **Add to itinerary** button stays on screen for owners; toasts sit above it and never overlap it.

**Day map** (MAP-3 to MAP-9). A subtle grid overlays a bundled outline map with Natural Earth 1:10m coastlines and country borders, plus city labels when room permits. It is labeled "Outline map · no streets". Numbered pins, dashed same-day route lines (no flight legs), scale bar, north arrow, **+**/**−** buttons, wheel zoom that hands scrolling back to the page at its limits, pinch zoom, drag pan, **Reset view** when zoomed, including zooming out to twice the initial view width. Pins and outlines share one projection. Pins that nearly coincide merge into one marker listing their numbers. Labels hide on collision. Below it, a stop list with straight-line distances ("18 km from 1"). The single-day view adds **Open this day in Google Maps** above the map with a line of helper text. Hovering or focusing a timeline row, a stop-list row or a pin highlights all three; Enter on a pin scrolls to its event. At local zoom the outlines remain approximate. On a day with pinned stops and an Embed API key, **Road route** switches to a user-opened Google iframe with driving or walking routes, Google’s markers, and the same Field Notes stop list below. Flight breaks or more than 22 stops create selectable route segments. **Outline** restores the custom pins and unloads Google. Switching days also resets to Outline. The road view explains that opening it sends that segment’s coordinates to Google; the outline sends none.

**Event view and editor** (TRIP-10, MAP-8). The whole row is clickable (one stretched details button under the row; its links and three-dot menu stay above it and keep working). At widths above 600 px, an 820 px panel slides in from the right edge (0.38 s, fast-out ease, transform only) while a paper-coloured wash with a slight blur fades the trip page (0.3 s); closing reverses both in about a quarter of a second. At phone widths, the event opens as a full page at its own URL, with a return to the trip. The sticky bar holds **‹ Previous**, **Next ›**, **Edit event** for the owner, and a close or trip-return control. Content: the day, date and time line with the stop number, title, type and booking tags, Google map (240 px, rounded, a quiet placeholder until it loads; "Map by Google. Opening an event sends its place to Google."), flight card for flights, place and directions, booking and price, links and notes. The owner edits notes in the view (autosave with Saving/Saved and a counter near 5,000 characters); viewers read them. Leaving through the view controls waits for a pending save and stays open on failure. **Edit event** changes the same surface into a form: editable large title, saved-place map with an update-after-save note, then Time & type, Booking & planned price, Place & map, and Notes. The editor saves explicitly and asks before discarding unsaved edits through its controls. On desktop, focus goes to the close button on open and back to the row on close; Escape and the faded page also close it. Reduced motion shows and hides it without movement.

**Highlight.** A soft vermilion wash and left accent edge behind the entry, a glow ring on its number, the time in vermilion ink, and a glowing pin. The flight card is never covered by a solid fill.

**Costs** (BUDGET-6–7). One card per currency: code, number of prices, total, a bar for amount left of the budget (vermilion and "Over budget by …" when exceeded) only in the budget currency, a stacked bar and legend by type in neutral colors, and an "unverified AI estimate" note while any AI price remains. When several currencies exist, a note says they are never added or converted and only the budget currency counts toward the budget. Currency codes must be real ISO 4217 codes. Currency conversion is deferred (PRD roadmap).

## Dialogs

One modal pattern: focus trap with the page behind made inert, Escape and backdrop close, focus on the first field (or first button), focus returned to the trigger or its re-rendered equivalent, and error text tied to its field that moves focus there.

- **Add to itinerary / Edit event** (the same TRIP-9 fields): Add uses a dialog. Edit is pre-filled in the event panel or page above. For an item with imported links, **Use as map link** adopts one.
- **Edit trip / New trip:** name, destination, start and end dates, optional budget and currency; time zone joins these in the real app (DASH-6). Changing dates warns about events that fall outside the new range. Edit trip ends with a **Delete trip** danger zone that opens a typed-name confirmation.
- **Create from an AI plan:** paste JSON v1 (a Markdown code fence is accepted), preview, confirm. Items arrive as unverified drafts, never Booked, and never pinned. On a trip, **Import AI plan** appends items (TRIP-7, proposed).
- **Event side panel:** the same focus rules through the shared `useDialog` hook, but it slides in from the side and fades the page rather than dimming it. The phone event page uses normal page navigation (see Event view and editor above).
- **Share:** notice of what viewers see, an email field, the one-time link shown once, and the list of people with **Revoke** and **Create new link**.
- **Account menu:** name, email, roles, **Sign out**, **Delete my account** (lists owned trips that will be deleted; type DELETE).

## Motion

Everything here is decorative and off under reduced motion, including pseudo-element animations: page fade and rise, staggered cards, count-up numbers, one globe intro rotation under two seconds, a marker pulse on upcoming trips only, a slowly moving dashed globe ring and selection ring, pins popping in, the marching route line, timeline drawing itself, scroll reveal, stamp-in. Looping motion stops within 10 seconds of the last interaction. Status is always carried by shape, text or number as well.

## Acceptance checks

- An owner reaches **Add** without scrolling on the trip page, and the three-dot menu with Edit and Delete on every event row, at desktop and phone widths; the dashboard shows no event controls; a viewer sees no owner controls.
- After Delete, focus is on **Undo**; after Undo or closing any dialog, focus is on a sensible control, never lost to the page body.
- Whole trip and each day show the same events and numbering; the pin numbers equal the timeline numbers; day numbers count from the trip start date.
- A Google Maps, Apple Maps or OpenStreetMap link with coordinates pins the stop; a shortened, Amap, Baidu, look-alike-host or imported link does not; the page makes no request to a tile, geocoding, map or font service until an event's side panel or the optional Road route opens, and then only the Google Maps Embed API frame for that view.
- A trip with two currencies shows two cost cards, no combined total, and a budget comparison only in the budget currency.
- Text meets 4.5:1 and control borders 3:1 against their background.
- With reduced motion set, nothing animates and nothing is hidden waiting for an animation.
- Keyboard: pins, tabs, menus, dialogs, toasts and the floating button are reachable, with visible focus.
