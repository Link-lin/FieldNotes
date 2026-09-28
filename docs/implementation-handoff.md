# Field Notes: implementation handoff

Last updated 28 Sep 2026 (review fixes B1, B2, I1 and F1 on `feat/review-fixes`, which sits on `feat/event-panel`). Read this first when picking the project up in a new session.

## Status

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
- **Event side panel (TRIP-10, MAP-8) is implemented on `feat/event-panel`** (not yet merged into `main`):
  - Clicking an event row, or Enter on its details button, slides a panel in from the right while the trip page fades behind it. It shows the day and time, tags, a live Google map, the flight card, place and directions links, booking and price, links and notes, with **Previous**/**Next** through the current tab and **Edit event** for the owner.
  - The owner's notes save as they type (`PATCH /api/trips/{tripId}/items/{itemId}/notes`); viewers read them.
  - The map uses Google's Maps Embed API and needs `GOOGLE_MAPS_EMBED_API_KEY` (a browser key restricted to the Maps Embed API and the site). It shows a flight's route, the owner's pin, or the place name. It loads only when a panel opens; the CSP allows frames from `www.google.com` only and the frame sends only the site origin as referrer. Without a key the panel has no map.
  - Modal and the panel share `src/lib/use-dialog.ts`.
  - Checks: lint, typecheck, 145 tests and the build passed before each commit. A headless-browser run with seeded sessions covered opening by click and keyboard, the slide-in, focus, notes autosave, Previous/Next, Escape/close/faded-page close with focus back on the row, links and the menu not opening the panel, Edit event from the panel, the viewer's read-only panel, reduced motion, phone width and the embed addresses. The map itself could not load in that sandbox (Google was unreachable), so **check the map with a real key**.
- **Review fixes B1, B2, I1 and F1 are on `feat/review-fixes`** (branched from `feat/event-panel`; neither is merged into `main`). Four code commits and this docs commit:
  - B1: `/import` no longer logs hydration error #418. Currency names are bundled (`src/shared/currencies.ts`) instead of coming from `Intl.DisplayNames`, whose names differ between Node and browsers. The time-zone picker also read this device's zone and the full zone list on the server; both are now read after hydration through `useClientValue` (`src/lib/client-value.ts`).
  - B2: the dashboard shows the viewer's own date ("today is 27 Sep"), read in the browser, instead of the server's UTC date.
  - I1: the map-link field accepts pasted coordinates such as `35.0116, 135.7681`. They are saved as a Google Maps search link for that point and pin the event; the field's hint says as you type whether the value will pin. The PRD's MAP-2 now allows this.
  - F1: daily pilot counts in a new `usage_counts` table (migration `0003_usage_counts`): import previews (clean, needing fixes, rejected), imported and manual trips and items, items skipped in preview, AI items edited or deleted, book-by dates set and items booked. No user, trip or content is stored; counting never fails a request. `npm run pilot:report` prints totals, weekly figures and rates. `npm run dev` applies the new migration itself.
  - Checks: lint, typecheck, `npm test` (157 tests) and the build passed before each commit. Browser checks in dev covered no hydration errors on `/import` in UTC, Los Angeles and Tokyo, the dashboard date in Honolulu versus UTC, pinning from pasted coordinates with the live hint, and a UI import with one skipped item followed by a correct `pilot:report`.
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

A product-manager pass over `main` and `feat/event-panel` against the PRD, with a production build, seeded data and a headless browser (owner, viewer, phone width). The full review, with evidence, is `claude/product-review-2026-09-27.md` in the Claude project "Travel Planner". B1, B2, I1 (pasted coordinates only) and F1 are fixed on `feat/review-fixes`; the rest is open.

- **PRD gaps:**
  - ATLAS-4's "click the globe to choose a point" is not built (catalog search only).
  - The section 8 pilot has not run. The app now records its measures as daily counts (F1, on `feat/review-fixes`); time spent and response quality still have to be observed with the pilot owners.
  - Hosting, backup retention, TRIP-7 and the currency-conversion option are undecided.
- **Bugs:**
  - B1 (fixed): `/import` logged React hydration error #418 on every load (currency names and the time-zone picker).
  - B2 (fixed): the dashboard's "Today is" used the server's UTC date.
  - B3: the date-range warning counts events already outside the trip.
  - B4: the day map's empty state tells viewers to edit.
  - B5: on phones the header's Bookings count wraps, and Field Notes and Atlas both link to `/`.
- **Improvements, highest first:**
  - I1: pinning is too hard. Pasted coordinates now pin (fixed); owner-confirmed geocoding is still a decision (a MAP-2 change).
  - I2: add "Use this budget" to the import budget warning.
  - I3: show time, place and price on collapsed import cards, with Expand all.
  - I5: use the friendly time-zone picker in the event form.
  - I6: warn when an event is dated outside the trip.
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

  `.env.local` needs `AUTH_SECRET`, the Google client ID and secret, and `TRIP_OWNER_EMAILS` (see the README). Never commit it or overwrite it.
- **Before every commit:** run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.
- **Pinned versions:** vitest 3.2.7 (4.x hit an npm install bug) and kysely 0.28.x.
- **Git:** remote `origin` is https://github.com/Link-lin/FieldNotes.git. Work on a branch and merge into `main`. The owner pushes. Local `main` is ahead of `origin/main` by the AI import and viewer invitation commits (12 including this note); nothing has been pushed. The merged `feat/viewer-invitations` branch can be deleted.
- **iCloud:** the project folder is under `~/Documents`, which iCloud Drive syncs. iCloud sometimes leaves conflict copies named `name 2.ts` or `folder 2` (and `.git/index 2`) after git rewrites many files. They are untracked duplicates. Don't commit them. Moving the repo out of iCloud-synced folders avoids this.
- **Scratch:** `.e2e/` holds build bundles for browser checks. It is gitignored and safe to delete.
- **Agent sessions on this folder:** a Cowork session reaches the folder from a Linux VM, so it can't use the macOS `node_modules`; it runs checks in a separate Linux clone. Git there needs file-deletion permission for the folder, or it leaves `.git/*.lock` files that block the next git command.

## Next milestone

1. Add a Maps Embed API key to `.env.local`, check the event panel's map, then merge `feat/event-panel`. The steps are in `claude/map-embed-setup.md` in the Claude project and in the README.
2. Look over `feat/review-fixes` (B1, B2, I1, F1, and `npm run dev` now starting the database and migrating) in the browser, then merge it after `feat/event-panel`.
3. Check viewer invitations with two real Google accounts (see Status) and fix anything it finds.
4. Pilot AI import with real plans and external AI tools. This has not been done yet; the counts are ready for it. Read `npm run pilot:report` weekly (clean previews, skipped items, edits per imported item, due-date use) before adding in-page AI generation or free-form parsing. Confirm whether TRIP-7 should be built.
5. Remaining review items: B3–B5, I2–I10 and the owner decisions above.
