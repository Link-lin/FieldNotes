import { describe, expect, it } from "vitest";
import { canonicalTimeZone, dateInZone, dueState, isDate, isLocalDateTime, isTimeZone, localCandidates, resolveLocal, tripStatus, dateRange, daysBetween } from "@/shared/time";

describe("calendar values", () => {
  it("accepts only real dates", () => {
    expect(isDate("2026-02-28")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2026-2-1")).toBe(false);
    expect(isLocalDateTime("2026-11-15T13:40")).toBe(true);
    expect(isLocalDateTime("2026-11-15T24:00")).toBe(false);
  });

  it("accepts IANA zones and rejects offsets or junk", () => {
    expect(isTimeZone("Asia/Tokyo")).toBe(true);
    expect(isTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("+05:00")).toBe(false);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
  });

  it("reads today in the trip zone, not the server zone", () => {
    const instant = Date.UTC(2026, 8, 26, 11, 30); // 26 Sep 11:30 UTC
    expect(dateInZone("Pacific/Auckland", instant)).toBe("2026-09-26");
    expect(dateInZone("Pacific/Kiritimati", instant)).toBe("2026-09-27");
    expect(dateInZone("Pacific/Pago_Pago", instant)).toBe("2026-09-26");
  });
});

describe("daylight-saving transitions", () => {
  it("finds no instant for a time in a spring-forward gap", () => {
    expect(localCandidates("2027-03-14", "02:30", "America/New_York")).toEqual([]);
    expect(resolveLocal("2027-03-14", "02:30", "America/New_York", "earlier")).toEqual({ ok: false, reason: "gap" });
  });

  it("finds two instants for a repeated time and requires a choice", () => {
    const c = localCandidates("2027-11-07", "01:30", "America/New_York");
    expect(c).toHaveLength(2);
    expect(c[1]! - c[0]!).toBe(3_600_000);
    expect(resolveLocal("2027-11-07", "01:30", "America/New_York", null)).toEqual({ ok: false, reason: "ambiguous" });
    const early = resolveLocal("2027-11-07", "01:30", "America/New_York", "earlier");
    const late = resolveLocal("2027-11-07", "01:30", "America/New_York", "later");
    expect(early.ok && new Date(early.epochMs).toISOString()).toBe("2027-11-07T05:30:00.000Z");
    expect(late.ok && new Date(late.epochMs).toISOString()).toBe("2027-11-07T06:30:00.000Z");
  });

  it("converts an ordinary local time using its zone", () => {
    const r = resolveLocal("2026-11-15", "13:40", "America/Los_Angeles", null);
    expect(r.ok && new Date(r.epochMs).toISOString()).toBe("2026-11-15T21:40:00.000Z");
    const t = resolveLocal("2026-11-16", "17:20", "Asia/Tokyo", null);
    expect(t.ok && new Date(t.epochMs).toISOString()).toBe("2026-11-16T08:20:00.000Z");
  });
});

describe("status and due dates", () => {
  it("treats the end date as inclusive", () => {
    expect(tripStatus("2026-09-22", "2026-09-29", "2026-09-21")).toBe("upcoming");
    expect(tripStatus("2026-09-22", "2026-09-29", "2026-09-29")).toBe("ongoing");
    expect(tripStatus("2026-09-22", "2026-09-29", "2026-09-30")).toBe("past");
  });
  it("is due on the date and overdue from the next local date", () => {
    expect(dueState("2026-10-05", "2026-10-04")).toBe("upcoming");
    expect(dueState("2026-10-05", "2026-10-05")).toBe("due_today");
    expect(dueState("2026-10-05", "2026-10-06")).toBe("overdue");
  });
  it("counts days across month ends", () => {
    expect(daysBetween("2026-09-26", "2026-11-15")).toBe(50);
    expect(dateRange("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});

describe("canonicalTimeZone", () => {
  it("fixes case and keeps valid aliases", () => {
    expect(canonicalTimeZone("asia/tokyo")).toBe("Asia/Tokyo");
    expect(canonicalTimeZone("utc")).toBe("UTC");
    expect(canonicalTimeZone("America/New_York")).toBe("America/New_York");
  });
});
