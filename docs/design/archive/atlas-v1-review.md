*September 2026 design review, kept for history. It no longer describes the current design; see [atlas-v1.md](../atlas-v1.md) and [trip-page-v1.md](../trip-page-v1.md).*

# Atlas v1 design review

**Status:** Review notes, subordinate to [`PRD.md`](../../../PRD.md) ATLAS-1-7 and [`atlas-v1.md`](../atlas-v1.md).
**Reviewed:** Figma file "Travel Planner - Product UI/UX", page "Global Atlas - World View" (Field Notes shell, world atlas, itinerary list); the two reference repositories; the PRD and Atlas doc.
**Prototype:** interactive HTML redesign published as a private Claude artifact ("Field Notes Atlas"). The Figma file was not edited because the Figma MCP call limit on the Starter plan was reached.
**Revision 2 (26 Sep 2026):** the prototype moved to a warm paper-and-ink style, added a full-page trip view, per-item map links, a schematic day map, budget display and owner actions. Those changes are specified in [`trip-page-v1.md`](../trip-page-v1.md); the PRD and technical design were updated to match. The sections below record the first review and are still accurate for the globe.

## What already works

- *(Superseded by Revision 2's paper-and-ink direction.)* At the time, the light neutral canvas, navy shell, lake-blue accent and restrained terracotta matched the direction in atlas-v1.md.
- Globe and list sit side by side, with All / Upcoming / Ongoing / Past filters, zoom controls and a marker callout with **Open trip**.

## Gaps found against the PRD and Atlas doc

| Area | In the Figma screen | Requirement | Change in prototype |
| --- | --- | --- | --- |
| Summary tiles | "Countries in your plans", "Cities", and a single JPY total | atlas-v1.md: omit country and annual-spend metrics; never sum currencies | Tiles show Trips, Coming up, Bookings to make, all derived from supported data |
| Marker meaning | Terracotta vs navy dots | ATLAS-6: color alone must not carry status | Shape plus color: circle = upcoming, diamond = ongoing, ring = past; legend and text chips repeat it |
| Shared coordinates | One callout per marker | atlas-v1.md: expose all trips at a shared point | Count badge on the marker; callout lists every trip at that point |
| Unlocated trips | Not visible on the main screen | ATLAS-2, ATLAS-4 | Card shows **Set globe location**; trip sheet has a bundled-place search, Save point and Clear point |
| Provenance | Not shown | ATLAS-5 | Callout and sheet say "Approximate destination" or "Point set by you" |
| Viewer trips | Not distinguished | ACCESS-5 | Role label on each card; no location or booking controls for viewers |
| Fallback | Separate frame | ATLAS-6 | Same shell renders list-only state; list never depends on the canvas |
| Overdue tasks | Text only | BOOK-2, BOOK-3 | Icon plus text ("Overdue by 6 days") so it is not color-only |

## What the two references contribute

**Travel-Plan-Page (mobile-first, modular trip page).** Its strength is a trip page built from self-contained modules on a phone: flights, a day-by-day timeline, tasks. Adopted here: card-first mobile layout, a trip sheet made of modules (Bookings to make, Itinerary timeline, Globe location), and each timeline row carrying its own state tags. Not adopted: shared expense ledger, PDF tickets and route maps, which the PRD places out of MVP or out of scope.

**Travel-Story (global footprint and route playback).** Its README describes a 2D MapLibre GL map, not a 3D globe, with route animation synced to a timeline. Adopted: the "global footprint" idea as the dashboard's first view, and click-to-rotate focus on a trip. Deferred: routes and playback. ATLAS-1 limits v1 to one point per trip and forbids flight paths, so route lines belong to a later milestone. MapLibre also needs map tiles or a style source, which conflicts with ATLAS-7 unless tiles are bundled. The prototype uses a canvas globe with bundled land geometry; `react-globe.gl` remains the implementation starting point named in atlas-v1.md.

## Additions worth deciding on

1. **Rotate-to-trip on list selection** (already in atlas-v1.md), with reduced-motion skipping the animation. Implemented.
2. **Dot-matrix land** instead of filled continents. It tolerates coarse bundled geometry and keeps the bundle small. Needs a check against the Natural Earth reduced set.
3. **Docked callout on narrow screens** so it never covers the marker it describes. Prototype overlays it; this is unresolved for phones.
4. **Route playback** as a post-v1 milestone, only after ATLAS-1 changes.

## Revision 2: what changed and where it is specified

| Change | Specified in |
| --- | --- |
| Warm paper-and-ink palette and serif type replace navy and lake-blue; forest accent needs confirmation | [`trip-page-v1.md`](../trip-page-v1.md#visual-direction), [`atlas-v1.md`](../atlas-v1.md) |
| Trip opens on its own page, with Whole trip and per-day tabs | PRD TRIP-1, TRIP-2 |
| Per-item map link, schematic day map with zoom and pan, straight-line distances, Google Maps hand-off | PRD MAP-1 to MAP-7; technical design "Trip page and day map" |
| PRD "Do not build" no longer forbids itinerary maps; it forbids basemaps, routing, geocoding, reviews | PRD, MVP scope |
| Add, edit, share, delete actions on the trip page only; three-dot menu per event with undo; floating add button; import into a trip is proposed | PRD TRIP-3, TRIP-7 to TRIP-9, ACCESS-9 to ACCESS-11 |
| Budget tile and per-currency cost cards with remaining or over budget; no conversion | PRD BUDGET-6, BUDGET-7; roadmap "currency conversion" |
| Motion policy, wheel zoom, marker shapes, globe intro | PRD TRIP-6; [`atlas-v1.md`](../atlas-v1.md) |

A second review on 26 Sep 2026 reconciled the PRD and technical design (account deletion, soft delete with restore, exact-host provider labels, import never pins, contrast and focus rules); see the design review in [technical-design-design-phase.md](technical-design-design-phase.md). Open decisions: keep the forest accent; approve import into an existing trip (TRIP-7 is marked proposed); choose between an owner-entered exchange rate and live rates for conversion.

## Prototype limits

Sample data only, held in memory and lost on refresh. Land is a hand-drawn coarse outline for demonstration, not the Natural Earth asset. Money is summed with floating-point for the sample only. Sign-in, sharing and deletion are stand-ins with no real accounts. The Figma file has not been updated.
