---
name: testing
description: Choose and run focused, maintainable tests for Travel Planner behavior using the project's actual test tools.
---

# Testing

Use this skill when selecting, adding, or running tests. Tests use Vitest: `tests/unit` for pure logic and `tests/db` for the data layer, route handlers and sign-in gate against an embedded PostgreSQL started by the test setup (`npm test`, or `npm run test:unit` / `npm run test:db`). Browser checks run against a production build; select elements by role, label or `data-*` attribute, never by CSS-module class.

## Choose the right level

- **Unit:** deterministic domain rules such as date/time-zone interpretation, money arithmetic/currency grouping, booking transitions, schema validation, and DTO normalization.
- **Database integration:** migrations, constraints, transactions/rollback, import idempotency, invitation races/revocation, authorization queries, and trip/account deletion.
- **API:** request validation, status/error contracts, origin checks, authz for every role, private/no-store responses, import preview/commit, and retry semantics.
- **Component/browser E2E:** owner and viewer flows, import preview/edit/skip/confirm, manual edits, sharing/acceptance/revocation, conflict/error recovery, keyboard use, and responsive states.

Prefer the lowest level that proves the user-visible or data-integrity behavior. Do not test private implementation details without a behavior or invariant that warrants it. Avoid adding test infrastructure or relying on live Google, AI, weather, maps, or booking providers for deterministic tests.

## Product-specific risks to cover

Prioritize regressions in:

- Owner/viewer/anonymous access and immediate revocation.
- Strict versioned JSON, duplicate-key rejection, partial field errors, owner confirmation, no partial import, same-key retry, and deletion tombstones.
- Money precision, price labels, currency grouping, and owner-controlled trip budget.
- Flight segment completeness, local zones, daylight-saving gaps/overlaps, timeline ordering, and trip-zone edits.
- Invitation identity matching, expiration, one-time token handling, reissue, and privacy-safe errors.

For bug fixes, reproduce the defect, add a focused regression test where appropriate, fix the cause, then run that test and relevant broader checks. Keep time-dependent tests fixed to an explicit clock and time zone; isolate database state and avoid nondeterministic external services.

Before reporting completion, run the relevant checks that exist in the repository and state exactly what ran. If no runner or service is available, explain the gap instead of inventing a framework or claiming validation that did not happen.
