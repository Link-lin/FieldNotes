# Field Notes (Travel Planner)

A private trip planner: a globe of every trip, and a page per trip with a day-by-day itinerary, a sketch map, booking tasks and planned costs. Product scope is in [PRD.md](PRD.md); architecture in [docs/design/technical-design.md](docs/design/technical-design.md).

**Built so far (core milestone):** Google sign-in with an owner allowlist, trips (create, edit, time-zone change, delete), dashboard globe and list, trip page with tabs, events (add, edit, duplicate, delete with undo), booking list, costs and budget, day map, account deletion.
**Not built yet:** AI import (IMPORT-*, TRIP-7) and viewer invitations (ACCESS-3 to ACCESS-7). Viewer access works if a grant row exists, but there is no screen to create one.

## Requirements

Node.js 22 or later and npm. PostgreSQL 16 or 17 is optional: `npm run db:start` runs a local embedded server.

## Setup

```sh
npm install
cp .env.example .env.local      # then fill in the values below
npm run db:start                # terminal 1: local PostgreSQL on port 5433 (data in .pgdata/)
npm run db:migrate              # terminal 2: create the tables
npm run dev                     # http://localhost:3000
```

In `.env.local`:

- `AUTH_SECRET`: run `npx auth secret` or `openssl rand -base64 33`.
- `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`: create an OAuth client (type "Web application") in Google Cloud Console → APIs & Services → Credentials. Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI.
- `TRIP_OWNER_EMAILS`: your Google address (comma-separated for more than one). Only these accounts can create trips.
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

## Data

`src/data/` holds the bundled place and airport lists (see its SOURCES.md). `npm run data:build` regenerates them; it downloads Natural Earth and OurAirports files, so it needs network access.

## Layout

- `src/app`: pages and route handlers (`api/`). `(private)` pages require a session.
- `src/server`: server-only data access. `access.ts` is the authorization boundary; every route calls the DAL, never the database directly.
- `src/shared`: code used on both sides (validation schemas, time, money, map links, DTO types).
- `src/components`: client components. Styles live in `src/app/globals.css` (tokens first, then components).
- `db/migrations`: SQL migrations run by `npm run db:migrate`.
- `tests/unit`, `tests/db`: Vitest projects.
