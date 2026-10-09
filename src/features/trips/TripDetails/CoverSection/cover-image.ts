/**
 * DASH-8: what this device makes from a chosen image before it is uploaded as a trip's cover. Drawing it on a canvas
 * and encoding it again as JPEG leaves the photo's metadata (location, camera, time, thumbnails) behind. The server's
 * limits are wider than these (`COVER_RULES` in the cover service).
 */
export const COVER_IMAGE = { fullEdge: 1600, smallEdge: 480, minSide: 200, maxRatio: 3, budget: 1_000_000 } as const;

/** The full image's tries, best first, until both images fit the budget: lower quality, then a shorter long edge. */
export const FULL_STEPS: ReadonlyArray<{ edge: number; quality: number }> = [
  { edge: COVER_IMAGE.fullEdge, quality: 0.86 },
  { edge: COVER_IMAGE.fullEdge, quality: 0.78 },
  { edge: COVER_IMAGE.fullEdge, quality: 0.7 },
  { edge: 1280, quality: 0.78 },
  { edge: 1280, quality: 0.7 },
];
export const SMALL_QUALITY = 0.8;

export type Size = { width: number; height: number };
export type CoverFiles = { full: Blob; small: Blob };

/** The size an image takes with its long edge at most `edge`; never enlarged. */
export function fitWithin({ width, height }: Size, edge: number): Size {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Why an image of this size can't be a cover, or null. */
export function coverSizeProblem({ width, height }: Size): string | null {
  if (Math.min(width, height) < COVER_IMAGE.minSide) return `Choose an image at least ${COVER_IMAGE.minSide} pixels on each side.`;
  if (Math.max(width, height) / Math.min(width, height) > COVER_IMAGE.maxRatio) return "Choose an image no more than three times as long as it is wide.";
  return null;
}

/** Encodes the small image, then the full one at each step until the two fit the budget; null when nothing fits. */
export async function encodeWithinBudget(size: Size, encode: (size: Size, quality: number) => Promise<Blob | null>): Promise<CoverFiles | null> {
  const small = await encode(fitWithin(size, COVER_IMAGE.smallEdge), SMALL_QUALITY);
  if (!small) return null;
  for (const step of FULL_STEPS) {
    const full = await encode(fitWithin(size, step.edge), step.quality);
    if (!full) return null;
    if (full.size + small.size <= COVER_IMAGE.budget) return { full, small };
  }
  return null;
}

/** Draws the image at `size` over white (a transparent picture would turn black) and encodes it as JPEG. */
function drawJpeg(img: HTMLImageElement, size: Size, quality: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, size.width, size.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob?.type === "image/jpeg" ? blob : null), "image/jpeg", quality));
}

/**
 * The cover's two JPEGs for a chosen file. The browser decodes it (applying the photo's orientation; Safari also reads
 * HEIC), so whatever it can show can be a cover.
 */
export async function prepareCover(file: File): Promise<{ ok: true; files: CoverFiles } | { ok: false; message: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      return { ok: false, message: "This browser can't read that image. Try a JPEG or PNG." };
    }
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    const problem = coverSizeProblem(size);
    if (problem) return { ok: false, message: problem };
    const files = await encodeWithinBudget(size, (at, quality) => drawJpeg(img, at, quality));
    return files ? { ok: true, files } : { ok: false, message: "Couldn't make that image small enough to store. Try another one." };
  } finally {
    URL.revokeObjectURL(url);
  }
}
