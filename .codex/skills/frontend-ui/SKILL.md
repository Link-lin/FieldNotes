---
name: frontend-ui
description: Design and implement Travel Planner UI changes that fit the established application, styling, accessibility, and responsive patterns.
---

# Frontend and UI

Use this skill for screens, components, interactions, forms, and visual behavior. The UI is Next.js App Router with React client components and CSS modules; the structure is below and in the README.

## Inspect before changing

- Read the relevant PRD flow and UI requirements, then inspect existing routes, layouts, shared components, design tokens, global styles, state/data patterns, and responsive breakpoints.
- Reuse the project's existing components and style architecture. Do not create parallel button/form/card systems or introduce a new CSS methodology because it is familiar.
- Before adding styles, search in this order: existing component, global style, design token, utility/mixin, then component-specific CSS.

## Where things go

- One component per folder: `Name/Name.tsx` (markup and behavior) and `Name/Name.module.css` (its styles). A component made only of shared building blocks may have no CSS file. Tiny parts that only make sense inside one component (a tab button, a list row) may share its file.
- Nest a child inside the folder of the component that uses it (`TripPage/Timeline/EventRow/FlightCard/`). When two children of one parent share a component, it sits at the parent's level (`TripPage/StopNumber/`). When different screens share it, it moves to `src/components/ui/`.
- Screens live in `src/features/<feature>/`; app-wide frame in `src/components/layout/`; pages in `src/app` only fetch data and render a screen. Browser helpers are in `src/lib/`.

## Styling hierarchy

Keep the project's style layers coherent:

```text
Global design tokens          src/styles/tokens.css
        ↓
Reusable global styles        src/styles/base.css, utilities.css, motion.css
        ↓
Shared components             src/components/ui/<Name>/<Name>.module.css
        ↓
Component-specific CSS        <Component>/<Component>.module.css
```

The global files load in cascade layers (tokens, base, utilities, motion); CSS modules are unlayered and always win. Use tokens (`--ink`, `--space-3`, `--radius-md`, `--text-sm`, `--z-modal`, ...) instead of raw values; add a token only when a value repeats. Utilities are few (`mono`, `muted`, `note`, `cluster`, `stack`, `visually-hidden`); don't add one for a single use.

Rules that come from CSS modules:

- Class names are scoped, so state that CSS reacts to is a `data-*` or ARIA attribute (`data-lit`, `aria-selected`), not a class toggled from script. Tests and scripts select by role, label or `data-*`, never by class.
- Animation names are renamed too: use the shared keyframes through their variables, `animation: var(--kf-rise) 0.3s both`.
- To change a shared component's look from a parent, pass `className` and qualify the rule with the parent (`.event > .menu`, `p > .toggle`) so it wins whatever order the CSS loads in.
- Refer to global utilities inside a module with `:global(.mono)`.
- No fixed inline styles; inline styles only for values computed at run time (a bar's width).

Use semantic class names that describe purpose (`trip-summary` style: `.tiles`, `.dayChip`), camelCase inside modules.

## Product-specific interaction

- Keep trip and item editing direct and recoverable: show save/pending/error state and preserve user edits after recoverable failures.
- For AI import, distinguish paste, validation, preview, correction/skip, explicit confirmation, and completion. Never imply data was saved before commit. Keep AI suggestions and estimate prices visibly unverified.
- Show the owner/viewer role and keep viewer controls read-only. Invitation pages should not reveal trip content before authenticated acceptance.
- Make empty, loading, error, conflict, and permission-denied states intentional. Handle dates/times in the displayed trip or item zone rather than silently shifting them.

## Accessibility and responsive behavior

Use semantic HTML and labels; support keyboard navigation and visible focus; associate errors with controls; communicate loading and disabled states; ensure dialogs can be operated and dismissed accessibly; do not rely only on color. Use flexible layout and existing breakpoints. Test representative narrow and wide layouts using the project's available workflow.

Before finishing, review global-style reuse, duplication, class clarity, inline styling, component reuse, keyboard path, focus, error/empty states, and responsive behavior. Use `testing` for test choices and `code-review` for an independent review.
