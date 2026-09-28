# Travel Planner — Technical Design: Design-Phase Record

This file is the September 2026 design-phase record of the technical design. It keeps five sections from that version for history: the repository and PRD assessment, the architectural alternatives, the independent design review, the implementation sequence and the final design summary. The text is unchanged except that its relative links were adjusted to resolve from `docs/design/archive/`; its section numbers refer to the old layout. Where it differs from the current design, [the current technical design](../technical-design.md) is correct.

## 2. Repository and PRD assessment

### Existing project inspection (at design time)

| Area | Finding | Design implication |
|---|---|---|
| Files | The PRD, this design, import contract, `AGENTS.md`, and project skills are present; no application source exists. | No application conventions or components to preserve. |
| Framework/libraries | None found. | Proposed stack is greenfield, not a migration. |
| Data model/migrations | None found. | This design defines the first schema and migration approach. |
| Tests/configuration | No test, package, build, or deployment configuration found. | Create these with the application; no existing test commands can be run. |
| Git/history | The workspace is not a Git repository. | There are no commits or architectural decisions to inspect. |

There is no implementation conflict with the PRD. The material design choices the PRD leaves open are the JSON shape, authentication/deployment details, trip and viewer persistence, time-zone conversion, and how to represent booking state. This document resolves those with explicit decisions below.

### Product goals and non-goals

**Goals in the PRD**

- Let one signed-in person manage multiple trips in a dashboard.
- Show authorized trip destinations on a global globe while keeping every trip accessible in a synchronized list.
- Create trips either manually or by importing an externally drafted AI response.
- Keep itinerary items editable and visibly distinguish unverified AI suggestions from owner-confirmed booking state.
- Represent multiple flight segments with local departure and arrival times and airport time zones.
- Track item-level planned prices and a trip budget without combining unlike currencies.
- Keep “Needs booking” items visible and show owner-entered due dates in the app.
- Allow named, read-only sharing to a Google identity that matches an invited email.
- Keep trip data unavailable to anonymous users and prevent viewers from mutating trip content.

**Non-goals for this design**

- Generating, repairing, or converting plans with an AI service inside the app.
- Weather, live flight status, review search, an app-owned street basemap, tiles or routing engine, turn-by-turn navigation, geocoding of item locations by the app, or booking integrations. (Google's embedded maps handle event lookup and optional day road routes inside their frames; the app stores nothing from them.) The dashboard destination globe and an outline per-day trip map drawn from owner-saved coordinates are in scope.
- Email/push/background reminders, payment execution, actual expense accounting, currency conversion, packing lists, attachments, offline operation, or collaborative editing.
- Scaling for a public travel-planning marketplace. The expected use is a small personal dataset and invited viewers.

**Actors**

- **Allowlisted owner:** Can create trips, read their own trips, and perform mutations on them. The owner can also be a read-only viewer of another person’s trip; access is scoped per trip.
- **Invited user:** Can read only trips with an accepted invitation tied to the user’s stable Google account identity. A verified email is required to accept the invitation; later email changes do not break an already accepted grant. Cannot create trips or mutate/invite on another owner’s trip.
- **Trip owner:** Can read and edit that trip, manage its invitations, and delete it.
- **Trip viewer:** Can read only a trip with an accepted invitation tied to the viewer’s `User.id`. Cannot mutate that trip or invite another viewer.
- **Anonymous visitor:** Can load the sign-in/invitation entry page but cannot retrieve trip content or call protected APIs.
- **External AI service:** Chosen and operated by the user outside the app. The app does not call it or receive provider credentials.

### Assumptions and design decisions

| Label | Statement |
|---|---|
| PRD requirement | Google sign-in, private-by-default trips, owner-only writes, named read-only trip viewers. |
| PRD requirement | The first release includes an interactive global trip view with one approximate destination point per located trip and a full list fallback. |
| PRD requirement | The AI response is pasted as JSON; no trip is committed before owner confirmation. |
| Design decision | Only Google identities in a deployment-configured owner allowlist may create or mutate owned trips. A verified invitee may sign in to accept/read a trip invitation but cannot create trips or write trip data. Existing linked Google accounts may reauthenticate for account deletion even with no trip grants; that does not restore trip access. |
| Design decision | The JSON document is `{ formatVersion, trip, items }`; trip fields are nested under `trip`. The PRD describes the required fields but not their exact nesting. |
| Design decision | Item source (`ai` or `manual`) and booking status are separate. The import can set `Needs booking` or `Not required`, never `Booked`. |
| Design decision | A trip’s date range is metadata, not a filter that hides out-of-range itinerary items. Editing the range preserves item dates and warns about out-of-range items. |
| Design decision | Trip-local date/time values remain wall-clock values. Changing the trip time zone reinterprets only non-flight items that inherit the trip time zone, and recomputes their ordering. Explicit item and flight airport time zones remain unchanged. |
| Design decision | Expiration is computed from `expires_at`; no scheduled job is needed to transition invitations to an expired state. |
| Design decision | Resolve a destination against a bundled, versioned Natural Earth place catalog only when the match is exact and unique. Store a nullable point; never invent a marker for an ambiguous or unmatched destination. The owner may set/clear a point. |
| Assumption | The initial dataset is small (personal use: a modest number of trips and at most hundreds of items in a trip). Fetch a full trip at once; do not add caching or complex pagination until real use warrants it. |
| Design decision | The public sign-in surface is allowlisted; trip data routes always require an authenticated owner or accepted trip viewer. A VPN/private-ingress deployment remains necessary if no app route should be internet-reachable. |
| Assumption | The hosted PostgreSQL provider’s backups are sufficient for the initial launch; retention and post-deletion backup behavior must be confirmed against the chosen plan before launch. |

## 11. Architectural alternatives

### A. One Next.js app and server-only DAL — selected

**Description:** UI, Route Handlers, auth callbacks and domain logic in one TypeScript deployment; one PostgreSQL database.

**Pros:** Few deployments; one language; server-only data boundary; low operational burden; simple local development; routes are easy to integration-test.

**Cons:** UI and backend deploy together; some DAL discipline is required to prevent route code from duplicating authorization.

**Decision:** Use for v1. The project has no independent clients or backend scaling need to justify another service.

### B. Separate SPA and API service

**Description:** React SPA plus independently deployed REST API.

**Pros:** Separate release cycles and language/runtime choices; could support native clients later.

**Cons:** Extra deployment, CORS and token/session plumbing, more secrets and local setup, no current second client.

**Decision:** Do not use until a real non-web client or independent scaling need exists.

### C. Auth.js plus server-only PostgreSQL — selected

**Description:** Auth.js owns Google sign-in and sessions; application DAL owns all trip authorization; PostgreSQL is accessed only from server.

**Pros:** One explicit authorization path, no browser data API, easy to apply invitation-specific access, normal relational transactions, no database RLS policy recursion to debug.

**Cons:** App code must enforce access on every handler; shared code could accidentally omit a check unless DAL helpers and tests are mandatory. Auth.js/Google OAuth configuration is app-managed.

**Decision:** Use a central DAL and resource authorization tests. This matches a single web app and exact per-trip owner/viewer role.

### D. Supabase Auth + direct browser data API/RLS

**Description:** Supabase manages Google Auth and the browser uses the Supabase Data API with PostgreSQL RLS policies.

**Pros:** Integrated auth/database and database-level row authorization; fewer custom route handlers for CRUD.

**Cons:** Invitation acceptance, owner/viewer read-vs-write rules, OAuth session refresh in SSR, and test parity depend on carefully designed RLS policies. It adds another authorization surface for this small application. Supabase’s current Next.js SSR docs recommend `@supabase/ssr` but mark that package beta, which adds API-churn risk ([Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side)).

**Decision:** Not selected initially. Reconsider only if direct Supabase data access materially simplifies implementation after a secure RLS prototype.

### E. SQLite/local single-user database

**Pros:** Minimal cost and setup; no remote database service.

**Cons:** Harder durable deployment/backup and safe concurrent access across hosted instances; less suitable for multi-user sharing and invitation records.

**Decision:** Use PostgreSQL from the start because persistent multi-user access and atomic import/invitation transactions are in the PRD. Keep the relational schema provider-portable.

### F. Public authentication route vs VPN-only application

**Public app with authorization (current default):** Viewers need only a browser and Google account. The sign-in shell is internet reachable, but verified sign-in is limited to the configured owner email or a valid trip invitation, and trip data requires per-resource authorization.

**VPN/private ingress:** No app route is reachable outside the private network. This better matches a strict “not exposed to the internet” interpretation but each invitee must install/join the VPN and the owner must maintain private network access.

**Decision:** Use the allowlisted public sign-in shell for the MVP design. Before deployment, confirm whether “not expose the full webpage” means private trip data or no public route; choose VPN/private ingress for the latter. Google login remains required in either option.

## 15. Independent design review and revisions

This pass treated the design as untrusted and checked its auth boundary, import contract, concurrency behavior, DTOs, invitation recovery, and roadmap implications. Each finding states the problem and impact, affected requirement, correction, and tradeoff. Findings from the independent second pass are included below.

| Severity / status | Problem and why it matters | Affected requirement | Revision | Tradeoff |
|---|---|---|---|---|
| P1 — revised | Public sign-in plus self-service creation admitted any Google account, creating an open sign-up surface and unused accounts even though this is a personal tool. | ACCESS-1, ACCESS-7, privacy | Require a verified Google email in `TRIP_OWNER_EMAILS` or on a pending invitation to create a new account. Existing linked Google subjects may reauthenticate for account management; only currently allowlisted owners can access owned trips and viewers require accepted `User.id` grants. | The owner must maintain the allowlist. Removing an address blocks owned-trip access on subsequent requests; a second owner requires a configuration change. |
| P1 — revised | Public authentication still leaves the sign-in route internet-reachable; Google login protects data but does not make the application private-network-only. | ACCESS-7; user privacy intent | Keep a public sign-in shell as the default, gate it as above, and preserve VPN/private ingress as the deployment choice if no route may be public. This must be decided before deployment. | VPN ingress protects the whole surface but makes every viewer join the private network. |
| P1 — revised | The JSON Schema had no copyable prompt or representative fixture, so a user could not reliably produce the format and the import contract could not be checked end-to-end. | IMPORT-1, IMPORT-5, IMPORT-9 | Add [`import-prompt-v1.md`](../import-prompt-v1.md) and [`import-example-v1.json`](../import-example-v1.json); align them with the schema and require a pilot before relying on the format. | External models may still omit fields or fabricate details; the app must validate and the owner must review. |
| P1 — revised | Import contract said prices defaulted to estimates while the API also implied the preview could change a price to a quote, despite no such field or control. | IMPORT-6, BUDGET-1, BUDGET-4 | Every imported amount is forced to `estimate`; preview has no label field. The owner may change it to `quote` after creation. | One extra edit for a known quote; no ambiguity or ability for an external model to mark a quote. |
| P1 — revised | Item counts, link counts, and monetary magnitude were not bounded. A valid-looking request could consume excessive validation/transaction work or overflow the intended database precision. | IMPORT-2, IMPORT-5, IMPORT-8, PLAN-1, BUDGET-1 | Cap trips at 250 items and each item at 20 links; cap amounts at 14 integer plus 4 fractional digits using `NUMERIC(18,4)`; apply identical bounds to manual forms and imports and retain the 1 MiB aggregate request limit. | Extremely large itineraries or amounts are rejected; these limits fit the personal-project use case. |
| P1 — revised | SameSite cookies and OAuth state alone did not specify CSRF checks for application mutation endpoints. | ACCESS-5, ACCESS-7, all mutation APIs | Require the `Origin` of every state-changing Route Handler to match the configured canonical app origin; reject missing/mismatched values and retain secure SameSite cookies. | Reverse-proxy/canonical-origin configuration must be correct in each environment. |
| P1 — revised | Auth.js adapter table naming can silently diverge from its expected schema if pluralized or snake-cased independently. | ACCESS-1, persistence | Use the Kysely adapter’s default `User`, `Account`, `Session`, and `VerificationToken` tables and expected columns; do not rename without explicit adapter mapping. | Keeps framework conventions in the database; custom naming remains possible only with added mapping work. |
| P2 — revised | Two simultaneous commits with the same idempotency key can both miss a prior row; a unique constraint alone did not define how the losing request responds. | IMPORT-8 | Insert a receipt under the unique `(owner_user_id, idempotency_key)` key in the same transaction as trip/items. On a uniqueness race, roll back and read the winner; compare hashes and return the existing trip or 409. | Requires explicit conflict recovery and a small receipt table. |
| P2 — revised | The server retry key had no defined client lifetime. A lost response followed by a reload could lose the key or reuse it with edited content, causing duplicate creation or a confusing 409. | IMPORT-8; retry recovery UX | Save only the pending UUID key in tab-scoped `sessionStorage`; keep the exact payload in memory, disable edits until resolved, reuse the key after re-paste, and create a new key only after an explicit new-import action. | Reload recovery still requires the user to re-paste; if the normalized payload changes, a fresh key can create another trip. |
| P2 — revised | A tombstone that retained `payload_hash` kept a content-derived value after trip deletion; a retry racing with deletion could also read a stale live receipt and return a trip just as it was being removed. | DASH-5, IMPORT-8, deletion privacy, concurrency | On trip deletion, lock and clear both `trip_id` and `payload_hash`; retry locks the same receipt and returns 410 for a tombstone without comparing hashes. Deletion and retry serialize on that row. | Adds row locking and keeps a content-free receipt until account deletion; a retry ordered before deletion can still return the live trip, which is then deleted afterward. |
| P2 — revised | The response DTO section referenced an undefined flight DTO, omitted persisted schedule choices/duration, duplicated `role`, and described preview rows using persisted-item fields that do not exist before commit. | API consistency, IMPORT-6, PLAN-1, FLIGHT-1 | Define separate persisted and draft DTOs, a complete nullable `FlightDetailsDTO`, path-addressed `FieldError`, and `ImportPreviewDTO` whose invalid rows can contain partial values. | More explicit types to maintain, with clearer client/server ownership of fields. |
| P2 — revised | The invitation URL is returned once and cannot be recovered from storage, but the failure behavior suggested reopening the share UI could copy it. | ACCESS-2, ACCESS-3, ACCESS-6 | Explain that `GET invitations` never returns the token. If the owner loses the link, reissue the pending invitation; rotation invalidates the old link. | The owner must copy/send the replacement link again; token secrecy is preserved. |
| P2 — revised | A direct booking milestone could tempt v1 to add generic provider abstractions without knowing whether the product needs a link handoff, partner API, or checkout. | Future booking milestone; BOOK-1 | Keep ordinary external links and booking state in v1; create no provider/checkout abstraction. Scope the next milestone around booking handoff and confirmation, with payment/card handling explicitly decided then. | No in-page booking in v1; avoids maintaining speculative integration code. |
| P2 — retained launch decision | Managed backups and public ingress have operational/privacy consequences that cannot be resolved from the greenfield repository alone. | ACCESS-7, deletion/privacy | Before launch, choose public sign-in versus private ingress and record the selected database plan’s backup retention/restore behavior. | VPN setup and backup retention add deployment steps; deferring the choice blocks deployment, not local design work. |
| P1 — revised | An accepted viewer’s invitation is bound to `viewer_user_id`, but sign-in still depended on their current verified email matching the original invite. A Google email change could lock out a legitimate viewer. | ACCESS-4, ACCESS-5, ACCESS-6 | Use the stable linked Google provider subject and `User.id` for reauthentication and accepted-grant reads; use verified email only to accept a pending invitation. | Existing accounts need the same linked Google identity; replacing the Google account requires a new invitation. |
| P2 — revised | A revoked viewer with no remaining grant could not reauthenticate to call account deletion, leaving identity data without a working self-service exit. | Privacy/account deletion requirement | Allow an already-linked Google subject to establish an account-management session even without trip grants; keep trip authorization separate and expose account deletion in the empty state. | Creates a restricted no-trip session path that must remain distinct from authorization to read trip data. |
| P1 — revised | The external AI could invent a trip budget that looked like the owner’s planned budget, undermining budget trust even though item prices are marked as estimates. | IMPORT-2, IMPORT-6, BUDGET-2, BUDGET-4 | Carry the optional owner-provided budget separately from the prompt through preview and commit. Use only that value, warn when AI output differs or appears without an owner value, and ignore an unprovided AI budget. | One additional request field and warning state; owners cannot import a model-suggested total directly as their budget. |
| P1 — revised | The prompt did not clearly require a separate item per flight segment or define the wall-clock/time-zone rules for daily and flight times, allowing multi-leg flights or shifted local times to be misrepresented. | IMPORT-1, IMPORT-2, FLIGHT-1, PLAN-1 | Require one item per flight segment, 24-hour `HH:mm` for activity local time, and explicit event/airport IANA zones when different from the trip zone. | Slightly longer prompt; the owner may still need to correct uncertain segment details in preview. |
| P2 — revised | The strict schema’s theoretical maximum could exceed the 1 MiB HTTP envelope; a schema-valid response could fail with an unhelpful size error after JSON request-envelope escaping. | IMPORT-2, IMPORT-5, IMPORT-6 | Tell the external AI to cap output at 400 KiB UTF-8 for envelope margin; return a 413 recovery message to shorten notes/omit links, without suggesting split imports that v1 cannot merge. | Very large itineraries lose optional detail; avoids a larger request/parser envelope and unsupported multi-part import flow. |
| P2 — revised | The representative example included an invented zero-price item and a placeholder `example.com` link, which could teach the model to treat unknown activities as free or emit a fake source. | IMPORT-1, IMPORT-5, BUDGET-1 | Remove the unsupported price and placeholder link from the fixture; keep the prompt explicit that uncertain prices/links are omitted. | The fixture no longer demonstrates a populated link field; the schema still documents it without asserting a real destination. |
| P1 — revised (26 Sep) | Account deletion was specified two ways (PRD: identity only; TD: cascade owned trips). | ACCESS-10 | PRD aligned to the cascade; confirmation lists owned trips and requires typing DELETE. | Deleting an account is heavier but leaves no orphaned trips. |
| P1 — revised (26 Sep) | Undo for item delete sent `DELETE` only when the undo window closed, so a closed or crashed tab lost the delete, and re-creating could not restore provenance. | TRIP-8 | Immediate soft delete with `deleted_at` and a 10-minute restore route. | One extra column and a purge step. |
| P1 — revised (26 Sep) | Map provider label used substring matching, so a look-alike host could appear as "Google Maps". | MAP-1 | Exact-hostname match after URL parsing; user information rejected. | Some legitimate regional hosts need adding to the list. |
| P1 — revised (26 Sep) | It was unclear whether imports could set a map link, and any edit re-sending the link could silently pin a stop. | MAP-2, IMPORT-7 | Import never sets `map_url`; coordinates parse only when the saved link changes. | One extra click for the owner to adopt an imported link. |
| P2 — revised (26 Sep) | Import into an existing trip was stated as decided in some places and proposed in others, and it contradicted IMPORT-8. | TRIP-7, IMPORT-8 | Marked proposed everywhere; IMPORT-8 wording covers both outcomes; append behavior specified. | Waits for an owner decision. |
| P2 — revised (26 Sep) | AI-supplied flight airports, Amap/Baidu coordinates and flight legs distorted pins and distances. | MAP-2, MAP-4 | Airport pins only for manual or booked flights; Amap/Baidu never pinned; flights excluded from lines and distances. | Fewer pins by default. |
| P2 — revised (26 Sep) | Unverified price label could never clear; DTOs, tabs, Back/Escape, the form fields, the wrong-account screen, link recreation, logging and fonts were underspecified or inconsistent. | BUDGET-4, TRIP-1, TRIP-2, TRIP-9, ACCESS-9, ACCESS-11 | `price_source`; DTO fields; tab and numbering rules; `replaceState`; item form spec; wrong-account state; create new link for any non-accepted entry; never-log list; self-hosted fonts. | More UI states to build and test. |

The follow-up pass closed the remaining material auth, budget-trust, prompt, body-size, and deletion-race gaps. Remaining launch decisions are whether the sign-in surface itself must be private-network-only and which managed database plan/backups to use. No provider booking abstraction is justified until that later milestone is scoped.

## 17. Implementation sequence

1. **Freeze the import contract:** validate the JSON Schema and example fixture, review the copyable prompt, and pilot it with representative trips. Treat v1 as immutable after release; add a new `formatVersion` and validator for incompatible changes.
2. **Confirm deployment choices:** public allowlisted sign-in versus VPN-only ingress, managed database/provider, and backup retention. Owner allowlisting and invite-only viewer access are the design defaults; no open self-service trip creation.
3. **Create the Next.js TypeScript app skeleton** with Node runtime, environment validation, CI/lint/typecheck, private route layout, and Auth.js Google sign-in. Verify that unsigned pages/routes return no user data.
4. **Create database schema/migrations and DAL** for Auth.js tables, trips, viewer grants, plan items, and import receipts. Add owner allowlist/read ACL tests before building UI.
5. **Build manual trip CRUD and dashboard** first so core domain can be exercised without AI import. Add date range/time zone/budget edits, account/trip deletion, and the authorized list. Add the Atlas nullable point, deterministic catalog matching, point editor, and lazy globe per [Atlas v1](../atlas-v1.md) before release.
6. **Build non-flight item and flight forms** with date/time conversion, owner-only writes, booking state/due list, planned currency totals, external map links, and the trip page, day map and event menu with soft delete and restore ([Trip page v1](../trip-page-v1.md)).
7. **Implement import validation and UX** from the frozen schema: validator, error model, preview editing/skipping, and explicit repair-copy controls.
8. **Implement atomic import commit** with server revalidation, SQL transaction, receipt insertion, concurrent same-key conflict recovery, post-delete 410 behavior, and no persistence/logging of the source response.
9. **Add read-only invitations** with one-time token, Google email match, expiration, revocation, security regression tests, and account deletion.
10. **Finish responsive/accessibility, backups/privacy notice, security headers, production OAuth URLs, deploy smoke test, and pilot instrumentation.**

Implementation may adjust order if Auth.js or hosting setup needs an earlier database. Keep authorization and data-integrity tests ahead of invitation UX.

## 18. Final design summary

### Key decisions

- One Next.js TypeScript app with server-side routes and a centralized DAL; no separate backend service.
- Auth.js Google OAuth, database sessions, and per-trip authorization on every data route.
- Verified owner email allowlist for all trip creation/mutation; invited verified users can accept and read only their shared trips.
- Managed PostgreSQL with Kysely migrations and transactional trip/import/invitation behavior.
- Strict versioned external JSON import with a copyable prompt and fixture; preview and revalidate; atomically commit only after owner confirmation.
- Local date/time plus IANA zone as the schedule representation; exact flight segment fields use airport-local times/zones.
- One plan-item record holds booking status/due date; booking list is derived.
- Public allowlisted sign-in shell as deployment default; VPN-only ingress remains the alternative if public reachability itself is unacceptable.
- An interactive dashboard globe backed by bundled geography and one approximate destination point per located trip; the complete authorized list remains usable without WebGL.
- External booking links only in v1; a later milestone must choose handoff versus provider integration before adding booking interfaces.
- An outline day map built from owner-saved map-link coordinates and bundled geography; an optional user-opened Google road-route iframe on a selected day; no app-owned tiles, geocoding or link resolution.
- Item deletion is an immediate soft delete with a 10-minute restore.

### Assumptions to validate

- AI tools used in the pilot can reliably produce the strict JSON contract without the owner editing raw JSON.
- Invited people accept a Google sign-in requirement and read-only access.
- An in-app due-date list is enough for the first milestone without email/push reminders.
- A managed PostgreSQL plan and provider backups fit project budget/privacy expectations.
- A trip’s default time zone is a reasonable fallback for general itinerary times; multi-zone items can set explicit zones.

### Open questions

1. Does “not expose the full webpage directly on the internet” mean private trip data only, or no internet-reachable app routes? The design defaults to an allowlisted public sign-in shell; choose VPN-only ingress if the latter.
2. Which managed PostgreSQL plan will be used, and what backup retention applies after deletion? Confirm and document before launch.
3. Is TRIP-7 (import into an existing trip) approved?
4. Is the paper-and-ink visual direction, including the forest accent, approved ([Trip page v1](../trip-page-v1.md))?

### Risks

- Strict JSON format may make external-AI import too brittle; validate with actual trips before investing in AI conversion.
- Authorization mistakes can expose private itineraries; the DAL pattern and owner/viewer regression tests are release-critical.
- Time-zone and DST ambiguity can display/sort items incorrectly; centralize conversion and test transitions.
- Public hosting exposes the sign-in surface even when data is protected; VPN-only deployment costs convenience for viewers.
- The owner allowlist prevents open self-service but needs a deployment change when owner identities change or a second owner is added.
- Managed backup retention can delay physical erasure; disclose provider behavior and choose a suitable plan.
- External AI output may not satisfy the strict contract; pilot the prompt before treating it as a low-friction import path.
- Auth.js, Next.js, and the host may update APIs; pin dependencies, update deliberately, and keep OAuth/database smoke tests.

### Definition of done

- An unauthenticated request cannot retrieve any trip content, counts, invitee lists, or dashboard aggregates.
- Unlisted Google identities cannot create sessions or read/create trips; removing an owner address blocks owned-trip reads on subsequent requests; invited identities can read only accepted grants, and all owner mutations require the allowlisted identity.
- An owner can create/edit/delete multiple trips and all supported item types; read-only viewers can access only accepted invited trips and cannot mutate them.
- Import prompt and example conform to the frozen schema; importing supported JSON works without raw-JSON editing; malformed/invalid rows have actionable recovery; no commit happens before confirmation; failures cannot leave partial trips; concurrent same-key retry returns the same trip; retry after deletion returns 410.
- Schema and manual forms enforce item/link/money bounds; mutation routes reject missing or mismatched `Origin`.
- AI origin and price estimates are visibly unverified. Imported data never sets `Booked`; required booked-flight details are enforced.
- Trip date/time-zone edits follow the documented behavior; flight segments sort by departure instant and display dates in airport zones; DST ambiguous/nonexistent times do not silently shift.
- Booking lists and due/overdue states match trip-zone calendar dates; no email/background reminder is implied.
- Planned cost totals use exact decimals, remain grouped by currency, and compare only against a matching-currency budget.
- Invitation creation, acceptance, expiry, wrong-account denial, revoke, and reissue pass integration tests; raw tokens and OAuth secrets never reach logs or browser data APIs.
- Account/trip deletion removes live records with documented backup retention; failed saves/imports preserve recoverable form state.
- Mobile and keyboard-accessible flows work for sign-in, dashboard, import, edits, sharing, and errors.
- The Atlas shows only authorized trips, synchronizes with status filters, supports owner point correction, and never hides an unlocated trip or blocks the list when WebGL/assets fail. No third-party map request is made on dashboard view.
- The trip page meets TRIP-1–10 and MAP-1–9: provider labels cannot be spoofed, imports never pin, deletes survive closing the tab and can be undone, and no third-party request is made until a user opens an event map or day road view.
- Provider credentials, migration roles, production callback URLs, TLS, no-store behavior, privacy/backup note, and a production smoke test are in place.

