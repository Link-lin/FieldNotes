import "server-only";

/** A JPEG as `cleanJpeg` keeps it: without metadata, with its size in pixels from the frame header. */
export type CleanJpeg = { bytes: Buffer; width: number; height: number };

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP14 = 0xee;
// Frames browsers decode: baseline, extended sequential and progressive, all Huffman-coded.
const FRAMES = new Set([0xc0, 0xc1, 0xc2]);
// Every other frame: lossless, hierarchical and arithmetic-coded (0xc4 is DHT, 0xc8 reserved and 0xcc DAC).
const OTHER_FRAMES = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const isRestart = (code: number) => code >= 0xd0 && code <= 0xd7;
const startsWith = (body: Uint8Array, text: string) => body.length >= text.length && [...text].every((c, i) => body[i] === c.charCodeAt(0));

/**
 * The JFIF header without the thumbnail it may carry: identifier, version, units and densities, and a 0 × 0 thumbnail.
 * Null when it is too short to be one.
 */
function jfifHeader(body: Uint8Array): Uint8Array | null {
  if (body.length < 14) return null;
  return Uint8Array.from([0xff, APP0, 0x00, 0x10, ...body.subarray(0, 12), 0, 0]);
}

/**
 * DASH-8: checks that `input` is a JPEG browsers show (8-bit, Huffman-coded baseline, extended or progressive, one
 * frame, at least one scan, an end marker) and returns it without metadata. It keeps the segments decoding needs
 * (tables, restart interval, frame, scans), the JFIF header without its thumbnail and Adobe's colour-transform marker.
 * EXIF, XMP, IPTC, ICC profiles and every other application segment, comments, a JFIF extension thumbnail and anything
 * after the end marker are dropped. Null when it isn't such a JPEG.
 */
export function cleanJpeg(input: Uint8Array): CleanJpeg | null {
  const n = input.length;
  if (n < 4 || input[0] !== 0xff || input[1] !== SOI) return null;
  const out: Uint8Array[] = [input.subarray(0, 2)];
  let pos = 2;
  let size: { width: number; height: number } | null = null;
  let scans = 0;
  for (;;) {
    // A marker: 0xFF, any number of fill bytes (0xFF again), then its code.
    if (pos >= n || input[pos] !== 0xff) return null;
    while (pos < n && input[pos] === 0xff) pos++;
    if (pos >= n) return null;
    const code = input[pos]!;
    pos++;
    if (code === EOI) {
      if (!size || scans === 0) return null;
      out.push(Uint8Array.of(0xff, EOI));
      return { bytes: Buffer.concat(out), ...size };
    }
    // Markers without a length (another SOI, restarts, TEM) can't stand here.
    if (code === SOI || code === 0x00 || code === 0x01 || isRestart(code)) return null;
    if (pos + 2 > n) return null;
    const length = (input[pos]! << 8) | input[pos + 1]!;
    if (length < 2 || pos + length > n) return null;
    const segment = input.subarray(pos - 2, pos + length);
    const body = input.subarray(pos + 2, pos + length);
    pos += length;

    if (FRAMES.has(code)) {
      if (size || body.length < 6 || body[0] !== 8) return null;
      const height = (body[1]! << 8) | body[2]!;
      const width = (body[3]! << 8) | body[4]!;
      const components = body[5]!;
      if (!height || !width || ![1, 3, 4].includes(components) || body.length < 6 + 3 * components) return null;
      size = { width, height };
      out.push(segment);
    } else if (OTHER_FRAMES.has(code)) {
      return null;
    } else if (code === SOS) {
      if (!size) return null;
      out.push(segment);
      scans++;
      // The coded data runs to the next marker: 0xFF 0x00 is a data byte and the restart markers sit inside it.
      const start = pos;
      for (;;) {
        if (pos + 1 >= n) return null;
        if (input[pos] === 0xff) {
          const next = input[pos + 1]!;
          if (next === 0x00 || isRestart(next)) {
            pos += 2;
            continue;
          }
          if (next !== 0xff) break;
        }
        pos++;
      }
      out.push(input.subarray(start, pos));
    } else if (code === APP0) {
      const header = startsWith(body, "JFIF\0") ? jfifHeader(body) : null;
      if (header) out.push(header);
    } else if (code === APP14) {
      if (startsWith(body, "Adobe") && body.length === 12) out.push(segment);
    } else if ((code >= 0xe1 && code <= 0xef) || code === 0xfe) {
      // Other application segments (EXIF, XMP, ICC, IPTC…) and comments: metadata, left out.
    } else {
      // Tables, restart interval and the other structural segments.
      out.push(segment);
    }
  }
}
