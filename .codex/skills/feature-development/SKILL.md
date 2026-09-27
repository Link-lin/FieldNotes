---
name: feature-development
description: Implement a Travel Planner feature by tracing it from the PRD through the design, existing code, tests, and final review.
---

# Feature development

Use this skill for implementation work that changes application behavior. Do not treat this workflow as permission to expand product scope or deploy/publish changes.

## Workflow

```text
Understand → Inspect → Plan → Implement → Test → Review → Validate
```

### Understand and inspect

- Read the relevant PRD requirements, acceptance criteria, non-goals, and technical design. Identify assumptions and any contradiction before coding.
- Inspect the current source tree, package scripts, routes, database migrations, UI components/styles, auth checks, and tests. Reuse established code and patterns.
- The app is built (see README.md for setup and layout). Use its npm scripts (`lint`, `typecheck`, `test`, `build`) and its structure: screens in `src/features`, shared UI in `src/components`, server modules in `src/server/modules`. Don't add a new package manager, test runner or style system.
- Decide whether the request is documentation/design-only or asks for code. Keep changes within the requested outcome.

### Plan and implement

- Make a short focused plan that names the affected behavior and likely files. Call out data migrations, auth boundaries, API changes, and compatibility needs.
- Implement the smallest complete slice that satisfies the requirement. Preserve existing architecture; avoid unrelated cleanup, speculative abstractions, and new dependencies without a concrete need.
- Treat all client input as untrusted. Keep trip authorization server-side. Preserve the PRD’s privacy boundary: external AI content is owner-pasted, previewed before commit, and not silently stored or logged.
- For UI details, use `frontend-ui`. For routes, domain logic, auth, or persistence, use `backend`. For test selection and execution, use `testing`.

### Verify and review

- Run the relevant project-provided tests, lint, typecheck, and build checks for the changed area. Discover commands from the actual manifest/docs; do not fabricate commands. If no check exists, report that limitation rather than introducing a test framework incidentally.
- Review the diff for scope, regressions, secrets/debug code, inconsistent contracts, and unmet requirements. Check the original acceptance criteria directly.
- Use `code-review` for a separate skeptical pass on substantial, security-sensitive, or user-requested review work. Fix material issues and revalidate.

Work is complete only when the requested behavior is implemented, relevant checks pass or limitations are clearly reported, and remaining assumptions are visible.
