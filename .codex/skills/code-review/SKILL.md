---
name: code-review
description: Independently review Travel Planner code or design for real correctness, security, data-integrity, UX, and maintainability issues.
---

# Code review

Use this skill when asked to review code/design or when a separate review is useful after substantial or security-sensitive implementation. Do not assume work is correct because you produced it. Review the actual diff and relevant surrounding code against the PRD and technical design.

## Review focus

- **Correctness:** requirement coverage, state transitions, edge cases, failure recovery, and consistency across UI/API/data contracts.
- **Architecture:** fit with the implemented architecture, accidental layers, duplicated logic, unnecessary dependencies, migration and backwards-compatibility impact.
- **Backend/data:** input validation, authn/authz at route boundaries, SQL/query behavior, transactions, idempotency, races, constraints, data deletion, logging, and external integrations.
- **Frontend:** existing design-system/style reuse, duplicated CSS, semantic class naming, keyboard/focus/forms/dialogs, responsive layout, permission boundaries, and loading/error/empty/conflict states.
- **Security/privacy:** injection, authorization bypass, CSRF, sensitive-data exposure, unsafe links, secrets, caching, tokens, and retention.
- **Performance/operations:** report only evidenced bottlenecks, missing operational behavior, or avoidable maintenance burdens.

For design changes, also inspect assumptions, unresolved decisions, data flow, API contracts, traceability, and whether features can coexist as specified. For this product, pay special attention to owner/viewer isolation, externally pasted AI content, money/currency precision, local travel times, and atomic imports.

## Findings

Report genuine, actionable findings only, ordered by severity:

- **CRITICAL:** exploitable security issue, data loss/corruption, or complete failure of a core flow.
- **HIGH:** major requirement failure, access-control flaw, or likely serious regression.
- **MEDIUM:** meaningful edge-case failure, unsafe ambiguity, or maintainability/reliability concern with realistic impact.
- **LOW:** limited-impact issue with a concrete correction.

For each finding, state the problem, why it matters, affected requirement/code (file and line when available), and a concrete fix. Explain tradeoffs for design-level choices. Separate findings from questions and non-blocking suggestions. Do not manufacture issues to fill every category.

Do not edit reviewed code unless the task also asks for fixes. If fixes are in scope, apply them, re-run relevant validation, and review the resulting diff again. Report what was inspected and any checks that could not be run.
