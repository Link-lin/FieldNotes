# Field Notes: implementation handoff

Last updated 28 Sep 2026. Read this first, then [AGENTS.md](../AGENTS.md). Keep this file to about one page: replace sections rather than adding to them; history is in git.

## Where things stand

- **Branches:** new work goes on a branch; the owner reviews it, merges it into `main` and pushes. Lint, typecheck, all 187 tests and the production build pass.
- **Built:** everything listed under "Built so far" in the [README](../README.md): sign-in with an owner allowlist, trips and the globe dashboard, the trip page (itinerary, a dedicated Bookings view, day tabs, events, costs, outline day map with optional Google road route), the event view and editor with an embedded Google map, AI import from an external chat, read-only viewer invitations, account deletion, pilot counts, and test trips. Dashboard cards show a compact per-trip booking shortcut instead of a cross-trip task list.
- **Not built:** TRIP-7 (import into an existing trip, proposed) and ATLAS-4's click-the-globe point picker (catalog search only).
- **Dashboard layout:** the trip-list pane now starts wider on desktop and has a draggable, keyboard-operable divider. Its width is saved on this browser; Enter or double-click resets it. Phones keep the stacked layout. The globe redraws when the stage changes width. Browser-checked at 1800 px desktop, 1200 px short desktop and 390 px phone widths; drag, keyboard limits, reload persistence, reset and no horizontal overflow work.
- **Trip layout:** the trip page uses the full viewport width inside side margins that grow to 72 px on wide screens. The Itinerary figures form one slim bar at the right end of the Itinerary/Bookings row, the header has the full width with an **Up next** card (from 1,280 px) and the stamp at its right edge, and from 1,061 px the map column is 30% of the window (340 to 560 px), with its day, map kind, **Outline / Road route** and **Google Maps ↗** in one row. A selected-day map is sticky and never taller than the window. Bookings uses a descriptive rail plus two-column task lists. The full-width layout was browser-checked at 1800, 1400, 1200, 390 and 320 px; the margins, figures bar and map card have not been.
- **Not yet verified by hand:**
  - Viewer invitations with two real Google accounts: the sign-in round trip after opening a link, a brand-new invitee passing the sign-in gate, and **Switch Google account**.
  - After the last change, that the Road route on Hawaii day 1 starts at the airport by name. Re-run the seed first.
  - The import preview's one-line card summaries (time, place, price) and **Expand all** / **Collapse all**.
  - The trip Bookings actions: **Mark booked** with **Undo**, and setting/removing a book-by date (including focus when a task moves between urgency groups). Re-run the seed first. Desktop and phone navigation from the dashboard shortcut into Bookings, phone event return, empty states and no phone overflow have been browser-checked.
  - The phone itinerary tile strip (600 px and narrower).
  - The trip page at about 1,100, 1,400 and 2,000 px: the **Up next** card (Hawaii before the trip, Kauaʻi during it; re-run the seed first), the figures bar beside the view switch (and wrapping below it), the narrower map column, the one-row map controls, and a long day's stop list scrolling inside the map card.
- **The AI import pilot has not run.** It needs real travel plans and external AI tools, so don't describe it as done.

## Run it

1. `npm install`, then `npm run dev`. This starts the local database if needed, applies migrations and starts the app; Ctrl+C stops both.
2. Sign in once, then run `npm run db:seed:hawaii` in another terminal to load the test trips. Run it again to reset them.
3. Before every commit, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.

`.env.local` needs `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `TRIP_OWNER_EMAILS` and, for maps, `GOOGLE_MAPS_EMBED_API_KEY` (see the README). Never commit or overwrite it.

## Next steps

1. Do the hand checks above. For phone widths, use the browser's device mode (in Chrome, ⌥⌘I, then ⇧⌘M).
2. Run the AI import pilot with real plans and read `npm run pilot:report` weekly: clean previews, skipped items, edits per imported item, and due-date use. Decide on TRIP-7 afterwards.
3. Remaining product-review items, highest value first:
   - **I4:** date pickers in the import preview once a value is valid.
   - **I7:** less repetition in the timeline ("Time not set", empty flight placeholders).
   - **I10:** pins and stop-list entries open the event view, and an open desktop panel keeps its own address (the trip page still accepts legacy `?event=` links, and phones have an event page).
4. Candidate features: calendar (.ics) export, printable day sheets, duplicating a trip as a template, and day notes.

## Open decisions for the owner

- **Pinning:** allow owner-confirmed geocoding of place names? This would change MAP-2.
- **Invitations:** should Gmail addresses match regardless of dots and `+tags`?
- **Before launch:** hosting (public sign-in or VPN-only) and backup retention.
- **Pilot:** which AI tools, and how many trips.
- **Later scope:** TRIP-7; owner-only fields, which conflict with ACCESS-8; the currency-conversion option.

## Working notes

- **iCloud:** the folder is under iCloud-synced `~/Documents`. iCloud sometimes leaves untracked conflict copies (`name 2.ts`, `.git/index 2`). Don't commit them. Copies inside `.next` (such as `.next/types/routes.d 2.ts`) break `npm run typecheck`; the next `npm run build` replaces that folder and removes them.
- **Scratch:** `.e2e/` holds browser-check bundles. It is gitignored and safe to delete.
- **Git:** work on a branch and merge into `main`; the owner pushes to https://github.com/Link-lin/FieldNotes.git.
- **Pinned versions:** vitest 3.2.7 (4.x failed to install) and kysely 0.28.x.
- **Sandboxed runs:** the database tests start embedded PostgreSQL, which can't create shared memory inside some agent sandboxes; run `npm test` unsandboxed there.
- **Agent sessions:** a Cowork session reaches this folder from a Linux VM. It runs checks in a separate Linux clone, and git needs file-deletion permission here or it leaves `.git/*.lock` files.
- **Reference:** the product review (27 Sep, with evidence) and the Maps key setup notes are in the Claude project "Travel Planner".
