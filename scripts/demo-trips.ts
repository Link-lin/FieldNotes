/**
 * Test data for local development: a detailed Hawaii trip that exercises every trip-page,
 * dashboard, booking, cost, map and sharing state, plus two small trips for the dashboard
 * filters. Dates are relative to "today" so due and overdue states stay meaningful whenever
 * the seed is re-run. Every event goes through the same validation and column rules as the
 * app (itemInputSchema, scheduleErrors, toValues), so the data is always something the app
 * could have written. Never run this against production.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Kysely } from "kysely";
import type { DB } from "@/server/core/db/schema";
import { saveCover, type StoredCover } from "@/server/modules/covers/cover.repository";
import { cleanJpeg } from "@/server/modules/covers/jpeg";
import { hashInvitationToken, newInvitationToken } from "@/server/modules/invitations/invitations.rules";
import { insertItem } from "@/server/modules/items/items.repository";
import { scheduleErrors, toValues } from "@/server/modules/items/items.rules";
import { matchDestination } from "@/server/modules/places/catalog";
import { deleteTripRow, insertTrip } from "@/server/modules/trips/trips.repository";
import { itemInputSchema, toFieldErrors } from "@/shared/schemas";
import { addDays, dateInZone } from "@/shared/time";

export const HAWAII_TITLE = "Hawaii test trip: Oʻahu, Maui & the Big Island";
export const LISBON_TITLE = "Lisbon & Porto (test, no events yet)";
export const KAUAI_TITLE = "Kauaʻi long weekend (test, happening now)";
export const KYOTO_TITLE = "Kyoto long weekend (test, shared with you)";
export const OSAKA_TITLE = "Osaka street food (test, you can edit)";
export const SEOUL_TITLE = "Seoul weekend (test, you co-own)";
/** A made-up person who owns the shared Kyoto trip and is an accepted viewer of Hawaii. */
export const TEST_FRIEND = { email: "sam.rivera@example.com", name: "Sam Rivera (test)" };

const HAWAII_ZONE = "Pacific/Honolulu";

type Money = { amount: string; currency: string };
type Price = Money & { label: "estimate" | "quote" };
type Endpoint = { airportCode: string | null; localDateTime: string | null; timeZone: string | null };

type Common = {
  title: string;
  location?: string;
  notes?: string;
  links?: Array<{ label: string; url: string }>;
  mapUrl?: string;
  bookingStatus: "not_required" | "needs_booking" | "booked";
  bookingDueDate?: string;
  price?: Price;
  /** Imported from an AI response: source "ai", and its price stays an unverified AI estimate. */
  ai?: boolean;
  /** An AI price the owner has confirmed (BUDGET-4): source stays "ai", price becomes the owner's. */
  priceConfirmed?: boolean;
  /** An AI draft the owner has marked reviewed (IMPORT-7): no draft tag, and a flight gets its arrival-airport pin. */
  reviewed?: boolean;
};
type EventSpec = Common & {
  type: "lodging" | "transport" | "meal" | "activity" | "other";
  date?: string;
  time?: string;
  timeZone?: string;
  durationMinutes?: number;
};
type FlightSpec = Common & {
  type: "flight";
  plannedDepartureDate?: string;
  airline?: string;
  flightNumber?: string;
  departure: Endpoint;
  arrival: Endpoint;
};
type ItemSpec = EventSpec | FlightSpec;

type Role = "viewer" | "editor" | "owner";
/** A person the trip is shared with, and what they may do (viewer unless stated). */
type Viewer =
  | { kind: "accepted-friend"; role?: Role }
  | { kind: "accepted-you"; role?: Role }
  | { kind: "pending" | "expired" | "revoked"; email: string; role?: Role }
  /** An invitation by link, with the label its owner gave it and no address. */
  | { kind: "link"; label: string; role?: Role };

export type TripSpec = {
  owner: "you" | "friend";
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  budget: Money | null;
  /** Owner-set globe point; otherwise the catalog is matched as the app does. */
  ownerPoint?: { latitude: number; longitude: number };
  /** A cover (DASH-8) from `scripts/demo-covers`: original abstract pictures, made for these test trips. */
  cover?: "hawaii" | "kyoto";
  items: ItemSpec[];
  viewers: Viewer[];
};

const usd = (amount: string, label: Price["label"] = "quote"): Price => ({ amount, currency: "USD", label });
const flightEnd = (airportCode: string | null, localDateTime: string | null = null, timeZone: string | null = null): Endpoint => ({ airportCode, localDateTime, timeZone });

/** The three test trips, with dates relative to `today` (YYYY-MM-DD in Hawaii). */
export function demoTrips(today: string): TripSpec[] {
  const s = addDays(today, 21); // Hawaii starts three weeks out
  const d = (n: number) => addDays(s, n);
  const dt = (n: number, time: string) => `${d(n)}T${time}`;
  const due = (n: number) => addDays(today, n); // book-by dates relative to today

  const hawaii: TripSpec = {
    owner: "you",
    title: HAWAII_TITLE,
    destination: "Hawaiʻi (Oʻahu, Maui, Big Island)",
    startDate: s,
    endDate: d(7),
    timeZone: HAWAII_ZONE,
    budget: { amount: "7500", currency: "USD" },
    ownerPoint: { latitude: 20.8, longitude: -156.33 },
    cover: "hawaii",
    viewers: [
      { kind: "accepted-friend", role: "editor" },
      { kind: "pending", email: "jordan.test@example.com", role: "owner" },
      { kind: "expired", email: "casey.test@example.com", role: "editor" },
      { kind: "revoked", email: "morgan.test@example.com" },
      { kind: "link", label: "Mei, on WeChat (test)" },
    ],
    items: [
      // Before the trip: shows in an "Outside trip dates" tab; overdue booking task.
      {
        type: "transport",
        title: "Airport parking at SFO (long-term lot)",
        location: "SFO Long Term Parking, San Bruno, CA",
        date: d(-1),
        time: "20:00",
        timeZone: "America/Los_Angeles",
        bookingStatus: "needs_booking",
        bookingDueDate: due(-3),
        price: usd("152.00", "estimate"),
        notes: "Pre-book online; drive-up rate is almost double.",
      },

      // Day 1 — arrive on Oʻahu.
      {
        type: "flight",
        title: "SFO → HNL",
        airline: "Hawaiian Airlines",
        flightNumber: "HA 11",
        departure: flightEnd("SFO", dt(0, "08:05"), "America/Los_Angeles"),
        arrival: flightEnd("HNL", dt(0, "10:45"), HAWAII_ZONE),
        bookingStatus: "booked",
        price: usd("489.20"),
        links: [{ label: "Manage booking", url: "https://www.hawaiianairlines.com/manage-trips" }],
        notes: "Seats 23A and 23B. One checked bag each is included.",
      },
      {
        type: "transport",
        title: "Pick up rental car",
        location: "Daniel K. Inouye International Airport, Honolulu",
        date: d(0),
        time: "11:30",
        durationMinutes: 45,
        bookingStatus: "booked",
        price: usd("312.75"),
      },
      {
        type: "lodging",
        title: "Check in: Outrigger Reef Waikiki (4 nights)",
        location: "2169 Kalia Rd, Honolulu, HI 96815",
        // Google place link with @lat,lon and tracking parameters that are stripped on save.
        mapUrl: "https://www.google.com/maps/place/Outrigger+Reef+Waikiki+Beach+Resort/@21.27825,-157.83295,17z?entry=ttu&g_ep=EgoyMDI2",
        date: d(0),
        time: "15:00",
        bookingStatus: "booked",
        price: usd("1896.48"),
        links: [
          { label: "Reservation", url: "https://www.outrigger.com/hawaii/oahu/outrigger-reef-waikiki-beach-resort" },
          { label: "Parking info", url: "https://www.outrigger.com/hawaii/oahu/outrigger-reef-waikiki-beach-resort/amenities" },
        ],
      },
      {
        type: "meal",
        title: "Sunset dinner at Duke's Waikiki",
        location: "Duke's Waikiki, 2335 Kalākaua Ave, Honolulu",
        mapUrl: "21.27670, -157.82780", // with the HNL arrival and the hotel: a three-stop road route
        date: d(0),
        time: "18:30",
        durationMinutes: 90,
        bookingStatus: "needs_booking",
        bookingDueDate: due(0), // due today
        price: usd("140.00", "estimate"),
      },

      // Day 2 — history and a hike. Pearl Harbor is pinned from pasted coordinates.
      {
        type: "activity",
        title: "Pearl Harbor: USS Arizona Memorial",
        location: "Pearl Harbor National Memorial, Honolulu",
        mapUrl: "21.36490, -157.93990",
        date: d(1),
        time: "07:30",
        durationMinutes: 180,
        bookingStatus: "needs_booking",
        bookingDueDate: due(-1), // overdue
        price: usd("1.00"),
        notes: "Timed tickets are released 8 weeks ahead and again the day before at 3 pm HST.",
        links: [{ label: "Recreation.gov tickets", url: "https://www.recreation.gov/ticket/facility/233338" }],
      },
      {
        type: "activity",
        title: "Diamond Head summit hike",
        location: "Diamond Head State Monument",
        // OpenStreetMap marker link.
        mapUrl: "https://www.openstreetmap.org/?mlat=21.26200&mlon=-157.80600#map=15/21.26200/-157.80600",
        date: d(1),
        time: "13:00",
        durationMinutes: 120,
        bookingStatus: "needs_booking",
        bookingDueDate: due(2), // due soon
        price: usd("10.00"),
      },
      {
        type: "meal",
        title: "Garlic shrimp at Giovanni's",
        location: "Giovanni's Shrimp Truck, Kahuku",
        date: d(1),
        time: "17:00",
        bookingStatus: "not_required",
        price: usd("32", "estimate"),
        ai: true,
        reviewed: true, // an AI draft the owner has checked: no draft tag, the price still an AI estimate
      },

      // Day 3 — snorkel, North Shore, luau. Two events share 07:30 to check ordering.
      {
        type: "activity",
        title: "Snorkel Hanauma Bay",
        location: "Hanauma Bay Nature Preserve",
        // Apple Maps link with ll=.
        mapUrl: "https://maps.apple.com/?ll=21.26900,-157.69380&q=Hanauma%20Bay",
        date: d(2),
        time: "07:30",
        durationMinutes: 180,
        bookingStatus: "needs_booking",
        bookingDueDate: due(10), // later
        price: usd("25.00"),
      },
      {
        type: "other",
        title: "Pack reef-safe sunscreen and snorkel gear",
        date: d(2),
        time: "07:30",
        bookingStatus: "not_required",
      },
      {
        type: "activity",
        title: "North Shore beaches and turtles",
        location: "Laniākea Beach, Haleʻiwa",
        date: d(2), // date only: listed under Unscheduled
        bookingStatus: "not_required",
        ai: true,
        notes: "Keep 3 m from the turtles. Matsumoto Shave Ice is in Haleʻiwa town on the way back.",
      },
      {
        type: "activity",
        title: "Paradise Cove Luau",
        location: "Paradise Cove, Kapolei",
        // Google data link with !3d…!4d….
        mapUrl: "https://www.google.com/maps/place/Paradise+Cove+Luau/data=!4m6!3m5!1s0x0:0x0!8m2!3d21.34860!4d-158.12700",
        date: d(2),
        time: "17:00",
        durationMinutes: 210,
        bookingStatus: "needs_booking", // no book-by date
        price: usd("398.00"),
      },
      {
        type: "meal",
        title: "Mai tais back at Duke's",
        location: "Duke's Waikiki, 2335 Kalākaua Ave, Honolulu",
        mapUrl: "21.27670, -157.82780", // a return visit: the same point as day 1's dinner, so Whole trip shares one marker
        date: d(2),
        time: "21:30",
        bookingStatus: "not_required",
        ai: true,
      },

      // Day 4 — hop to Maui: fully scheduled but not booked yet, so its booking task offers Mark booked.
      {
        type: "flight",
        title: "HNL → OGG",
        airline: "Hawaiian Airlines",
        flightNumber: "HA 142",
        departure: flightEnd("HNL", dt(3, "09:10"), HAWAII_ZONE),
        arrival: flightEnd("OGG", dt(3, "09:52"), HAWAII_ZONE),
        bookingStatus: "needs_booking",
        bookingDueDate: due(4),
        price: usd("89.00"),
      },
      {
        type: "transport",
        title: "Maui rental car",
        location: "Kahului Airport (OGG) rental car center",
        mapUrl: "https://www.google.com/maps/@20.89300,-156.43900,17z", // OGG arrival, rental car, hotel: three stops
        date: d(3),
        time: "10:30",
        bookingStatus: "needs_booking",
        bookingDueDate: due(5),
        price: usd("264.00", "estimate"),
      },
      {
        type: "lodging",
        title: "Check in: Hotel Wailea (3 nights)",
        location: "555 Kaukahi St, Wailea, HI 96753",
        // Google Maps search link as saved from pasted coordinates.
        mapUrl: "https://www.google.com/maps/search/?api=1&query=20.68860%2C-156.44260",
        date: d(3),
        time: "15:00",
        bookingStatus: "booked",
        price: usd("1587.30"),
      },
      {
        type: "meal",
        title: "Ululani's shave ice",
        location: "Ululani's Hawaiian Shave Ice, Kīhei",
        // A look-alike host: labeled by its real host and never pinned.
        mapUrl: "https://maps.google.com.example.net/place/ululanis-kihei",
        date: d(3),
        time: "16:00",
        bookingStatus: "not_required",
        price: usd("12.50"),
      },

      // Day 5 — Road to Hāna (date only, many links, long notes) and a call in another zone.
      {
        type: "activity",
        title: "Road to Hāna",
        location: "Hāna Highway, Maui",
        date: d(4),
        bookingStatus: "not_required",
        ai: true,
        notes: [
          "Leave Wailea by 6:30 am to beat the tour vans; fill the tank in Pāʻia, the last reliable gas.",
          "",
          "Stops, in order: Twin Falls (mile 2), Garden of Eden arboretum (mile 10, entry fee), Keʻanae Peninsula (mile 16), Wailua Falls (mile 45), then the black sand beach at Waiʻānapanapa State Park (reservation needed, see link).",
          "",
          "Download offline maps first: there is no signal for most of the road. Turn back by 3 pm so the drive home isn't in the dark. Pull over to let locals pass.",
        ].join("\n"),
        links: [
          { label: "Waiʻānapanapa reservations", url: "https://gostateparks.hawaii.gov/waianapanapa" },
          { label: "Mile-by-mile guide", url: "https://www.gohawaii.com/islands/maui/regions/east-maui/hana-highway" },
          { label: "Road conditions", url: "https://hidot.hawaii.gov/highways/" },
          { label: "Garden of Eden", url: "https://www.mauigardenofeden.com/" },
          { label: "Twin Falls", url: "https://www.twinfallsmaui.net/" },
        ],
      },
      {
        type: "meal",
        title: "Picnic at Twin Falls",
        location: "Twin Falls, Haʻikū",
        date: d(4),
        time: "08:00",
        bookingStatus: "not_required",
        price: usd("0.00"), // free: a zero amount
      },
      {
        type: "other",
        title: "Team check-in call (California time)",
        date: d(4),
        time: "14:00",
        timeZone: "America/Los_Angeles", // an explicit event zone, not the trip's
        durationMinutes: 30,
        bookingStatus: "not_required",
      },
      {
        type: "meal",
        title: "Dinner at Mama's Fish House",
        location: "Mama's Fish House, 799 Poho Pl, Pāʻia",
        mapUrl: "https://www.google.com/maps/place/Mama's+Fish+House/@20.93980,-156.36900,17z",
        date: d(4),
        time: "18:30",
        bookingStatus: "booked",
        price: usd("265.00", "estimate"),
        ai: true,
        priceConfirmed: true, // AI price the owner confirmed: not "unverified"
      },

      // Day 6 — sunrise, a shortened link, and a long title.
      {
        type: "activity",
        title: "Haleakalā sunrise",
        location: "Haleakalā National Park summit",
        mapUrl: "https://www.google.com/maps/@20.70970,-156.25330,14z",
        date: d(5),
        time: "03:00",
        durationMinutes: 240,
        bookingStatus: "needs_booking",
        bookingDueDate: due(-5), // well overdue
        price: usd("1.00"),
        notes: "Sunrise reservation per car, plus the $30 park entry. It's near freezing at the top: bring jackets.",
      },
      {
        type: "activity",
        title: "Molokini Crater snorkel",
        location: "Māʻalaea Harbor",
        // Shortened share link: labeled Google Maps but never pinned.
        mapUrl: "https://maps.app.goo.gl/AbCdEfGh12345",
        date: d(5),
        time: "10:30",
        durationMinutes: 300,
        bookingStatus: "needs_booking",
        price: usd("189", "estimate"),
        ai: true,
      },
      {
        type: "activity",
        title: "Sunset catamaran sail from Kāʻanapali Beach with a snorkel stop, live music and dinner, a deliberately long title that must wrap cleanly on phones",
        location: "Kāʻanapali Beach",
        date: d(5),
        time: "16:30",
        durationMinutes: 150,
        bookingStatus: "needs_booking",
        bookingDueDate: due(7),
        price: usd("145.00", "estimate"),
        ai: true,
      },

      // Day 7 — on to the Big Island: a flight placeholder (planned date only).
      {
        type: "flight",
        title: "OGG → KOA",
        plannedDepartureDate: d(6),
        departure: flightEnd("OGG"),
        arrival: flightEnd("KOA"),
        bookingStatus: "needs_booking",
        bookingDueDate: due(1),
        price: usd("120", "estimate"),
        ai: true,
        reviewed: true, // a reviewed AI flight placeholder: pinned at its arrival airport
      },
      {
        type: "lodging",
        title: "Volcano House (1 night)",
        location: "1 Crater Rim Dr, Hawaiʻi Volcanoes National Park",
        date: d(6),
        time: "16:00",
        bookingStatus: "needs_booking",
        bookingDueDate: due(3),
        price: usd("389.00", "estimate"),
      },
      {
        type: "activity",
        title: "Hawaiʻi Volcanoes National Park",
        location: "Kīlauea Visitor Center",
        mapUrl: "https://www.google.com/maps/place/Kilauea+Visitor+Center/@19.41940,-155.28850,15z",
        date: d(6),
        bookingStatus: "not_required",
        price: usd("30.00"),
        notes: "Crater Rim Drive after dark if the lava lake is glowing; check the USGS update that morning.",
        links: [{ label: "USGS Kīlauea updates", url: "https://www.usgs.gov/volcanoes/kilauea" }],
      },

      // Day 8 — home on a red-eye that lands the next day in another zone.
      {
        type: "flight",
        title: "KOA → SFO (red-eye)",
        airline: "United Airlines",
        flightNumber: "UA 1738",
        departure: flightEnd("KOA", dt(7, "22:15"), HAWAII_ZONE),
        arrival: flightEnd("SFO", dt(8, "06:10"), "America/Los_Angeles"),
        bookingStatus: "booked",
        price: usd("356.40"),
      },

      // No date at all.
      {
        type: "flight",
        title: "Backup inter-island hop if plans change",
        departure: flightEnd(null),
        arrival: flightEnd(null),
        bookingStatus: "needs_booking", // Undated flights, no airports yet ("Airports not set"); no book-by date
      },
      {
        type: "other",
        title: "Travel insurance",
        bookingStatus: "booked",
        price: usd("189.00"),
        links: [{ label: "Policy PDF", url: "https://example.com/policies/test-policy.pdf" }],
      },
      {
        type: "other",
        title: "Travel eSIM (priced in euros)",
        bookingStatus: "booked",
        price: { amount: "14.50", currency: "EUR", label: "quote" }, // a second currency, never added to USD
      },
      {
        type: "other",
        title: "Buy reef-safe sunscreen",
        bookingStatus: "not_required",
      },
    ],
  };

  const k = addDays(today, -40);
  const kd = (n: number) => addDays(k, n);
  const kyoto: TripSpec = {
    owner: "friend",
    title: KYOTO_TITLE,
    destination: "Kyoto, Japan", // matches the bundled catalog: globe point from the catalog
    cover: "kyoto",
    startDate: k,
    endDate: kd(3),
    timeZone: "Asia/Tokyo",
    budget: { amount: "250000", currency: "JPY" },
    viewers: [{ kind: "accepted-you" }],
    items: [
      {
        type: "flight",
        title: "SFO → KIX",
        airline: "Japan Airlines",
        flightNumber: "JL 1",
        departure: flightEnd("SFO", `${addDays(k, -1)}T11:00`, "America/Los_Angeles"),
        arrival: flightEnd("KIX", `${k}T15:10`, "Asia/Tokyo"),
        bookingStatus: "booked",
        price: usd("1120.00"),
      },
      {
        type: "lodging",
        title: "Ryokan Yachiyo (3 nights)",
        location: "34 Fukuchi-cho, Nanzen-ji, Sakyo-ku, Kyoto",
        mapUrl: "https://www.google.com/maps/place/Ryokan+Yachiyo/@35.01120,135.78960,17z",
        date: k,
        time: "16:00",
        bookingStatus: "booked",
        price: { amount: "168000", currency: "JPY", label: "quote" },
      },
      {
        type: "activity",
        title: "Fushimi Inari at sunrise",
        location: "Fushimi Inari Taisha, Kyoto",
        mapUrl: "34.96710, 135.77270",
        date: kd(1),
        time: "06:00",
        durationMinutes: 150,
        bookingStatus: "not_required",
        notes: "Go past the Yotsutsuji intersection for the view; most people turn back before it.",
      },
      {
        type: "meal",
        title: "Kaiseki dinner at Gion Karyo",
        location: "Gion Karyo, Higashiyama-ku, Kyoto",
        date: kd(2),
        time: "18:00",
        bookingStatus: "booked",
        price: { amount: "95000", currency: "JPY", label: "quote" }, // pushes the JPY total over budget
      },
      {
        type: "activity",
        title: "Arashiyama bamboo grove",
        location: "Arashiyama, Kyoto",
        date: kd(2),
        bookingStatus: "not_required",
        ai: true,
      },
    ],
  };

  const lisbon: TripSpec = {
    owner: "you",
    title: LISBON_TITLE,
    destination: "Lisbon and Porto", // no catalog match: not on the globe until you set a point
    startDate: addDays(today, 200),
    endDate: addDays(today, 206),
    timeZone: "Europe/Lisbon",
    budget: { amount: "3000", currency: "EUR" },
    viewers: [{ kind: "accepted-friend", role: "owner" }], // a co-owner, so deleting your account shows a trip that stays with another owner
    items: [],
  };

  // Happening now (yesterday to tomorrow): the Travelling now tile and ticket, and Up next during a trip.
  const kd0 = (n: number) => addDays(today, n);
  const kauai: TripSpec = {
    owner: "you",
    title: KAUAI_TITLE,
    destination: "Kauaʻi, Hawaiʻi",
    startDate: kd0(-1),
    endDate: kd0(1),
    timeZone: HAWAII_ZONE,
    budget: null,
    ownerPoint: { latitude: 22.07, longitude: -159.5 },
    viewers: [],
    items: [
      {
        type: "transport",
        title: "Pick up the rental jeep",
        location: "Līhuʻe Airport (LIH)",
        date: kd0(-1),
        time: "14:00",
        bookingStatus: "booked",
        price: usd("210.00"),
      },
      {
        type: "activity",
        title: "Kalalau Lookout at sunrise",
        location: "Kalalau Lookout, Kōkeʻe State Park",
        mapUrl: "22.15140, -159.64670",
        date: kd0(0),
        time: "06:30",
        durationMinutes: 90,
        bookingStatus: "not_required",
      },
      {
        type: "meal",
        title: "Dinner at Hanalei Dolphin",
        location: "Hanalei Dolphin, Hanalei",
        date: kd0(0),
        time: "18:00",
        bookingStatus: "needs_booking",
        bookingDueDate: kd0(0),
        price: usd("120", "estimate"),
      },
      {
        type: "activity",
        title: "Hanalei Bay beach morning",
        location: "Hanalei Bay",
        date: kd0(1), // date only: Up next can show it once today is over
        bookingStatus: "not_required",
      },
      {
        type: "flight",
        title: "LIH → HNL",
        airline: "Hawaiian Airlines",
        flightNumber: "HA 294",
        departure: flightEnd("LIH", `${kd0(1)}T15:10`, HAWAII_ZONE),
        arrival: flightEnd("HNL", `${kd0(1)}T15:50`, HAWAII_ZONE),
        bookingStatus: "booked",
        price: usd("79.00"),
      },
    ],
  };

  // Trips someone else created where you are an editor and a co-owner, so every role can be tried.
  const osaka: TripSpec = {
    owner: "friend",
    title: OSAKA_TITLE,
    destination: "Osaka, Japan",
    startDate: addDays(today, 60),
    endDate: addDays(today, 62),
    timeZone: "Asia/Tokyo",
    budget: null,
    viewers: [{ kind: "accepted-you", role: "editor" }],
    items: [
      { type: "meal", title: "Takoyaki in Dotonbori", location: "Dotonbori, Osaka", mapUrl: "34.66870, 135.50130", date: addDays(today, 60), time: "19:00", bookingStatus: "needs_booking", bookingDueDate: addDays(today, 30), price: { amount: "2500", currency: "JPY", label: "estimate" } },
      { type: "activity", title: "Osaka Castle morning", location: "Osaka Castle", date: addDays(today, 61), bookingStatus: "not_required" },
      { type: "other", title: "Buy an ICOCA card", bookingStatus: "not_required" },
    ],
  };
  const seoul: TripSpec = {
    owner: "friend",
    title: SEOUL_TITLE,
    destination: "Seoul, South Korea",
    startDate: addDays(today, 90),
    endDate: addDays(today, 92),
    timeZone: "Asia/Seoul",
    budget: { amount: "900000", currency: "KRW" },
    viewers: [{ kind: "accepted-you", role: "owner" }],
    items: [
      { type: "lodging", title: "Hanok stay in Bukchon", location: "Bukchon Hanok Village, Seoul", date: addDays(today, 90), time: "15:00", bookingStatus: "needs_booking", price: { amount: "380000", currency: "KRW", label: "quote" } },
      { type: "meal", title: "Korean BBQ in Mapo", location: "Mapo-gu, Seoul", date: addDays(today, 91), time: "19:30", bookingStatus: "not_required" },
    ],
  };

  return [hawaii, kyoto, lisbon, kauai, osaka, seoul];
}

function toInput(spec: ItemSpec): unknown {
  const common = {
    title: spec.title,
    location: spec.location ?? null,
    notes: spec.notes ?? null,
    links: spec.links ?? [],
    mapUrl: spec.mapUrl ?? null,
    bookingStatus: spec.bookingStatus,
    bookingDueDate: spec.bookingDueDate ?? null,
    plannedPrice: spec.price ?? null,
  };
  if (spec.type === "flight") {
    const end = (e: Endpoint) => ({ ...e, timeDisambiguation: null });
    return {
      type: "flight",
      plannedDepartureDate: spec.plannedDepartureDate ?? null,
      airline: spec.airline ?? null,
      flightNumber: spec.flightNumber ?? null,
      departure: end(spec.departure),
      arrival: end(spec.arrival),
      ...common,
    };
  }
  return {
    type: spec.type,
    localDate: spec.date ?? null,
    localTime: spec.time ?? null,
    timeZone: spec.timeZone ?? null,
    timeDisambiguation: null,
    durationMinutes: spec.durationMinutes ?? null,
    ...common,
  };
}

export type SeedResult = { trips: Array<{ id: string; title: string; items: number; viewers: number }> };

/** A test cover, checked and stored as an upload would be (DASH-8). */
function demoCover(name: NonNullable<TripSpec["cover"]>): StoredCover {
  const image = (size: "full" | "small") => {
    const img = cleanJpeg(readFileSync(new URL(`./demo-covers/${name}-${size}.jpg`, import.meta.url)));
    if (!img) throw new Error(`Test cover ${name}-${size}.jpg isn't a JPEG the app stores.`);
    return img;
  };
  const full = image("full");
  const small = image("small");
  return { hash: createHash("sha256").update(full.bytes).digest("hex"), width: full.width, height: full.height, full: full.bytes, small: small.bytes };
}

/**
 * Replaces the test trips: deletes your trips with the test titles and every trip owned by the
 * made-up friend, then inserts the three trips in one transaction. Nothing else is touched.
 */
export async function seedDemoTrips(db: Kysely<DB>, you: { id: string; email: string }, now = new Date()): Promise<SeedResult> {
  const today = dateInZone(HAWAII_ZONE, now.getTime());
  const specs = demoTrips(today);
  return db.transaction().execute(async (tx) => {
    const friendRow =
      (await tx.selectFrom("User").select("id").where("email", "=", TEST_FRIEND.email).executeTakeFirst()) ??
      (await tx.insertInto("User").values({ email: TEST_FRIEND.email, name: TEST_FRIEND.name, emailVerified: null, image: null }).returning("id").executeTakeFirstOrThrow());
    const friend = { id: friendRow.id, email: TEST_FRIEND.email };

    const old = await tx
      .selectFrom("trips")
      .select("id")
      .where((eb) => eb.or([eb.and([eb("owner_user_id", "=", you.id), eb("title", "in", [HAWAII_TITLE, LISBON_TITLE, KAUAI_TITLE])]), eb("owner_user_id", "=", friend.id)]))
      .execute();
    for (const t of old) await deleteTripRow(tx, t.id);

    const result: SeedResult = { trips: [] };
    for (const spec of specs) {
      const point = spec.ownerPoint ?? matchDestination(spec.destination);
      const trip = await insertTrip(tx, spec.owner === "you" ? you.id : friend.id, {
        title: spec.title,
        destination: spec.destination,
        start_date: spec.startDate,
        end_date: spec.endDate,
        time_zone: spec.timeZone,
        budget_amount: spec.budget?.amount ?? null,
        budget_currency: spec.budget?.currency ?? null,
        atlas_latitude: point ? String(point.latitude) : null,
        atlas_longitude: point ? String(point.longitude) : null,
        atlas_source: spec.ownerPoint ? "owner" : point ? "catalog" : null,
      });

      for (const item of spec.items) {
        const parsed = itemInputSchema.safeParse(toInput(item));
        if (!parsed.success) throw new Error(`Test event "${item.title}" is invalid: ${JSON.stringify(toFieldErrors(parsed.error))}`);
        const schedule = scheduleErrors(parsed.data, spec.timeZone);
        if (schedule.length) throw new Error(`Test event "${item.title}" has a schedule error: ${JSON.stringify(schedule)}`);
        const values = toValues(parsed.data, null);
        if ("path" in values) throw new Error(`Test event "${item.title}" is invalid: ${values.message}`);
        if (item.ai && values.price_source) values.price_source = item.priceConfirmed ? "owner" : "ai";
        if (item.ai && item.reviewed) values.reviewed_at = now;
        await insertItem(tx, trip.id, item.ai ? "ai" : "manual", values);
      }

      if (spec.cover && !(await saveCover(tx, trip.id, trip.version, demoCover(spec.cover)))) throw new Error(`Couldn't store the cover of "${spec.title}".`);

      for (const v of spec.viewers) {
        const base = { trip_id: trip.id, accepted_at: null, revoked_at: null, viewer_user_id: null };
        const days = (n: number) => new Date(now.getTime() + n * 864e5);
        const hash = () => hashInvitationToken(newInvitationToken());
        if (v.kind === "accepted-friend" || v.kind === "accepted-you") {
          const who = v.kind === "accepted-friend" ? friend : you;
          await tx.insertInto("trip_viewers").values({ ...base, role: v.role ?? "viewer", invitee_email_normalized: who.email.trim().toLowerCase(), viewer_user_id: who.id, status: "accepted", invitation_token_hash: hash(), expires_at: days(3), accepted_at: days(-4) }).execute();
        } else if (v.kind === "link") {
          await tx.insertInto("trip_viewers").values({ ...base, role: v.role ?? "viewer", label: v.label, status: "pending", invitation_token_hash: hash(), expires_at: days(5) }).execute();
        } else if (v.kind === "pending") {
          await tx.insertInto("trip_viewers").values({ ...base, role: v.role ?? "viewer", invitee_email_normalized: v.email, status: "pending", invitation_token_hash: hash(), expires_at: days(5) }).execute();
        } else if (v.kind === "expired") {
          await tx.insertInto("trip_viewers").values({ ...base, role: v.role ?? "viewer", invitee_email_normalized: v.email, status: "pending", invitation_token_hash: hash(), expires_at: days(-2) }).execute();
        } else {
          await tx.insertInto("trip_viewers").values({ ...base, role: v.role ?? "viewer", invitee_email_normalized: v.email, status: "revoked", invitation_token_hash: null, expires_at: days(-1), revoked_at: days(-1) }).execute();
        }
      }
      result.trips.push({ id: trip.id, title: spec.title, items: spec.items.length, viewers: spec.viewers.length });
    }
    return result;
  });
}
