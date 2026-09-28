# Field Notes: implementation handoff

Last updated 28 Sep 2026 (`main`, after fast-forwarding `feat/review-polish`). Read this first when picking the project up in a new session.

## Status

- **Review polish is merged into local `main`** (fast-forward of `feat/review-polish`, 14 commits from `c35934b` to `1f57461`; not pushed):
  - Notes-save failure, browser-checked with forced server errors (500 and 409) on desktop and the phone event page: the typed text stays, and Close, Escape, the faded page, Previous/Next and Edit event no longer leave silently. Before this branch a 409 or a server that stayed down left no way out but reloading; now leaving asks **Stay** (focused) or **Leave without saving**. A successful retry closes normally and the notes persist.
  - Road route with three or more pins: the test trips now have two three-stop days (day 1: HNL arrival, hotel, dinner; day 4: OGG arrival, rental car, hotel). The embed address was checked in a browser (origin, one waypoint, destination in page order, driving mode). Google's own drawing of that route still needs a look with the real key.
  - B3: the edit-trip date warning counts only events the new range pushes outside.
  - B4 was already fixed on `main` (the day map's empty state is neutral).
  - B5: on phones the header hides the duplicate **Atlas** link and **Bookings** stays on one line.
  - I2: the import budget warning offers **Use this budget ($1,200)** when the AI's budget is valid; nothing changes until the owner clicks. Checked end to end: import, use, create, trip shows the budget.
  - I5: the event form's zone and flight airport zones use the friendly zone picker (short list by offset, this device, the saved zone, show all).
  - I6: the event and flight forms note when a date is outside the trip; saving is still allowed.
  - After the user's road-route check with the real key: Google drew the three-stop route correctly but labelled the stops after nearby places. Flight arrivals are now sent as `HNL airport`, and the test hotel pin was moved onto the Outrigger Reef. Event rows and the event view keep one **Open in Google Maps** link per place (Directions removed; Google Maps offers directions itself).
  - Day tabs now animate: the new timeline slides in from the chosen tab's side with its events staggered, tab colours ease, the strip keeps the chosen tab in view, and the map card settles. Browser-sampled in both directions and with reduced motion (instant).
  - Checks passed before each commit: lint, typecheck, `npm test` (176 tests) and the production build.
- **Event view and editor changes are merged into local `main`** (not pushed):
  - On desktop the event panel is 820 px wide. **Edit event** uses the same panel, with a wrapping title, the saved-place map, and grouped time, booking, place and notes fields. The add form remains a dialog.
  - At phone widths (600 px and below), event rows and Edit actions navigate to an authorized event URL. The same details and editor render as a full page with a return to the trip. A viewer remains read-only.
  - Leaving a detail view through its controls waits for notes to save; a failed save leaves the view open with typed notes intact. Leaving an editor through its controls asks before discarding unsaved changes. The save itself still uses the item version check.
  - Browser checked on the seeded Hawaii trip with a real Google map: wider desktop detail and editor, phone event URL and editor, long-title wrapping, and the unsaved-edit discard prompt. No trip data was changed during this check.
  - Checks passed before commit: lint, typecheck, 172 tests, and the production build. Tests needed an unsandboxed run because embedded PostgreSQL could not create shared memory inside the sandbox.
- **Day-map geography and road routes are merged into local `main`** (not pushed):
  - The default, provider-free outline now draws bundled Natural Earth 10m coastlines and country borders with city labels, aligned with the saved-coordinate pins. The map can zoom out to twice its initial width; Reset view appears after zooming either direction. The empty state is neutral for viewers.
  - A day with pins offers an optional **Road route** view using the existing `GOOGLE_MAPS_EMBED_API_KEY` and Maps Embed API. Google draws the road map, route and its markers; the Field Notes numbered stop list remains below. The owner or viewer can choose driving or walking and route segments. Flight arrivals can start a ground leg, but no road leg crosses a flight. The iframe mounts only after the user chooses Road route and unmounts on a day change or return to Outline.
  - Browser checked with the seeded Hawaii trip and the configured key: an Oʻahu driving route loaded in Chrome; the outline showed the coastline correctly at its initial and zoomed-out views. The key is a browser key. Restrict it in Google Cloud to the Maps Embed API and this site's HTTP referrers; Maps JavaScript, Routes and Directions APIs are not needed for this implementation. A route with three or more pinned stops has not yet been checked against Google in the browser.
  - Maps changes are in `src/features/trips/TripPage/MapPanel/`, `src/shared/map-links.ts` and `src/data/map-cities.json`; the geographic-data generator, PRD, trip-page design and technical design are updated. Checks passed: lint, typecheck, 172 tests, and the production build.
- **The core app is built and verified.** It covers:
  - Google sign-in (Auth.js, owner allowlist in `TRIP_OWNER_EMAILS`).
  - Trips: create, edit, time-zone change with preview, delete.
  - A one-screen dashboard on desktop: trips on the left; a globe on the right that fades under the list when zoomed.
  - The trip page: day tabs, events with a menu, Recently deleted, costs, day map, globe location.
  - Account deletion.
- **AI import is implemented on `main`:**
  - An owner with an existing ChatGPT/Gemini plan can copy a conversion prompt into that conversation and paste its JSON v1 response directly, without entering destination or dates in Field Notes. An optional trip brief builds a new-planning prompt for owners starting with an idea.
  - The owner can correct or skip items in a day-by-day preview, then confirm creation of a new trip. A pasted plan's budget is set or confirmed by the owner in preview; an AI-supplied budget alone is ignored.
  - Preview is read-only and explains malformed or unsupported JSON, trip and item errors, unknown fields, budget changes, and DST problems. The owner must explicitly remove unsupported item fields or skip the item.
  - Commit revalidates the normalized draft and creates the receipt, trip, and items in one transaction. Same-key retries return the same trip; deleted-trip retries return 410. Imported items and prices retain AI provenance, with no inferred map pin or booked state.
  - The owner can explicitly confirm an unchanged AI price in the item editor, changing its price provenance to owner-entered.
  - Review corrections keep source-format errors attached to their fields until the owner changes or removes them. Invalid null links and flight endpoints remain visible; optional nulls have an explicit omit action; draft and repeated-time errors update as the owner edits. `AGENTS.md` now reflects the import milestone.
- **Viewer invitations (ACCESS-3 to ACCESS-11) are implemented on `main`** (fast-forward merge of `feat/viewer-invitations`, head `12deade` before this note):
  - The owner's **Share** dialog on the trip page shows what viewers can see (ACCESS-8), invites one email, shows the copyable message with the link once, and lists viewers and invitations with status and expiry, **Revoke** (confirmed for an accepted viewer) and **Create new link**. Every link created while the dialog is open stays visible until it closes, and closing with an uncopied link asks first.
  - Links are `/invite#<token>`: 256 random bits, stored only as a SHA-256 hash, valid seven days. A new link replaces the old one in the same row. The owner's own email is refused; an accepted viewer must be revoked before a new link.
  - `/invite` removes the token from the address bar, stages it in a 15-minute HttpOnly cookie holding only the hash, then accepts for a signed-in visitor or offers Google sign-in that returns there. Wrong-account and invalid-link states reveal no trip, owner or invited email.
  - Acceptance compares the invitation email with the account's email as verified at account creation (Auth.js does not refresh it), binds the grant in one locked transaction, and is idempotent for the bound account. Revocation blocks the viewer's next request.
  - Server code is in `src/server/modules/invitations/`, routes under `src/app/api/trips/[tripId]/invitations` and `src/app/api/invitations/{stage,accept}`. Decisions are in technical design section 20.
- **Event side panel (TRIP-10, MAP-8) is implemented on local `main`:**
  - Clicking an event row, or Enter on its details button, slides a panel in from the right while the trip page fades behind it. It shows the day and time, tags, a live Google map, the flight card, place and directions links, booking and price, links and notes, with **Previous**/**Next** through the current tab and **Edit event** for the owner.
  - The owner's notes save as they type (`PATCH /api/trips/{tripId}/items/{itemId}/notes`); viewers read them.
  - The map uses Google's Maps Embed API and needs `GOOGLE_MAPS_EMBED_API_KEY` (a browser key restricted to the Maps Embed API and the site). It shows a flight's route, the owner's pin, or the place name. It loads only when the event panel or page opens; the CSP allows frames from `www.google.com` only and the frame sends only the site origin as referrer. Without a key the event view has no map.
  - Modal and the panel share `src/lib/use-dialog.ts`.
  - Initial checks: lint, typecheck, 145 tests and the build passed before each commit. A headless-browser run with seeded sessions covered opening by click and keyboard, the slide-in, focus, notes autosave, Previous/Next, Escape/close/faded-page close with focus back on the row, links and the menu not opening the panel, Edit event from the panel, the viewer's read-only panel, reduced motion, phone width and the embed addresses. The map could not load in that sandbox; a later Chrome check with the configured key loaded it (see the editor status above).
- **Review fixes B1, B2, I1 and F1 are on local `main`** (merged with the event and day-map work):
  - B1: `/import` no longer logs hydration error #418. Currency names are bundled (`src/shared/currencies.ts`) instead of coming from `Intl.DisplayNames`, whose names differ between Node and browsers. The time-zone picker also read this device's zone and the full zone list on the server; both are now read after hydration through `useClientValue` (`src/lib/client-value.ts`).
  - B2: the dashboard shows the viewer's own date ("today is 27 Sep"), read in the browser, instead of the server's UTC date.
  - I1: the map-link field accepts pasted coordinates such as `35.0116, 135.7681`. They are saved as a Google Maps search link for that point and pin the event; the field's hint says as you type whether the value will pin. The PRD's MAP-2 now allows this.
  - F1: daily pilot counts in a new `usage_counts` table (migration `0003_usage_counts`): import previews (clean, needing fixes, rejected), imported and manual trips and items, items skipped in preview, AI items edited or deleted, book-by dates set and items booked. No user, trip or content is stored; counting never fails a request. `npm run pilot:report` prints totals, weekly figures and rates. `npm run dev` applies the new migration itself.
  - Checks: lint, typecheck, `npm test` (157 tests) and the build passed before each commit. Browser checks in dev covered no hydration errors on `/import` in UTC, Los Angeles and Tokyo, the dashboard date in Honolulu versus UTC, pinning from pasted coordinates with the live hint, and a UI import with one skipped item followed by a correct `pilot:report`.
  - Also on this branch: CLI scripts explain a refused database connection instead of a bare "Migration failed:"; `npm run dev` starts the local database and applies migrations first (`scripts/dev.ts`); and `npm run db:seed:hawaii` loads test trips covering every trip-page, dashboard, cost, map and sharing state (see the README). Tests: 166, all passing.
- **Added since the first build:**
  - New-trip form:
    - destination suggestions;
    - the end date follows the start date;
    - a short time-zone list grouped by offset;
    - currency pickers that list recent currencies first.
  - Place data carries time zones.
  - The dashboard globe:
    - shows country borders and names, with more names as you zoom and none covering a marker;
    - zoom glides after the wheel stops, and a flicked drag coasts to a stop (`src/features/dashboard/Dashboard/Globe/globe-motion.ts`);
    - reduced motion skips both effects.
- **The code restructure is done and merged into `main`:**
  - One component per folder (`Name.tsx` and `Name.module.css`), nested under the component that uses it. Screens are in `src/features`; shared parts are in `src/components/{ui,layout}`.
  - Global CSS is in `src/styles`, in cascade layers, so component modules always win.
  - The server lives in `src/server/{core,auth,modules/<feature>}`, split into service, repository and mapper files. Route handlers are thin, using the `route()` wrapper in `src/server/core/http/route.ts`.
- **Checks on the AI import work now in `main` passed:** `npm run lint`, `npm run typecheck`, `npm test` (119 unit and DB tests), and `npm run build`. The earlier core milestone also passed browser checks against a standalone build. External ChatGPT/Gemini response quality still needs a real-plan pilot.
- **Checks on the viewer invitation work now in `main` passed before each commit:** `npm run lint`, `npm run typecheck`, `npm test` (140 unit and DB tests) and `npm run build`, run in a Linux copy of the repository with its own `npm ci`. A headless-browser run against a production build used database sessions seeded directly (no Google): the Share dialog (validation, own-email refusal, one-time message, copy, revoke with confirmation, new link, phone width), the invitation landing, the invalid-link and wrong-account states, viewer acceptance with no owner controls, idempotent reopening, and 404 after revocation.
- **Still to check by hand:** the full flow with two real Google accounts, including the OAuth round trip after staging, the sign-in gate for a brand-new invitee, and **Switch Google account**. The merge went ahead before this check.
- **Open question:** invitations match the normalized email exactly. Decide whether Gmail addresses should ignore dots and `+tags` when matching.
- **Not built yet:**
  - TRIP-7 (append an imported plan to an existing trip) remains proposed.

## Product review (27 Sep 2026)

A product-manager pass over the earlier `main` and `feat/event-panel` against the PRD, with a production build, seeded data and a headless browser (owner, viewer, phone width). The full review, with evidence, is `claude/product-review-2026-09-27.md` in the Claude project "Travel Planner". B1, B2, I1 (pasted coordinates only) and F1 are fixed on local `main`; B3, B4, B5, I2, I5 and I6 are done on `feat/review-polish`; the rest is open.

- **PRD gaps:**
  - ATLAS-4's "click the globe to choose a point" is not built (catalog search only).
  - The section 8 pilot has not run. The app now records its measures as daily counts (F1); time spent and response quality still have to be observed with the pilot owners.
  - Hosting, backup retention, TRIP-7 and the currency-conversion option are undecided.
- **Bugs:**
  - B1 (fixed): `/import` logged React hydration error #418 on every load (currency names and the time-zone picker).
  - B2 (fixed): the dashboard's "Today is" used the server's UTC date.
  - B3 (fixed on `feat/review-polish`): the date-range warning counted events already outside the trip.
  - B4 (fixed on `main`): the day map's empty state told viewers to edit.
  - B5 (fixed on `feat/review-polish`): on phones the header's Bookings count wrapped, and Field Notes and Atlas both linked to `/`.
- **Improvements, highest first:**
  - I1: pinning is too hard. Pasted coordinates now pin (fixed); owner-confirmed geocoding is still a decision (a MAP-2 change).
  - I2 (done on `feat/review-polish`): add "Use this budget" to the import budget warning.
  - I3: show time, place and price on collapsed import cards, with Expand all.
  - I5 (done on `feat/review-polish`): use the friendly time-zone picker in the event form.
  - I6 (done on `feat/review-polish`): warn when an event is dated outside the trip.
  - I8: compact the summary tiles on phones.
  - I9: make the booking lists actionable (open the event, Mark booked, set a book-by date).
  - Smaller: I4, I7, I10.
- **Feature proposals:**
  - Pilot counters (F1, built).
  - Calendar .ics export (F2).
  - Printable day sheets (F3).
  - Duplicate a trip as a template (F4).
  - Day notes (F5).
  - TRIP-7 after the pilot (F6).
- **Decisions for the owner:**
  - Pinning approach.
  - Pilot setup and counters.
  - Hosting and backups.
  - TRIP-7.
  - Owner-only fields (conflicts with ACCESS-8).
  - Gmail address matching for invitations.

## Where things are

- `PRD.md` holds the requirements, with IDs such as TRIP-7 and ACCESS-3.
- `README.md` covers setup, environment variables and a map of the layout.
- `AGENTS.md` and `.codex/skills/*` describe the real structure and rules:
  - `frontend-ui`
  - `backend`
  - `testing`
  - `feature-development`
  - `technical-design`
  - `code-review`
- The frontend-ui skill lists the CSS-module rules:
  - state goes in `data-*` attributes;
  - shared keyframes are used through `--kf-*` variables;
  - overrides of shared components are parent-qualified.
- `docs/design/technical-design.md` is the technical design. Section 12 lists the actual files; section 20 records implementation decisions.
- `docs/design/atlas-v1.md` specifies the dashboard and globe, and `docs/design/trip-page-v1.md` specifies the trip page.
- These define the AI import contract:
  - `docs/design/json-v1.schema.json`
  - `docs/design/import-prompt-v1.md`
  - `docs/design/import-example-v1.json`

## Working notes

- **Run it locally:**
  1. `npm install`
  2. `npm run dev`. It starts the embedded PostgreSQL if it isn't running, applies new migrations, then starts the app; Ctrl+C stops both. `db:start`, `db:migrate` and `dev:app` still run each part alone.
  3. Optional: after signing in once, `npm run db:seed:hawaii` in another terminal loads the test trips (Hawaii, a shared past Kyoto trip, an empty Lisbon trip). Re-run it to reset them. See the README.

  `.env.local` needs `AUTH_SECRET`, the Google client ID and secret, and `TRIP_OWNER_EMAILS` (see the README). Never commit it or overwrite it.
- **Before every commit:** run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.
- **Pinned versions:** vitest 3.2.7 (4.x hit an npm install bug) and kysely 0.28.x.
- **Git:** remote `origin` is https://github.com/Link-lin/FieldNotes.git. Work on a branch and merge into `main`. The owner pushes. On 28 Sep, local `main` fast-forwarded from `0893e57` to `3e52314`, adding 18 commits from `feat/event-panel`, `feat/review-fixes`, `feat/day-map-geography` and `feat/event-panel-inline-edit`. Post-merge lint, typecheck, 172 tests and the production build passed. Later on 28 Sep it fast-forwarded again to `feat/review-polish` (review fixes B3, B5, I2, I5, I6, notes-save exit prompt, one map link per place, airport names in road routes, day-tab motion). Local `main` is ahead of `origin/main`; nothing from these merges has been pushed. `feat/review-polish` can be deleted. The feature branch refs remain available for now.
- **iCloud:** the project folder is under `~/Documents`, which iCloud Drive syncs. iCloud sometimes leaves conflict copies named `name 2.ts` or `folder 2` (and `.git/index 2`) after git rewrites many files. They are untracked duplicates. Don't commit them. Moving the repo out of iCloud-synced folders avoids this.
- **Scratch:** `.e2e/` holds build bundles for browser checks. It is gitignored and safe to delete.
- **Agent sessions on this folder:** a Cowork session reaches the folder from a Linux VM, so it can't use the macOS `node_modules`; it runs checks in a separate Linux clone. Git there needs file-deletion permission for the folder, or it leaves `.git/*.lock` files that block the next git command.

## Next milestone

1. Re-run `npm run db:seed:hawaii`, then with the real Maps key check that Hawaii day 1's **Road route** starts at the airport by name, and try the day-tab animation.
2. Check viewer invitations with two real Google accounts (see Status) and fix anything it finds.
3. Pilot AI import with real plans and external AI tools. This has not been done yet; the counts are ready for it. Read `npm run pilot:report` weekly (clean previews, skipped items, edits per imported item, due-date use) before adding in-page AI generation or free-form parsing. Confirm whether TRIP-7 should be built.
4. Remaining review items: I3 (details on collapsed import cards, Expand all), I8 (compact phone tiles), I9 (actionable booking lists), the smaller I4, I7 and I10, and the owner decisions above.