import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * The site's icons (src/app) are public: a browser tab, a phone's home screen and, through the connector's serverInfo, the
 * ChatGPT and Claude apps all fetch them without signing in. A very large icon has made ChatGPT refuse an MCP server, so
 * each file is checked for what it claims to be and for staying small.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 8 * 1024;

const isPng = (b: Buffer) => b.subarray(0, 8).equals(PNG_SIGNATURE);
const pngSize = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

describe("the site's icons", () => {
  it("icon.png is a 128 px PNG, the size the connector's serverInfo declares", () => {
    const icon = readFileSync("src/app/icon.png");
    expect(isPng(icon)).toBe(true);
    expect(pngSize(icon)).toEqual({ width: 128, height: 128 });
    expect(icon.length).toBeLessThan(MAX_BYTES);
  });

  it("apple-icon.png is a 180 px PNG", () => {
    const icon = readFileSync("src/app/apple-icon.png");
    expect(isPng(icon)).toBe(true);
    expect(pngSize(icon)).toEqual({ width: 180, height: 180 });
    expect(icon.length).toBeLessThan(MAX_BYTES);
  });

  it("favicon.ico holds the 16, 32 and 48 px images, each a PNG", () => {
    const ico = readFileSync("src/app/favicon.ico");
    expect(ico.length).toBeLessThan(MAX_BYTES);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]); // reserved, and "icon" (not cursor)
    const count = ico.readUInt16LE(4);
    const entries = Array.from({ length: count }, (_, i) => {
      const at = 6 + 16 * i;
      const size = ico.readUInt32LE(at + 8);
      const offset = ico.readUInt32LE(at + 12);
      return { width: ico.readUInt8(at), height: ico.readUInt8(at + 1), image: ico.subarray(offset, offset + size), size, offset };
    });
    expect(entries.map((e) => e.width)).toEqual([16, 32, 48]);
    for (const e of entries) {
      expect(e.offset + e.size).toBeLessThanOrEqual(ico.length);
      expect(isPng(e.image)).toBe(true);
      expect(pngSize(e.image)).toEqual({ width: e.width, height: e.height });
    }
  });
});
