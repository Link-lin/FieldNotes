import { describe, expect, it } from "vitest";
import { commonZones, gmt, zoneLabel } from "@/components/zones";

const JAN = new Date("2026-01-15T12:00:00Z");
const JUL = new Date("2026-07-15T12:00:00Z");

describe("time-zone choices", () => {
  it("labels zones by offset and well-known places", () => {
    expect(zoneLabel("Asia/Tokyo", JAN)).toBe("GMT+9 · Tokyo, Osaka");
    expect(zoneLabel("America/Los_Angeles", JUL)).toBe("GMT-7 · Los Angeles, Vancouver");
    expect(zoneLabel("America/Argentina/Ushuaia", JAN)).toBe("GMT-3 · Ushuaia, Argentina");
    expect(gmt("Asia/Kolkata", JAN)).toBe("GMT+5:30");
    expect(gmt("Europe/London", JAN)).toBe("GMT");
  });
  it("keeps the short list short and ordered west to east", () => {
    const list = commonZones(JUL);
    expect(list.length).toBeLessThan(65);
    const gmtMinus7 = list.filter((z) => z.label.startsWith("GMT-7 "));
    expect(gmtMinus7.map((z) => z.id)).toEqual(["America/Los_Angeles", "America/Phoenix"]);
    expect(list[0]!.id).toBe("Pacific/Pago_Pago");
    expect(list.at(-1)!.id).toBe("Pacific/Tongatapu");
  });
});
