import { inject } from "vitest";

process.env.DATABASE_URL = inject("databaseUrl");
process.env.TRIP_OWNER_EMAILS = "owner@example.com, second-owner@example.com";
process.env.APP_ORIGIN = "http://localhost:3000";
