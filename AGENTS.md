# Travel Planner — Agent Guide

## Repository status

The core app and owner-only AI import are implemented (see [README.md](README.md) for setup and what is built). Viewer invitations are not built yet.

- [`PRD.md`](PRD.md): product scope, flows, requirements, assumptions, and open decisions.
- [`docs/design/technical-design.md`](docs/design/technical-design.md): architecture, data model, API contracts, security, test strategy; section 20 records implementation decisions.
- [`docs/design/atlas-v1.md`](docs/design/atlas-v1.md) and [`docs/design/trip-page-v1.md`](docs/design/trip-page-v1.md): dashboard globe, and the trip page, day map, costs, dialogs and visual direction.
- [`docs/design/json-v1.schema.json`](docs/design/json-v1.schema.json), [`import-prompt-v1.md`](docs/design/import-prompt-v1.md), and [`import-example-v1.json`](docs/design/import-example-v1.json): external AI import contract.
- `.codex/skills/`: focused workflows for design, feature development, UI, backend, testing, and review.

Stack: Next.js 16 (App Router, `src/proxy.ts`), React 19, TypeScript (strict), Auth.js v5 with the Kysely adapter and database sessions, Kysely 0.28 on PostgreSQL (`pg`), zod for input validation, d3-geo canvas globe, Vitest 3 with embedded PostgreSQL. Structure (details in README): `src/app` holds routes only; screens live in `src/features/<feature>/<Component>/` with child components nested inside; shared building blocks in `src/components/ui` and `src/components/layout`; global CSS in `src/styles`; the server in `src/server/{core,auth,modules/<feature>}` with services, repositories and mappers; `src/server/auth/access.ts` is the authorization boundary.

## Product and architecture constraints

- Follow the sequence **PRD → technical design → implementation → testing → code review**. Update product/design documents when implementation changes a material decision.
- The PRD defines scope. Keep later milestones—paid-spend reporting, email reminders, in-app AI, live weather/flight data, booking, packing, attachments, offline, and shared editing—out of MVP changes unless the user explicitly changes scope.
- AI import uses an external AI chat. The app accepts supported JSON, validates and previews it, then commits only after owner confirmation. Do not add an in-app AI provider or silently repair/discard submitted data.
- Treat trip content and pasted responses as private. Follow the technical design’s authentication, per-trip authorization, invitation, no-store, logging, and deletion requirements. A viewer is read-only and access is tied to an accepted grant.
- Imported prices are estimates; money stays exact and grouped by currency. Do not convert currencies or present AI suggestions as confirmed bookings, current prices, or availability.
- A flight item represents one segment. Preserve airport-local dates, times, and IANA zones; non-flight items inherit the trip zone only when no item zone is supplied.
- Consult the published JSON schema, prompt, and fixture together. Keep schema v1 immutable after release; use a new format version for incompatible changes.

## General engineering approach

- Read the relevant PRD/design sections and inspect existing code before editing.
- Search for an existing component, helper, service, route pattern, or style before adding another.
- Prefer the smallest change that satisfies the requirement. Avoid speculative abstractions, new dependencies, unrelated refactors, and infrastructure without a demonstrated need.
- Keep product requirements, assumptions, and implementation choices distinct. Do not invent user needs or treat proposed architecture as already implemented.
- Make consequential assumptions explicit and record material design changes in the technical design.
- Preserve existing names, file organization, error handling, and data-access patterns once implementation establishes them.

## UI principles

- Reuse the implemented design system and shared components. Keep the style hierarchy: **global tokens → reusable global styles → shared components → component-specific CSS**.
- Every component has its own folder with `Name.tsx` and `Name.module.css`, nested under the component that uses it. Shared styles are tokens, element defaults and a few utilities in `src/styles`; shared controls are components in `src/components/ui`. Use tokens instead of raw values, no fixed inline styles, and no Tailwind or other styling method. See the `frontend-ui` skill.
- Prefer semantic HTML, meaningful component/class names, and CSS classes over unnecessary inline styles. Avoid duplicated common styling.
- Preserve consistency and consider keyboard use, focus, labels, error/loading/empty states, and responsive layouts.
- See [frontend-ui](.codex/skills/frontend-ui/SKILL.md) for detailed UI work.

## Workflow skills

Use the focused project skills when their workflow applies:

- [technical-design](.codex/skills/technical-design/SKILL.md) for PRD-to-design work.
- [feature-development](.codex/skills/feature-development/SKILL.md) to coordinate implementation.
- [frontend-ui](.codex/skills/frontend-ui/SKILL.md) for UI changes.
- [backend](.codex/skills/backend/SKILL.md) for server, API, auth, and persistence changes.
- [testing](.codex/skills/testing/SKILL.md) for test selection and execution.
- [code-review](.codex/skills/code-review/SKILL.md) for an independent review.

Skills add task-specific workflow; they do not override the PRD or this project guide.

## Validation

Use the package scripts: `npm run lint`, `npm run typecheck`, `npm test` (unit and PostgreSQL integration; `npm run test:unit` / `npm run test:db` separately) and `npm run build`. Database tests start their own embedded PostgreSQL. Local development uses `npm run db:start` and `npm run db:migrate` (see README).

For changes to the import JSON files, validate JSON syntax with:

```sh
python3 -c 'import json, pathlib; p=pathlib.Path("docs/design"); [json.loads((p/n).read_text()) for n in ("json-v1.schema.json", "import-example-v1.json")]; print("JSON syntax valid")'
```

Syntax parsing is not full JSON Schema validation. Run other relevant checks only when the repository provides them and the task calls for them. Report checks that could not be run.

## Change hygiene and done criteria

- Keep each change focused; review the files you changed and remove temporary/debug code.
- Do not overwrite user work or use destructive Git operations. Check workspace and version-control state before relying on Git.
- Before finishing, verify the requested requirements are addressed, documentation and contracts agree, relevant validation passes, and remaining assumptions or blockers are stated.
