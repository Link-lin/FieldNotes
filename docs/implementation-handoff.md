# Field Notes: implementation handoff

Last updated 3 Oct 2026. Read this first, then [AGENTS.md](../AGENTS.md). Keep this file to about one page: replace sections rather than adding to them; history is in git.

## Where things stand

- **Validation:** lint, typecheck, all 238 tests and the production build pass. Work on a branch and keep iCloud conflict copies out of commits.
- **Built:** everything listed under "Built so far" in the [README](../README.md): sign-in with an owner allowlist, trips and the globe dashboard, the trip page (itinerary, a dedicated Bookings view, day tabs, events, costs, outline day map with optional Google road route), the event view and editor with an embedded Google map, AI import from an external chat with optional owner-reviewed place lookup in the preview and event editor, read-only viewer invitations, account deletion, pilot counts, and test trips. Dashboard cards show a compact per-trip booking shortcut instead of a cross-trip task list.
- **Not built:** TRIP-7 (import into an existing trip, proposed) and ATLAS-4's click-the-globe point picker (catalog search only). Wanted next, not yet in the PRD or design: invitation emails sent by the app, an in-app AI chat, and WeChat sign-in.
- **Sharing roles:** each person a trip is shared with is a viewer, editor or owner (PRD ACCESS-5; technical design, "Roles"). Editors change events, bookings and notes; owners also edit the trip, share it, change roles and delete it; the creator is always an owner. The Share dialog picks a role per invitation and changes it in place (promoting to owner asks first). Covered by `tests/db/member-roles.test.ts`; not yet tried in the browser. Open questions: transferring a trip to someone else before deleting your account (it now deletes the trips you created for everyone), and whether editors should see who else has access.
- **Self-hosting:** `docker compose up -d` runs the app, PostgreSQL 17 and a one-shot migration, with an optional Caddy profile for automatic HTTPS (README, "Self-hosting with Docker"; technical design, "Container deployment"). It was built and run locally on Docker 29: migrations, `/api/health`, a session-backed dashboard, trip and flight creation (bundled place and airport data), cross-origin writes refused, backup and restore, restart, a non-root image with no baked-in secrets, and Caddy over its local certificate. It has not run on your server with your Google OAuth client and a real DNS name.
- **Dashboard layout:** returning users see a compact heading, create actions and current/next-trip links before the filters and trip list; the larger introduction appears when no trips exist. The trip-list pane starts wider on desktop and has a draggable, keyboard-operable divider. Its width is saved on this browser; Enter or double-click resets it. On phones with trips, the list comes before the globe. The globe redraws when the stage changes width. Browser-checked at desktop and 390 px phone widths for the compact view; earlier divider and responsive checks remain valid.
- **Trip layout:** the trip page uses the full viewport width inside side margins that grow to 72 px on wide screens. Two quiet itinerary highlights show timing and planned cost beside the Itinerary/Bookings switch; counts stay in day tabs, and distances in the map stop list. The header has an **Up next** card (from 1,280 px) and the stamp at its right edge. From 1,061 px the map column is 30% of the window (340 to 560 px), with its day, map kind, **Outline / Road route** and **Google Maps ↗** in one row. Timeline rows show a short summary and one map action; full notes and other links remain in the event view. A selected-day map is sticky and never taller than the window. Bookings uses a descriptive rail plus two-column task lists. The highlights, desktop event panel and phone return to a selected day were browser-checked; the margins and map card have not been checked at every breakpoint.
- **Not yet verified by hand:**
  - The Docker setup on your own server: your Google redirect URI (`<APP_ORIGIN>/api/auth/callback/google`), the `https` profile with a real DNS name, a first sign-in, and one backup restore.
  - Roles with the demo data (re-run the seed): as an **editor** on Osaka and a **co-owner** on Seoul, and Hawaii's Share list with its role pickers. Check the controls each role sees, promoting someone to owner, and an editor's edits appearing after a reload.
  - Viewer invitations with two real Google accounts: the sign-in round trip after opening a link, a brand-new invitee passing the sign-in gate, and **Switch Google account**. Also invite one Gmail account with an extra dot or a `+tag` to see the match.
  - After the last change, that the Road route on Hawaii day 1 starts at the airport by name. Re-run the seed first.
  - The import preview's one-line card summaries (time, place, price), **Expand all** / **Collapse all**, and its date and time pickers (paste a response with an invalid date to see the text field, then fix it).
  - The trip Bookings actions: **Mark booked** with **Undo**, and setting/removing a book-by date (including focus when a task moves between urgency groups). Re-run the seed first. Desktop and phone navigation from the dashboard shortcut into Bookings, phone event return, empty states and no phone overflow have been browser-checked.
  - The Whole trip map's shared marker for the Duke's return visit (Hawaii days 1 and 3): its number list, the stop list it opens, keyboard use and closing.
  - The timeline without "Time not set" and "No date" lines, and the slim cards for unscheduled flights (OGG → KOA, and the undated backup hop with no airports).
  - The trip page at about 1,100, 1,400 and 2,000 px: the **Up next** card (Hawaii before the trip, Kauaʻi during it; re-run the seed first), the narrower map column, the one-row map controls, and a long day's stop list scrolling inside the map card.
- **Place lookup:** it is owner-triggered and sends only the event place plus needed trip-destination context to Geoapify. Qualified locations no longer gain a conflicting multi-island suffix. Bounded fallbacks and name/region checks reject unrelated places; clear venues can be suggested below the old confidence cutoff. Live checks returned relevant matches for Grand Wailea, Waiʻānapanapa, Twin Falls, Rainbow Falls, Punaluʻu and Hāpuna; Mauna Kea remains ambiguous and unselected. Refresh preserves reviewed choices, stale requests cannot overwrite edits, and Google venue coordinates take precedence over camera coordinates. Independent review findings were fixed; regression checks cover addresses, ambiguity, refresh state and link parsing.
- **The broader AI import pilot has not run.** The owner completed a real 36-item Hawaii import: the saved trip shows 13 pins, and the Punaluʻu–Kīlauea Iki–Nāhuku Google road route loads. A separate production-build preview verified relevant suggestions, ambiguous places left unselected, explicit **Do not pin** choices preserved before and during refresh, and the correct final confirmation pin count. That check created no second trip. Existing trips are not retroactively pinned. Without `GEOAPIFY_API_KEY`, imports still work without automatic pins.

## Run it

1. `npm install`, then `npm run dev`. This starts the local database if needed, applies migrations and starts the app; Ctrl+C stops both.
2. Sign in once, then run `npm run db:seed:hawaii` in another terminal to load the test trips. Run it again to reset them.
3. Before every commit, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.

`.env.local` needs `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `TRIP_OWNER_EMAILS` and, for maps, `GOOGLE_MAPS_EMBED_API_KEY` plus optional `GEOAPIFY_API_KEY` for import place lookup (see the README). Never commit or overwrite it.

## Next steps

1. Do the hand checks above. For phone widths, use the browser's device mode (in Chrome, ⌥⌘I, then ⇧⌘M).
2. Broaden the import pilot beyond the checked Hawaii plan and external AI chat: review clean JSON rate, edits/skips, suggested and missed pins, ambiguous matches, provider failure/retry, and the resulting outline map. The shared prompt asks for specific known venues and omits unresolved locations; check whether each tested AI tool follows it. Read `npm run pilot:report` weekly and decide on TRIP-7 only after the pilot.
3. Remaining product-review item:
   - **I10:** pins and stop-list entries open the event view, and an open desktop panel keeps its own address (the trip page still accepts legacy `?event=` links, and phones have an event page).
4. Candidate features: calendar (.ics) export, printable day sheets, duplicating a trip as a template, and day notes.

## Open decisions for the owner

- **Before launch:** public sign-in or VPN-only (the Docker setup works behind either), and your backup schedule and retention.
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
