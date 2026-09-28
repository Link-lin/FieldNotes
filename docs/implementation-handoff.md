# Field Notes: implementation handoff

Last updated 27 Sep 2026 (viewer invitations). Read this first when picking the project up in a new session.

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
- **Viewer invitations (ACCESS-3 to ACCESS-11) are implemented on `feat/viewer-invitations`** (not yet merged into `main`):
  - The owner's **Share** dialog on the trip page shows what viewers can see (ACCESS-8), invites one email, shows the copyable message with the link once, and lists viewers and invitations with status and expiry, **Revoke** (confirmed for an accepted viewer) and **Create new link**.
  - Links are `/invite#<token>`: 256 random bits, stored only as a SHA-256 hash, valid seven days. A new link replaces the old one in the same row. The owner's own email is refused; an accepted viewer must be revoked before a new link.
  - `/invite` removes the token from the address bar, stages it in a 15-minute HttpOnly cookie holding only the hash, then accepts for a signed-in visitor or offers Google sign-in that returns there. Wrong-account and invalid-link states reveal no trip, owner or invited email.
  - Acceptance compares the invitation email with the account's email as verified at account creation (Auth.js does not refresh it), binds the grant in one locked transaction, and is idempotent for the bound account. Revocation blocks the viewer's next request.
  - Server code is in `src/server/modules/invitations/`, routes under `src/app/api/trips/[tripId]/invitations` and `src/app/api/invitations/{stage,accept}`. Decisions are in technical design section 20.
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
- **Checks on `feat/viewer-invitations` passed before each commit:** `npm run lint`, `npm run typecheck`, `npm test` (138 unit and DB tests) and `npm run build`, run in a Linux copy of the repository with its own `npm ci`. A headless-browser run against a production build used database sessions seeded directly (no Google): the Share dialog (validation, own-email refusal, one-time message, copy, revoke with confirmation, new link, phone width), the invitation landing, the invalid-link and wrong-account states, viewer acceptance with no owner controls, idempotent reopening, and 404 after revocation.
- **Still to check by hand:** the full flow with two real Google accounts, including the OAuth round trip after staging, the sign-in gate for a brand-new invitee, and **Switch Google account**.
- **Not built yet:**
  - TRIP-7 (append an imported plan to an existing trip) remains proposed.

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
  2. `npm run db:start`, which starts embedded PostgreSQL.
  3. `npm run db:migrate`
  4. `npm run dev`

  `.env.local` needs `AUTH_SECRET`, the Google client ID and secret, and `TRIP_OWNER_EMAILS` (see the README). Never commit it or overwrite it.
- **Before every commit:** run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.
- **Pinned versions:** vitest 3.2.7 (4.x hit an npm install bug) and kysely 0.28.x.
- **Git:** remote `origin` is https://github.com/Link-lin/FieldNotes.git. Work on a branch and merge into `main`. The owner pushes.
- **iCloud:** the project folder is under `~/Documents`, which iCloud Drive syncs. iCloud sometimes leaves conflict copies named `name 2.ts` or `folder 2` (and `.git/index 2`) after git rewrites many files. They are untracked duplicates. Don't commit them. Moving the repo out of iCloud-synced folders avoids this.
- **Scratch:** `.e2e/` holds build bundles for browser checks. It is gitignored and safe to delete.
- **Agent sessions on this folder:** a Cowork session reaches the folder from a Linux VM, so it can't use the macOS `node_modules`; it runs checks in a separate Linux clone. Git there needs file-deletion permission for the folder, or it leaves `.git/*.lock` files that block the next git command.

## Next milestone

1. Review and merge `feat/viewer-invitations` after the two-account Google check above.
2. Pilot AI import with real plans and external AI tools. This has not been done yet. Track repair, edit and skip rates before adding in-page AI generation or free-form parsing. Confirm whether TRIP-7 should be built.
