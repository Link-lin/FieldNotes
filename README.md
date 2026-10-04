# Field Notes (Travel Planner)

A private trip planner: a globe of every trip, and a page per trip with a day-by-day itinerary, an outline map, booking tasks and planned costs. Product scope is in [PRD.md](PRD.md); architecture in [docs/design/technical-design.md](docs/design/technical-design.md).

**Built so far:** Google sign-in (and, if you set them up, Apple and WeChat) with an owner allowlist, trips (create, edit, time-zone change, delete), dashboard globe and list, trip page with an itinerary and a dedicated Bookings view (open an event, mark it booked, set a book-by date), events (add, edit, duplicate, delete with undo), costs and budget, editing events and trip details in place where they are shown, in one right-hand panel, an outline day map with an optional Google road-route view, account deletion, owner-only AI import, read-only viewer invitations, an event side panel (click an event, its pin or its stop-list name) with an embedded Google map and notes, place-name lookup and coordinate pins, and privacy-safe daily pilot counts. Dashboard cards link to each owned trip's bookings without repeating the task list, and an owned trip's card menu opens its Trip details or Share. The import page provides a conversion prompt for a plan already discussed in an external AI chat, an optional new-trip prompt, JSON v1 validation, a day-by-day editable preview with optional place suggestions, and confirmed atomic creation. Claude or ChatGPT can also be connected to your account as a custom connector, to read your trips and, if you allow it, add and change events (see [below](#using-claude-or-chatgpt-with-field-notes)).

Owners share a trip from its **Share** dialog: invite one email with a role (**viewer** reads, **editor** also changes events, bookings and notes, **owner** also edits the trip, shares it and deletes it), send the one-time link by email (when the server has email set up, see `SMTP_URL` below; otherwise copy it and send it yourself), or invite someone **by link** with just a name or note (for a contact without a Google address; whoever opens the link first joins), and change a role, revoke access or send a new link later. The invitee opens the link, signs in with the matching Google account and gets that role. The person who created a trip is always an owner. When an owner deletes their account, each trip they own stays with another owner, goes to someone they choose (the next person in line is suggested) or is deleted; a trip always keeps an owner.

**Not built yet:** Importing into an existing trip (proposed TRIP-7).

## Demo

![A tour of Field Notes: the globe of trips, a day with its outline map, bookings, an AI plan preview and the AI connector](docs/images/tour.gif)

These are the demo trips (made-up data) on a desktop and a phone.

**Every trip on one globe.** The dashboard lists the trips you own or were invited to by date, with a globe of approximate destinations. The list works without the globe.

![The dashboard: the trip list and a globe with the Hawaii trip selected](docs/images/dashboard.png)

**A day at a time.** A trip's itinerary is by day, with an outline map of the day's stops, flights as boarding passes, prices marked as estimates or quotes, and a clear tag on anything an AI drafted.

![A trip day: a flight, a rental car, a check-in and dinner on a timeline, with the day's stops on an outline map](docs/images/trip.png)

| | |
|---|---|
| ![The bookings view: what is due now and what is coming up](docs/images/bookings.png)<br>**Bookings.** What still needs booking, with book-by dates. | ![The preview of an AI plan, with each item tagged as an unverified draft](docs/images/import.png)<br>**Create from an AI plan.** Review the response day by day, fix or skip items; nothing is saved until you confirm. |
| ![The Share dialog, listing people with their roles](docs/images/share.png)<br>**Share by role.** Viewers read, editors change events, owners also manage the trip. | ![The AI connector dialog, with the connector address and a connected app](docs/images/connector.png)<br>**AI connector.** Add Field Notes to Claude or ChatGPT, and see or disconnect what is connected. |
| ![The page where a person approves an AI app](docs/images/consent.png)<br>**You approve each app.** It reads your trips; changes are optional. | ![The dashboard and a day's timeline on a phone](docs/images/phone.png)<br>**On a phone.** The same trips, in one column. |

To see every screen yourself without entering anything, load the demo trips into a local copy (what they hold is described under [Test trips](#test-trips)):

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
- `GEOAPIFY_API_KEY` (optional): looks up place names for the custom outline map: in an AI import preview, when you choose **Find place on map** in an event's Place & map section, and on its own whenever an event with a place name but no map link is added (by you or a connected chat) or its place changes. An automatic lookup pins the event only when there is one clear match, a few seconds later, and the event view says the pin was found automatically; you can move or remove it in the editor. Create a Geoapify project and key, then add it here; restart `npm run dev`. Only the place name and trip destination go to Geoapify. Clear venue matches are selected for review in import; you can change or remove every match before confirming. Without this key, imports still work but place names alone do not create pins. The Google Maps Embed key cannot perform this lookup.
- `AUTH_APPLE_ID`, `AUTH_APPLE_TEAM_ID`, `AUTH_APPLE_KEY_ID` and `AUTH_APPLE_PRIVATE_KEY` (optional; all four are needed): add **Continue with Apple** next to Google on the sign-in screen. See [Signing in with Apple](#signing-in-with-apple).
- `AUTH_WECHAT_ID`, `AUTH_WECHAT_SECRET` and `AUTH_WECHAT_PLATFORM` (optional; the first two are both needed): add **Continue with WeChat** next to Google on the sign-in screen. See [Signing in with WeChat](#signing-in-with-wechat).
- `SMTP_URL` and `MAIL_FROM` (optional, both needed): make the Share dialog email each invitation instead of leaving you to copy it. `SMTP_URL` is your mail service's address with its login, for example `smtps://user:password@smtp.example.com:465` (or `smtp://…:587`; percent-encode special characters in the password) and `MAIL_FROM` an address it lets you send from, for example `Field Notes <notes@example.com>`. Any SMTP service works (your mail provider, or Resend, Postmark, Mailgun); send from a domain with SPF and DKIM so invitations don't land in spam. The email holds only the trip title, your name, what the role allows and the link. To try it without sending real mail, run a mail catcher such as Mailpit and use `SMTP_URL=smtp://localhost:1025`. If sending fails, the invitation is kept and the dialog shows the message to copy.
- `AI_CONNECTOR` (optional): the AI connector for Claude and ChatGPT is on unless this is `off`. See [Using Claude or ChatGPT with Field Notes](#using-claude-or-chatgpt-with-field-notes).
- `APP_ORIGIN`: `http://localhost:3000` locally; your https origin in production. Every write must come from this origin, and Auth.js uses it for callback URLs unless `AUTH_URL` is set.

## Signing in with Apple

Google stays the default. If the people you share trips with would rather use their Apple ID, you can add **Continue with Apple** as another way to sign in. Field Notes asks Apple only who is signing in: it keeps Apple's ID for the person, the name Apple sends (only the first time they approve the app) and, if they choose to share it, their email, and no avatar or token. Someone who shares their email is treated like a Google account with that address: it can be on `TRIP_OWNER_EMAILS` or accept an email invitation. Someone who picks **Hide My Email** has no address to match, so, like a WeChat account, they can join a trip you share **by link** (**Share** → **By link**) with any role, but can't accept an email invitation or create trips until they connect Google (**Account menu** → **Sign-in methods**).

You need a paid [Apple Developer Program](https://developer.apple.com/programs/) membership and a public **https** site: Apple refuses `http` and `localhost`. To try it before you deploy, run the production build (`npm run build && npm start`) behind a tunnel such as Cloudflare Tunnel or ngrok and use the tunnel's https address as `APP_ORIGIN` (the dev server refuses requests from other host names). In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources):

1. **Identifiers** → add an **App ID** (type App) with **Sign in with Apple** switched on. Apple groups web sign-in under one, whatever you name it.
2. **Identifiers** → add a **Services ID** (for example `com.example.fieldnotes.web`) with **Sign in with Apple** on, then **Configure**: pick that App ID as the primary one, put your site's host name (no `https://`) under **Domains and Subdomains**, and `<APP_ORIGIN>/api/auth/callback/apple` under **Return URLs**. The Services ID is `AUTH_APPLE_ID`.
3. **Keys** → add a key with **Sign in with Apple** on, configured for that App ID, and download the `.p8` file (Apple shows it once). The key's ID is `AUTH_APPLE_KEY_ID`, and the file's text is `AUTH_APPLE_PRIVATE_KEY`: on one line, write its line breaks as `\n` (or paste just the base64 between the `BEGIN` and `END` lines).
4. Your **Team ID** (on the account's Membership page) is `AUTH_APPLE_TEAM_ID`.

Put the four in `.env.local` (or `.env` for Docker) and restart. Field Notes signs the short-lived secret Apple wants from the key itself, so there is nothing to renew every six months. If **Continue with Apple** doesn't appear, one of the four is empty or the key can't be read; the server log says "Sign in with Apple is switched off" and why. An Apple error page usually means the Services ID, Team ID or Key ID doesn't match the key, or the return URL isn't registered exactly as `<APP_ORIGIN>/api/auth/callback/apple`.

Apple sends the name once. If someone's first attempt was turned away (they had no invitation yet), Apple won't send it again until they stop using Apple ID for Field Notes (in their Apple ID settings, **Sign in with Apple**) and try again; until then the account has no name. Field Notes keeps no Apple token, so there is nothing to revoke when an account is deleted.

## Signing in with WeChat

Google stays the default. If the people you share trips with use WeChat rather than Google, you can add it as a second way to sign in. Someone who signs in with WeChat only can join a trip you share **by link** (**Share** → **By link**) with any role, but WeChat gives no email address, so they can't accept an email invitation or create trips. **Account menu** → **Sign-in methods** connects Google to their account (which gives it an address) or WeChat to yours; either then opens the same account and trips. Field Notes asks WeChat only who is signing in: it keeps a nickname and an ID, no avatar, email or token.

You need a WeChat app that allows your site's host name for web authorization, and its callback is `<APP_ORIGIN>/api/auth/callback/wechat`:

- **For a small circle, a WeChat test account.** Sign in to [WeChat's public-platform sandbox](https://mp.weixin.qq.com/debug/cgi-bin/sandbox?t=sandbox/login) with WeChat, copy its `appID` and `appsecret`, and set its web authorization (网页授权) domain to your site's host name (no `https://`). Each person has to follow the test account (its QR code is on that page) before they can sign in, and it allows only a limited number of followers (around 100). Leave `AUTH_WECHAT_PLATFORM` as `OfficialAccount`: it works inside WeChat's own browser, so send the invitation link in a WeChat chat and open it there.
- **A WeChat Open Platform website app** shows a QR code to scan on a desktop browser (`AUTH_WECHAT_PLATFORM=WebsiteApp`). WeChat approves these only for verified developers, which is generally limited to registered businesses and not open to individuals outside mainland China.

Put the ID and secret in `.env.local` (or `.env` for Docker) and restart. WeChat sign-in is only as private as your site: the same invitation rules apply, and a new WeChat account is admitted only by an invitation link.

## Using Claude or ChatGPT with Field Notes

Field Notes can act as a custom connector, so you can ask Claude or ChatGPT about your trips and have it add or change events. The chat runs on your own subscription with Claude or ChatGPT; Field Notes calls no AI itself.

**What you need.** A public https address for your install. The connector is on by default and needs no key, no Google setting and no change to `.env`: set `APP_ORIGIN` to that address (see [Self-hosting with Docker](#self-hosting-with-docker)) and the connector address is `<APP_ORIGIN>/mcp`. Claude's and ChatGPT's servers call it, so a private or `localhost` address won't work. To try it from your own machine, put a tunnel such as Cloudflare Tunnel or ngrok in front of it and set `APP_ORIGIN` to the tunnel's address.

**Connect an app.** **Account menu** → **AI connector** shows the address, with a copy button, and the apps you have connected. Then:

- **Claude** (claude.ai and the desktop app): **Customize** → **Connectors** → **Add custom connector**, and paste the address. The steps differ a little by plan; see [Claude's guide](https://claude.com/docs/connectors/custom/add-unlisted).
- **ChatGPT:** **Settings** → **Security and login** → turn on **Developer mode** (Plus, Pro, Business, Enterprise or Education), create a developer-mode app for a remote MCP server with the address and **OAuth** sign-in (the form's optional **Icon** takes `<APP_ORIGIN>/icon.png`, a 128 px image the dialog also links), then pick it from the **Developer mode** tool in a chat. See [OpenAI's guide](https://developers.openai.com/api/docs/guides/developer-mode).
- **Claude Code:** add the server, then run `/mcp` inside Claude Code to sign in.

```bash
claude mcp add --transport http field-notes https://notes.example.com/mcp
```

Each of them opens a Field Notes window: sign in and choose what to allow, **Read** your trips (always) and **Make changes** (optional). Approval is per app. **Disconnect** in the dialog (or in the app) ends it on the app's next request. If you change `APP_ORIGIN`, connect again.

**Working with a chat.** Keep the trip open in Field Notes while you chat: what the chat adds or changes shows up within a few seconds, highlighted, with a short note, and (with `GEOAPIFY_API_KEY` set) places with one clear match get their map pins on their own. You can plan as you go (the chat creates the trip once destination and dates are settled, then adds and changes events as you agree on them) or plan in the chat and ask it to create the whole trip at the end; it hands you the trip's link either way. Everything it adds is an unverified AI draft: check the events, then choose **Mark all reviewed** above the itinerary, or **Mark as reviewed** on one event. ChatGPT asks you to confirm each change; choosing to remember your approval covers that tool for the rest of the conversation.

**If it won't connect.** Check the address from outside your network:

```bash
curl -i -X POST https://notes.example.com/mcp
```

A working install answers `401` with a `WWW-Authenticate: Bearer …` header that points at `resource_metadata`. Anything else usually means the address isn't public https, a firewall or CDN is blocking the app's servers (Anthropic publishes [its address range](https://platform.claude.com/docs/en/api/ip-addresses)), `APP_ORIGIN` isn't spelled exactly like the address you pasted (no trailing slash), or `AI_CONNECTOR=off` is set. A change is refused when you approved read-only, or when your role on that trip is viewer.

**What the chat can do.** It has tools to list your trips, read one, add items, change or delete an item (deletions can be undone for ten minutes) and, if you are on the owner list, create a trip. It acts as you, so your role on each trip limits it: a viewer's chat can only read. Everything it adds is marked as an unverified AI draft with estimate prices until you mark it reviewed on the trip page (an event's menu, or **Mark all reviewed** above the itinerary); it cannot mark anything reviewed or booked, set a book-by date, share a trip, change who has access or delete a trip. `AI_CONNECTOR=off` turns the whole feature off. What a connected chat reads goes to that chat's provider, under its privacy policy. Design and protocol details are in the technical design (**AI connector**).

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

In Google Cloud Console add `<APP_ORIGIN>/api/auth/callback/google` as an authorized redirect URI, then open the address and sign in with an address from `TRIP_OWNER_EMAILS`. `docker compose ps` shows the app as healthy once it can reach the database (it checks `/api/health`). To have invitations emailed, also set `SMTP_URL` and `MAIL_FROM` in `.env` (see [Setup](#setup)) and run `docker compose up -d` again.

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

- **Hawaii test trip** (starts three weeks from today, 32 events): every event type; timed, date-only, undated and outside-the-trip events; booked, scheduled-but-unbooked, placeholder, overnight and undated flights (one with no airports yet); an event in another time zone; a return visit to the same place on another day; pins from Google, Apple Maps, OpenStreetMap and pasted coordinates; a shortened and a look-alike link that don't pin; overdue, due-today, upcoming and undated booking tasks; AI drafts with unverified and confirmed prices, and two the owner has marked reviewed (one a flight placeholder, now pinned at its arrival airport); a second currency; a budget; and sharing entries in every state and role (an editor, a pending owner, an expired editor, a revoked viewer and a pending invitation by link) in **Share**.
- **Kyoto long weekend**: a past trip over budget, owned by a made-up friend (Sam Rivera) and shared with you as a **viewer**, so you can see the read-only view.
- **Osaka street food** and **Seoul weekend**: small trips owned by Sam where you are an **editor** (you can change events but not the trip or its sharing) and a **co-owner**. In Hawaii's **Share** dialog, Sam is an editor and the pending, expired and revoked entries show other roles.
- **Lisbon & Porto**: far in the future, no events and no globe point, with Sam as a co-owner. In **Delete my account** it stays with Sam, Hawaii asks who takes over, and Kauaʻi and Seoul (nobody else on them) would be deleted.
- **Kauaʻi long weekend**: happening now (yesterday to tomorrow), so the trip shows Travelling now and **Up next** picks the next event of the day.

Book-by dates are relative to the day you run it, so re-run it to reset the overdue and due-today states. Deleting and undoing an event, time-zone changes, the import flow and signing in as a viewer still need doing by hand. Development only: it refuses to run with `NODE_ENV=production`.

## Pilot report

`npm run pilot:report` prints the daily usage counts recorded for the AI import pilot (PRD: Validation and MVP acceptance): totals, weekly figures and rates such as clean previews, skipped items and the share of AI items people changed. It reads `DATABASE_URL` from `.env.local`, so the database must be running (`npm run dev` or `npm run db:start`). The counts hold no account, trip or content data.

## Data

`src/data/` holds the bundled place and airport lists (see its SOURCES.md). `npm run data:build` regenerates them; it downloads Natural Earth and OurAirports files, so it needs network access.

## Layout

```text
src/
  app/                  routes: pages and API route handlers (thin), and the site icons
  features/             screens, one folder per component, children nested inside
    dashboard/Dashboard/        Hero, TripList, Globe, ...
    trips/TripPage/             TripHeader, TripViewNav, BookingList, DayTabs, Timeline, MapPanel, EventPanel (the event view and its in-place editing), CostsSection, ShareDialog, ...
    trips/TripDetails/          the trip details and New trip panel
    currency/, auth/SignInCard/
    import/ImportPage/          prompt copy, paste, preview and correction
    invitations/InvitePage/     invitation link landing: stage, sign in, accept
  components/
    ui/                 shared building blocks: Button, Field, SidePanel, InlineEdit, EditSection, Modal, Menu, Tag, Card, ...
    layout/             AppShell, AppHeader (with AccountMenu), PageMessage
  styles/               global CSS: tokens, base, utilities, motion (cascade layers)
  lib/                  browser helpers: api, format, cx, dialog, values read after hydration
  shared/               used by browser and server: zod schemas, DTO types, time, money, map links
  server/
    core/               db client and schema types, env, HTTP helpers and the route() wrapper
    auth/               Auth.js setup, session, actor, sign-in gate, per-trip access checks
    modules/<feature>/  service (rules), repository (SQL), mapper (DTOs): trips, items, dashboard, account, places, import, invitations, usage, oauth, connector
  data/                 bundled place and airport lists
db/migrations/          SQL migrations
Dockerfile, docker-compose.yml, docker/, docker.env.example   self-hosting with Docker (see above)
scripts/                dev start, dev database, test trips, data build and pilot report
tests/unit, tests/db    Vitest projects
```

Each component folder holds `Name.tsx` (markup and behavior) and `Name.module.css` (its styles). Components made only of shared building blocks have no CSS file of their own. Route handlers call services; services check access with `server/auth/access.ts` and never skip it.
