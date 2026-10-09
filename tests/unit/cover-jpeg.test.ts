import { describe, expect, it } from "vitest";
import { cleanJpeg } from "@/server/modules/covers/jpeg";

// JPEG segments built by hand: the walk reads markers and lengths, never the coded image itself.
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const seg = (code: number, body: number[] = []) => [0xff, code, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
const jfif = (thumb = 0) => seg(0xe0, [...ascii("JFIF\0"), 1, 2, 0, 0, 1, 0, 1, thumb, thumb, ...Array<number>(3 * thumb * thumb).fill(7)]);
const frame = (width: number, height: number, code = 0xc0, precision = 8) => seg(code, [precision, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const dqt = seg(0xdb, [0, ...Array<number>(64).fill(1)]);
const dht = seg(0xc4, [0, ...Array<number>(16).fill(0)]);
const sos = seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
// Coded data with a stuffed 0xFF and a restart marker inside it.
const data = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];
const exif = seg(0xe1, [...ascii("Exif\0\0"), ...ascii("GPS 37.7749 N 122.4194 W")]);
const xmp = seg(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/\0"), ...ascii("<x:xmpmeta/>")]);
const icc = seg(0xe2, [...ascii("ICC_PROFILE\0"), 1, 1, ...ascii("Camera profile")]);
const iptc = seg(0xed, [...ascii("Photoshop 3.0\0"), ...ascii("Caption: home")]);
const comment = seg(0xfe, ascii("Shot on a phone"));
const adobe = seg(0xee, [...ascii("Adobe"), 0, 100, 0, 0, 0, 0, 1]);
const jpeg = (...parts: number[][]) => Uint8Array.from([0xff, 0xd8, ...parts.flat(), 0xff, 0xd9]);
const has = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text));

describe("cleanJpeg", () => {
  it("reads the size from the frame and keeps what decoding needs", () => {
    const input = jpeg(jfif(), dqt, frame(1067, 1600), dht, sos, data);
    const out = cleanJpeg(input)!;
    expect(out).toMatchObject({ width: 1067, height: 1600 });
    expect(Buffer.from(out.bytes)).toEqual(Buffer.from(input));
  });

  it("drops EXIF, XMP, ICC, IPTC, comments and the JFIF thumbnail", () => {
    const out = cleanJpeg(jpeg(jfif(2), exif, xmp, icc, iptc, comment, dqt, frame(800, 600), dht, sos, data))!;
    for (const text of ["Exif", "GPS", "xmpmeta", "ICC_PROFILE", "Photoshop", "Shot on"]) expect(has(out.bytes, text)).toBe(false);
    expect(Buffer.from(out.bytes)).toEqual(Buffer.from(jpeg(jfif(0), dqt, frame(800, 600), dht, sos, data)));
  });

  it("keeps Adobe's colour-transform marker and drops a JFIF extension thumbnail", () => {
    const jfxx = seg(0xe0, [...ascii("JFXX\0"), 0x10, ...Array<number>(20).fill(9)]);
    const out = cleanJpeg(jpeg(jfif(), jfxx, adobe, dqt, frame(10, 10), dht, sos, data))!;
    expect(has(out.bytes, "JFXX")).toBe(false);
    expect(has(out.bytes, "Adobe")).toBe(true);
  });

  it("follows progressive scans with segments between them and drops what follows the end marker", () => {
    const input = Uint8Array.from([...jpeg(jfif(), dqt, frame(64, 48, 0xc2), dht, sos, data, dht, comment, sos, data), ...ascii("a video after the picture")]);
    const out = cleanJpeg(input)!;
    expect(out).toMatchObject({ width: 64, height: 48 });
    expect(Buffer.from(out.bytes)).toEqual(Buffer.from(jpeg(jfif(), dqt, frame(64, 48, 0xc2), dht, sos, data, dht, sos, data)));
  });

  it("accepts fill bytes before a marker", () => {
    expect(cleanJpeg(jpeg(jfif(), dqt, frame(10, 10, 0xc1), dht, sos, [...data, 0xff, 0xff]))).toMatchObject({ width: 10, height: 10 });
  });

  it.each([
    ["a PNG", Uint8Array.from([0x89, ...ascii("PNG\r\n\x1a\n"), 0, 0, 0, 13])],
    ["one cut short", jpeg(jfif(), dqt, frame(10, 10), dht, sos, data).subarray(0, 60)],
    ["one without an end marker", Uint8Array.from([0xff, 0xd8, ...frame(10, 10), ...dht, ...sos, ...data])],
    ["one without a frame", jpeg(jfif(), dqt, dht, sos, data)],
    ["one without a scan", jpeg(jfif(), dqt, frame(10, 10), dht)],
    ["one with two frames", jpeg(frame(10, 10), frame(10, 10), dht, sos, data)],
    ["a lossless one", jpeg(frame(10, 10, 0xc3), dht, sos, data)],
    ["an arithmetic-coded one", jpeg(frame(10, 10, 0xc9), sos, data)],
    ["one with 12-bit samples", jpeg(frame(10, 10, 0xc1, 12), dht, sos, data)],
    ["one with no height", jpeg(frame(10, 0), dht, sos, data)],
    ["a segment longer than the file", Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x10, 0x00, 1, 2, 3])],
    ["a restart marker outside a scan", jpeg([0xff, 0xd0], frame(10, 10), dht, sos, data)],
  ])("refuses %s", (_, input) => {
    expect(cleanJpeg(input)).toBeNull();
  });
});
