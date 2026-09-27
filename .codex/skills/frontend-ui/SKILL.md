---
name: frontend-ui
description: Design and implement Travel Planner UI changes that fit the established application, styling, accessibility, and responsive patterns.
---

# Frontend and UI

Use this skill for screens, components, interactions, forms, and visual behavior. The current repository has no implemented UI or styling system. The technical design proposes a Next.js/TypeScript UI, but verify the scaffold before relying on it.

## Inspect before changing

- Read the relevant PRD flow and UI requirements, then inspect existing routes, layouts, shared components, design tokens, global styles, state/data patterns, and responsive breakpoints.
- Reuse the project's existing components and style architecture. Do not create parallel button/form/card systems or introduce a new CSS methodology because it is familiar.
- Before adding styles, search in this order: existing component, global style, design token, utility/mixin, then component-specific CSS.

## Styling hierarchy

Keep the project's style layers coherent:

```text
Global design tokens
        ↓
Reusable global styles
        ↓
Shared components
        ↓
Component-specific CSS
```

Use this hierarchy where the actual application architecture supports it. Travel Planner currently has no global CSS, SCSS, tokens, breakpoints, CSS Modules, or utility framework; inspect what is introduced before choosing a place for styles. Do not create arbitrary tokens or global abstractions for one-off values.

Component styles should contain only genuinely unique rules. Reuse common colors, typography, spacing, borders, radii, shadows, and layout patterns. Avoid unnecessary inline styles; use a meaningful class or component state/attribute where appropriate. Use semantic class names that describe purpose, such as `trip-summary` or `booking-task-list`; follow the established naming convention rather than imposing BEM, utility classes, or another system.

## Product-specific interaction

- Keep trip and item editing direct and recoverable: show save/pending/error state and preserve user edits after recoverable failures.
- For AI import, distinguish paste, validation, preview, correction/skip, explicit confirmation, and completion. Never imply data was saved before commit. Keep AI suggestions and estimate prices visibly unverified.
- Show the owner/viewer role and keep viewer controls read-only. Invitation pages should not reveal trip content before authenticated acceptance.
- Make empty, loading, error, conflict, and permission-denied states intentional. Handle dates/times in the displayed trip or item zone rather than silently shifting them.

## Accessibility and responsive behavior

Use semantic HTML and labels; support keyboard navigation and visible focus; associate errors with controls; communicate loading and disabled states; ensure dialogs can be operated and dismissed accessibly; do not rely only on color. Use flexible layout and existing breakpoints. Test representative narrow and wide layouts using the project's available workflow.

Before finishing, review global-style reuse, duplication, class clarity, inline styling, component reuse, keyboard path, focus, error/empty states, and responsive behavior. Use `testing` for test choices and `code-review` for an independent review.
