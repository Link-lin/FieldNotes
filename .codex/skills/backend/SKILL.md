---
name: backend
description: Implement or change Travel Planner server behavior, APIs, authentication, domain logic, or persistence while preserving its privacy and data-integrity rules.
---

# Backend

Use this skill for server routes, validation, business rules, auth, data access, integrations, and database changes. The server is same-origin Next.js Route Handlers, Auth.js with database sessions, and a server-only data layer on PostgreSQL through Kysely.

## Architecture and domain logic

- Follow the layers already present:
  - `src/app/api/**/route.ts`: a few lines on `route()` from `server/core/http/route.ts`, which requires a session, checks the Origin on every state-changing method, validates the body with a schema from `src/shared/schemas.ts`, and maps errors. Never bypass it.
  - `src/server/modules/<feature>/<feature>.service.ts`: business rules, transactions and access checks (`requireTripRead`, `requireTripOwner`, `requireOwnerAccount` from `server/auth/access.ts`). No `next/*` imports.
  - `*.repository.ts`: SQL only; no access checks, no response shapes. `*.mapper.ts`: rows to DTOs. Pure rules that need no database go in a `*.rules.ts` next to the service.
  - `server/core`: database client and schema types, env, HTTP helpers. `server/auth`: Auth.js setup, session, actor, sign-in gate, access.
- A new feature gets its own `modules/<feature>/` folder with the same files. Don't add further layers.
- Reuse validation, auth, database, time, money, and response helpers. Keep business rules explicit and testable; do not duplicate a rule across routes.
- Keep the app server as the only database client if the approved server-only DAL design remains in use. Never expose database credentials or privileged data access to browser code.

## Boundaries and correctness

- Validate all untrusted route parameters and request bodies on the server with the project's established schemas. Return consistent, non-sensitive errors; never silently swallow meaningful failures.
- Enforce authentication and per-trip authorization at each protected route. Owner mutations require owner permission; viewers have read-only access to accepted grants. UI visibility is not authorization.
- Keep externally drafted AI responses in memory for validation, do not log or persist raw pasted content, and create no trip until owner confirmation. Revalidate normalized import data on commit.
- Use transactions for all-or-nothing imports, invitations, deletion, and multi-row changes. Define behavior for retry, idempotency, concurrency, and stale versions when the operation can race or time out.
- Preserve exact decimal money and currency pairing; never use floating-point for totals or auto-convert currencies. Preserve date-only/local wall-clock values and IANA zones; do not assume every travel time is UTC.
- Keep each flight segment separate and prevent AI input from marking reservations booked. Do not add external providers or product features that the PRD defers.

## Security, reliability, and operations

Consider authentication, authorization, CSRF/origin checks, injection, output exposure, unsafe URLs, secrets, log redaction, retention/deletion, and external trust boundaries for the affected code.

Consider timeouts, retry safety, partial failures, transaction rollback, and meaningful race conditions. Use idempotency only where duplicate execution could cause harm. Avoid queues, distributed coordination, caching, provider abstractions, and extra services without an evidenced requirement.

Use the project's existing logging/error reporting. Log enough context to diagnose failures without recording trip content, invite tokens, session data, OAuth tokens, or secrets. Look for N+1 queries and excessive calls when relevant; do not optimize for hypothetical scale.

For schema changes, inspect current migrations and data before editing. Make migration ordering, constraints, indexes, deletion behavior, and rollout compatibility explicit. Use `testing` for backend test strategy and `code-review` for security-sensitive or cross-cutting review.
