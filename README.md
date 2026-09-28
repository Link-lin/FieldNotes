# Field Notes (Travel Planner)

A private trip planner: a globe of every trip, and a page per trip with a day-by-day itinerary, a sketch map, booking tasks and planned costs. Product scope is in [PRD.md](PRD.md); architecture in [docs/design/technical-design.md](docs/design/technical-design.md).

**Built so far:** Google sign-in with an owner allowlist, trips (create, edit, time-zone change, delete), dashboard globe and list, trip page with tabs, events (add, edit, duplicate, delete with undo), booking list, costs and budget, day map, account deletion, owner-only AI import, read-only viewer invitations, an event side panel (click an event) with an embedded Google map and notes, pinning an event by pasting its coordinates, and privacy-safe daily pilot counts. The import page provides a conversion prompt for a plan already discussed in an external AI chat, an optional new-trip prompt, JSON v1 validation, a day-by-day editable preview, and confirmed atomic creation.

Owners share a trip from its **Share** dialog: invite one email, copy the one-time link (Field Notes sends no email), and revoke access or create a new link later. The invitee opens the link, signs in with the matching Google account and sees the trip read-only.

**Not built yet:** Importing into an existing trip (proposed TRIP-7).

## Requirements

Node.js 22 or later and npm. PostgreSQL 16 or 17 is optional: `npm run db:start` runs a local embedded server.

## Setup

```sh
npm install
cp .env.example .env.local      # then fill in the values below
npm run db:start                # terminal 1: local PostgreSQL on port 5433 (data in .pgdata/)
npm run db:migrate              # terminal 2: create the tables (run again after pulling new migrations)
npm run dev                     # http://localhost:3000
```

In `.env.local`:

- `AUTH_SECRET`: run `npx auth secret` or `openssl rand -base64 33`.
- `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`: create an OAuth client (type "Web application") in Google Cloud Console → APIs & Services → Credentials. Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI.
- `TRIP_OWNER_EMAILS`: your Google address (comma-separated for more than one). Only these accounts can create trips.
- `GOOGLE_MAPS_EMBED_API_KEY` (optional): shows a Google map in each event's side panel. In Google Cloud Console, enable the **Maps Embed API**, create an API key, and restrict it to that API and to your site (for example `http://localhost:3000/*`). Without it the panel shows the event without a map.
- `APP_ORIGIN`: `http://localhost:3000` locally; your https origin in production. Every write must come from this origin, and Auth.js uses it for callback URLs unless `AUTH_URL` is set.

## Checks

```sh
npm run lint
npm run typecheck
npm test              # unit + PostgreSQL integration tests (starts a throwaway embedded PostgreSQL)
npm run test:unit
npm run test:db
npm run build
```

`BUILD_STANDALONE=1 npm run build` produces `.next/standalone` for a container or a plain `node server.js` deployment (copy `.next/static` into `.next/standalone/.next/static`).

## Pilot report

`npm run pilot:report` prints the daily usage counts recorded for the AI import pilot (PRD section 8): totals, weekly figures and rates such as clean previews and skipped items. It reads `DATABASE_URL` from `.env.local`. The counts hold no account, trip or content data. Run `npm run db:migrate` first so the `usage_counts` table exists; until then the app simply records nothing.

## Data

`src/data/` holds the bundled place and airport lists (see its SOURCES.md). `npm run data:build` regenerates them; it downloads Natural Earth and OurAirports files, so it needs network access.

## Layout

```text
src/
  app/                  routes: pages and API route handlers (thin)
  features/             screens, one folder per component, children nested inside
    dashboard/Dashboard/        Hero, TripList, BookingTasks, Globe, ...
    trips/TripPage/             TripHeader, DayTabs, Timeline, MapPanel, EventPanel, CostsSection, ShareDialog, ...
    trips/TripForm/, trips/ItemForm/, currency/, auth/SignInCard/
    import/ImportPage/          prompt copy, paste, preview and correction
    invitations/InvitePage/     invitation link landing: stage, sign in, accept
  components/
    ui/                 shared building blocks: Button, Field, Modal, Menu, Tag, Card, ...
    layout/             AppShell, AppHeader (with AccountMenu), PageMessage
  styles/               global CSS: tokens, base, utilities, motion (cascade layers)
  lib/                  browser helpers: api, format, cx, dialog, values read after hydration
  shared/               used by browser and server: zod schemas, DTO types, time, money, map links
  server/
    core/               db client and schema types, env, HTTP helpers and the route() wrapper
    auth/               Auth.js setup, session, actor, sign-in gate, per-trip access checks
    modules/<feature>/  service (rules), repository (SQL), mapper (DTOs): trips, items, dashboard, account, places, import, invitations, usage
  data/                 bundled place and airport lists
db/migrations/          SQL migrations
scripts/                dev database, data build and pilot report
tests/unit, tests/db    Vitest projects
```

Each component folder holds `Name.tsx` (markup and behavior) and `Name.module.css` (its styles). Components made only of shared building blocks have no CSS file of their own. Route handlers call services; services check access with `server/auth/access.ts` and never skip it.
