---
name: technical-design
description: Turn a product requirement or PRD change into a project-specific, implementation-ready design and independently review its risks.
---

# Technical design

Use this skill when a requirement needs architectural, data, API, security, or cross-layer decisions before implementation.

## Establish the facts

- Read the relevant sections of `PRD.md` and any existing design before proposing changes. Treat the PRD as the product-scope authority and the technical design as the architecture contract.
- Inspect relevant source, manifests, migrations, routes, components, styles, and tests. Search for existing code and patterns before proposing new ones.
- This workspace currently contains planning documents only. `docs/design/technical-design.md` proposes a Next.js/TypeScript app, Auth.js, server-only DAL, PostgreSQL, and Kysely; do not describe those as implemented until source confirms them. Reconcile a future scaffold with the approved design instead of forcing an undocumented assumption.
- Separate confirmed requirements, assumptions, chosen decisions, and unresolved questions. Ask only for choices that materially change the design; make low-risk choices explicit.

## Design for this product

- Keep MVP work within the PRD. Direct booking, in-app AI, weather/live flight data, email reminders, paid-spend reporting, and other later items require explicit scope approval.
- Preserve the import boundary: the owner uses an external AI chat, pastes supported versioned JSON, reviews/edits the preview, and confirms before any trip is created. No silent data loss or unverified AI claims.
- Account for private trip access, owner/viewer authorization, invitation acceptance/revocation, import privacy, money precision/currency, flight segments, local times/time zones, failures, and concurrent edits where relevant.
- Prefer the smallest design that meets the requirements. Explain meaningful alternatives and tradeoffs; do not invent an architecture comparison for trivial choices or add infrastructure for hypothetical scale.

## Produce an implementation-ready design

Document only the areas the requirement touches, with enough detail that implementation does not require reverse-engineering decisions. Address applicable architecture/components, data flow/model, APIs and validation, UI flows/states, authz, privacy/security, transactions/concurrency, reliability/performance/observability, migrations, and test strategy. Use Mermaid when it clarifies flow or ownership.

Map significant requirements to decisions and validation. Identify likely files/components, new routes or models, migrations, configuration, and tests; label proposed paths as proposed until they exist. Keep the PRD, JSON schema, prompt, fixture, API DTOs, and data model consistent. Record open deployment choices without blocking unrelated design work.

## Skeptical design review

After writing, inspect the design as an independent reviewer. Check requirement coverage, contradictions, hidden assumptions, unnecessary complexity, auth/privacy, failure and race behavior, data consistency, migration/backwards compatibility, UX recovery, operations, and testability. For each material finding, record severity, impact, affected requirement, concrete resolution, and tradeoff. Revise the design when warranted; distinguish resolved findings from decisions that still need the owner.

For code-level implementation review, use `code-review`. For feature implementation, use `feature-development`; it routes detailed UI, backend, and testing workflows to their focused skills.
