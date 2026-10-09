"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import type { TripCoverDTO, TripDetailDTO, TripSummaryDTO } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { SectionFrame } from "@/components/ui/EditSection/EditSection";
import { SaveStatus } from "@/components/ui/SaveStatus/SaveStatus";
import { TripCover } from "@/components/ui/TripCover/TripCover";
import { api } from "@/lib/api";
import { useInlineField, type FieldSaveResult } from "@/lib/use-inline-field";
import { prepareCover, type CoverFiles } from "./cover-image";
import styles from "./CoverSection.module.css";

/** What a save changes the cover to: a file just chosen, images to put back (Undo), or none. `version` is the cover shown. */
type CoverValue = { version: string } | { file: File } | { files: CoverFiles } | null;
const sameCover = (a: CoverValue, b: CoverValue) => (a && b ? "version" in a && "version" in b && a.version === b.version : a === b);

/** The cover's two images as stored, so Undo can put them back; null when they can't be fetched. */
async function storedImages(cover: TripCoverDTO): Promise<CoverFiles | null> {
  try {
    const [full, small] = await Promise.all(
      [cover.full, cover.small].map(async (url) => {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`cover ${res.status}`);
        return res.blob();
      }),
    );
    return { full: full!, small: small! };
  } catch {
    return null;
  }
}

/** Stores new images (or removes the cover) if the cover is still `base`, the version the change started from. */
async function sendCover(tripId: string, files: CoverFiles | null, base: string): Promise<{ ok: true; trip: TripSummaryDTO } | Extract<FieldSaveResult, { ok: false }>> {
  let r;
  if (files) {
    const form = new FormData();
    form.append("full", files.full, "full.jpg");
    form.append("small", files.small, "small.jpg");
    form.append("base", base);
    r = await api<TripSummaryDTO>("PUT", `/api/trips/${tripId}/cover`, form);
  } else {
    r = await api<TripSummaryDTO>("DELETE", `/api/trips/${tripId}/cover`, { base });
  }
  if (r.ok) return { ok: true, trip: r.data };
  if (r.code === "field_conflict") {
    return { ok: false, conflict: true, message: "The cover was changed elsewhere (in another tab or window, or by another owner) meanwhile, so yours wasn't saved. Look at it as it is now, then try again." };
  }
  return { ok: false, message: r.message };
}

/**
 * DASH-8: the trip's cover in the trip details (owners). Choosing an image makes its two sizes on this device and saves
 * them at once; Replace and Remove offer Undo, which puts the previous images back.
 */
export function CoverSection({ trip }: { trip: TripDetailDTO["trip"] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const cover = trip.cover;

  /** Saves `next` over `base`; a change offers Undo (an Undo itself doesn't, so it needn't fetch the images it replaces). */
  async function change(next: CoverValue, base: string, before: TripCoverDTO | null, offerUndo = true): Promise<FieldSaveResult> {
    let files: CoverFiles | null = null;
    if (next && "file" in next) {
      const made = await prepareCover(next.file);
      if (!made.ok) return { ok: false, message: made.message };
      files = made.files;
    } else if (next && "files" in next) {
      files = next.files;
    }
    const previous = offerUndo && before ? await storedImages(before) : null;
    const r = await sendCover(trip.id, files, base);
    if (!r.ok) return r;
    router.refresh();
    const now = r.trip.cover;
    const version = now?.version ?? "";
    // Undo puts back the images that were there, or removes a cover the trip didn't have.
    const undo = !offerUndo ? undefined : before ? (previous ? () => change({ files: previous }, version, now, false) : undefined) : () => change(null, version, now, false);
    return { ok: true, note: files ? "Cover saved." : "Cover removed.", undo };
  }

  const field = useInlineField<CoverValue>({
    read: () => (cover ? { version: cover.version } : null),
    same: sameCover,
    save: (next, start) => change(next, start && "version" in start ? start.version : "", cover),
  });

  return (
    <SectionFrame title="Cover">
      <div className={styles.body} data-has-cover={cover ? true : undefined}>
        {cover ? <TripCover cover={cover} size="small" alt="This trip's cover" className={styles.preview} /> : null}
        <div className={styles.side}>
          <p className="note">
            {cover ? "Shown on this trip's card and page, to everyone you share it with." : "A picture for this trip's card and page, such as a photo from the trip, or an image you made from one in an AI chat."}
          </p>
          <div className={styles.actions}>
            <Button data-cover-choose disabled={field.saving} onClick={() => input.current?.click()}>{cover ? "Replace image…" : "Choose image…"}</Button>
            {cover ? <Button variant="quiet" disabled={field.saving} onClick={() => void field.saveNow(null)}>Remove cover</Button> : null}
          </div>
          <input
            ref={input}
            className="visually-hidden"
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void field.saveNow({ file });
            }}
          />
          <SaveStatus status={field.status} onUndo={() => void field.undo()} showError />
          <p className="note">It is made smaller on this device before it is sent, and keeps no location or camera details.</p>
        </div>
      </div>
    </SectionFrame>
  );
}
