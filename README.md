# Field Notes (Travel Planner)

A private trip planner: a globe of every trip, and a page per trip with a day-by-day itinerary, an outline map, booking tasks and planned costs. Product scope is in [PRD.md](PRD.md); architecture in [docs/design/technical-design.md](docs/design/technical-design.md).

**Built so far:** Google sign-in with an owner allowlist, trips (create, edit, time-zone change, delete), dashboard globe and list, trip page with an itinerary and a dedicated Bookings view (open an event, mark it booked, set a book-by date), events (add, edit, duplicate, delete with undo), costs and budget, an outline day map with an optional Google road-route view, account deletion, owner-only AI import, read-only viewer invitations, an event side panel (click an event) with an embedded Google map and notes, place-name lookup and coordinate pins, and privacy-safe daily pilot counts. Dashboard cards link to each owned trip's bookings without repeating the task list. The import page provides a conversion prompt for a plan already discussed in an external AI chat, an optional new-trip prompt, JSON v1 validation, a day-by-day editable preview with optional place suggestions, and confirmed atomic creation.

Owners share a trip from its **Share** dialog: invite one email with a role (**viewer** reads, **editor** also changes events, bookings and notes, **owner** also edits the trip, shares it and deletes it), copy the one-time link (Field Notes sends no email), and change a role, revoke access or create a new link later. The invitee opens the link, signs in with the matching Google account and gets that role. The person who created a trip is always an owner.

**Not built yet:** Importing into an existing trip (proposed TRIP-7).

## Demo

To see every screen without entering anything, load the demo trips into a local copy (what they hold is described under [Test trips](#test-trips)):

```sh
npm install && cp .env.example .env.local   # fill in the values under Setup
npm run dev                                 # open http://localhost:3000 and sign in once
npm run db:seed:hawaii                      # in a second terminal: loads the six demo trips
```

The loader is a development tool and refuses to run in production, so a Docker install starts empty. To look around the demo, run it locally as above.

## Requirements

Node.js 22 or later and npm. PostgreSQL 16 or 17 is optional: `npm run dev` runs a local embedded server for you.

## Setup

```sh
npm install
cp .env.example .env.local      # then fill in the values below
npm run dev                     # http://localhost:3000
```

`npm run dev` starts the local PostgreSQL (port 5433, data in `.pgdata/`) if it isn't already running, applies any new migrations, then starts the app. Ctrl+C stops both. If `DATABASE_URL` points somewhere else, or a database is already running on that port, it uses that database and doesn't start or stop anything. `npm run db:start` (the database on its own), `npm run db:migrate` (migrations on their own, as in production) and `npm run dev:app` (the app only) are still available.

In `.env.local`:

- `AUTH_SECRET`: run `npx auth secret` or `openssl rand -base64 33`.
- `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`: create an OAuth client (type "Web application") in Google Cloud Console → APIs & Services → Credentials. Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI.
- `TRIP_OWNER_EMAILS`: your Google address (comma-separated for more than one). Only these accounts can create trips. A Gmail address matches whatever the dots, `+tag` or googlemail.com spelling.
- `GOOGLE_MAPS_EMBED_API_KEY` (optional): shows a Google map in each event's side panel and enables **Road route** on a day tab. In Google Cloud Console, enable the **Maps Embed API**, create an API key, and restrict it to **Maps Embed API only** and to your site (for example `http://localhost:3000/*`). The road iframe loads only after a user selects it and sends that segment's pinned coordinates to Google. Without the key the local outline map and external Google Maps links still work. You do not need to enable Maps JavaScript or Routes API for this feature.
- `GEOAPIFY_API_KEY` (optional): looks up place names in an AI import preview or when you choose **Find place on map** in the event editor, then suggests pins for the custom outline map. Create a Geoapify project and key, then add it here; restart `npm run dev`. Only the place name and trip destination go to Geoapify. Clear venue matches are selected for review in import; you can change or remove every match before confirming. Without this key, imports still work but place names alone do not create pins. The Google Maps Embed key cannot perform this lookup.
- `APP_ORIGIN`: `http://localhost:3000` locally; your https origin in production. Every write must come from this origin, and Auth.js uses it for callback URLs unless `AUTH_URL` is set.

## Self-hosting with Docker

Run Field Notes on your own server with Docker Compose: the app, its own PostgreSQL 17 database and, if you want it, automatic HTTPS. You need Docker with the Compose plugin and a Google OAuth client (see [Setup](#setup)).

```sh
git clone https://github.com/Link-lin/FieldNotes.git && cd FieldNotes
cp docker.env.example .env     # fill it in; the file explains each value
docker compose up -d           # builds the image, starts the database, migrates it, starts the app
```

The first start builds the image, which takes a few minutes. The app then listens on `127.0.0.1:3000` only (change the port with `APP_PORT`). Choose how people reach it:

- **Automatic HTTPS:** point a DNS name at the server and open ports 80 and 443. In `.env` set `APP_ORIGIN=https://that-name` and `APP_DOMAIN=that-name`, then run `docker compose --profile https up -d`. Caddy gets and renews the certificate by itself.
- **Your own reverse proxy:** proxy your HTTPS address to `127.0.0.1:3000` and set `APP_ORIGIN` to that address.
- **Trying it on the same machine:** use `APP_ORIGIN=http://localhost:3000` (Google allows plain http only for localhost).

In Google Cloud Console add `<APP_ORIGIN>/api/auth/callback/google` as an authorized redirect URI, then open the address and sign in with an address from `TRIP_OWNER_EMAILS`. `docker compose ps` shows the app as healthy once it can reach the database (it checks `/api/health`).

| Task | Command |
| --- | --- |
| Update | `git pull && docker compose up -d --build` (new migrations run before the app starts) |
| Logs | `docker compose logs -f app` |
| Stop | `docker compose down` (your data stays in the `db-data` volume) |
| Back up | `docker compose exec -T db pg_dump -U fieldnotes fieldnotes \| gzip > fieldnotes-$(date +%F).sql.gz` |

To restore a backup into an empty database (this deletes the data now in the database), use the same `--profile` flags you start with: `docker compose down`, `docker volume rm fieldnotes_db-data`, `docker compose up -d db`, then `gunzip -c fieldnotes-….sql.gz | docker compose exec -T db psql -U fieldnotes fieldnotes`, then `docker compose up -d`. Deleting a trip or account removes it from the live database at once, but any backup you've kept still contains it until you delete that backup.

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

## Test trips

`npm run db:seed:hawaii` loads six test trips into your local database for the first address in `TRIP_OWNER_EMAILS` (or `npm run db:seed:hawaii -- you@example.com`). Sign in to the app once first so your account exists, and keep the database running (`npm run dev` in another terminal). Running it again replaces the test trips; your other trips are not touched.

- **Hawaii test trip** (starts three weeks from today, 32 events): every event type; timed, date-only, undated and outside-the-trip events; booked, scheduled-but-unbooked, placeholder, overnight and undated flights (one with no airports yet); an event in another time zone; a return visit to the same place on another day; pins from Google, Apple Maps, OpenStreetMap and pasted coordinates; a shortened and a look-alike link that don't pin; overdue, due-today, upcoming and undated booking tasks; AI drafts with unverified and confirmed prices; a second currency; a budget; and sharing entries in every state and role (an editor, a pending owner, an expired editor and a revoked viewer) in **Share**.
- **Kyoto long weekend**: a past trip over budget, owned by a made-up friend (Sam Rivera) and shared with you as a **viewer**, so you can see the read-only view.
- **Osaka street food** and **Seoul weekend**: small trips owned by Sam where you are an **editor** (you can change events but not the trip or its sharing) and a **co-owner**. In Hawaii's **Share** dialog, Sam is an editor and the pending, expired and revoked entries show other roles.
- **Lisbon & Porto**: far in the future, no events and no globe point.
- **Kauaʻi long weekend**: happening now (yesterday to tomorrow), so the trip shows Travelling now and **Up next** picks the next event of the day.

Book-by dates are relative to the day you run it, so re-run it to reset the overdue and due-today states. Deleting and undoing an event, time-zone changes, the import flow and signing in as a viewer still need doing by hand. Development only: it refuses to run with `NODE_ENV=production`.

## Pilot report

`npm run pilot:report` prints the daily usage counts recorded for the AI import pilot (PRD: Validation and MVP acceptance): totals, weekly figures and rates such as clean previews and skipped items. It reads `DATABASE_URL` from `.env.local`, so the database must be running (`npm run dev` or `npm run db:start`). The counts hold no account, trip or content data.

## Data

`src/data/` holds the bundled place and airport lists (see its SOURCES.md). `npm run data:build` regenerates them; it downloads Natural Earth and OurAirports files, so it needs network access.

## Layout

```text
src/
  app/                  routes: pages and API route handlers (thin)
  features/             screens, one folder per component, children nested inside
    dashboard/Dashboard/        Hero, TripList, Globe, ...
    trips/TripPage/             TripHeader, TripViewNav, BookingList, DayTabs, Timeline, MapPanel, EventPanel, CostsSection, ShareDialog, ...
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
Dockerfile, docker-compose.yml, docker/, docker.env.example   self-hosting with Docker (see above)
scripts/                dev start, dev database, test trips, data build and pilot report
tests/unit, tests/db    Vitest projects
```

Each component folder holds `Name.tsx` (markup and behavior) and `Name.module.css` (its styles). Components made only of shared building blocks have no CSS file of their own. Route handlers call services; services check access with `server/auth/access.ts` and never skip it.
