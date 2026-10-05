"use client";

import { useEffect } from "react";
import type { PlanItemDTO, TripDetailDTO } from "@/shared/dto";
import { googleSearchUrl } from "@/shared/map-links";
import { ButtonLink } from "@/components/ui/Button/Button";
import { EditSection } from "@/components/ui/EditSection/EditSection";
import { PinIcon } from "@/components/ui/Icon/icons";
import { useInlineField } from "@/lib/use-inline-field";
import { placeDraftOf, placeFields, saveEventFields, saveFailure, type PlaceDraft } from "../event-edit";
import { PlaceFields } from "../PlaceFields/PlaceFields";
import styles from "./PlaceSection.module.css";

type Props = {
  trip: TripDetailDTO["trip"];
  item: PlanItemDTO;
  canEdit: boolean;
  placeLookup: boolean;
  onSaved: (item: PlanItemDTO) => void;
  onDirty: (key: string, dirty: boolean) => void;
};

/** Where the event is and how it is pinned (MAP-1, MAP-2), edited in place as one section. Removing a pin offers Undo. */
export function PlaceSection({ trip, item, canEdit, placeLookup, onSaved, onDirty }: Props) {
  const isFlight = item.type === "flight";
  const save = async (next: PlaceDraft, start: PlaceDraft) => {
    const r = await saveEventFields(trip.id, item.id, placeFields(next), placeFields(start));
    if (!r.ok) return saveFailure(r);
    onSaved(r.item);
    return r;
  };
  const field = useInlineField<PlaceDraft>({
    read: () => placeDraftOf(item),
    save: async (next, start) => {
      const r = await save(next, start);
      if (!r.ok) return r;
      const before = placeFields(start);
      const after = placeFields(next);
      if (before.mapUrl && !after.mapUrl && before.location === after.location) return { ok: true, note: "Pin removed.", undo: () => save(start, next) };
      // MAP-2: a new place name without a map link is looked up after saving; the pin arrives as a live update.
      if (placeLookup && !isFlight && after.location && after.location !== before.location && !after.mapUrl) return { ok: true, note: "Saved. It will be pinned on the map if the name has one clear match." };
      return { ok: true };
    },
  });
  useEffect(() => onDirty("place", field.dirty), [field.dirty, onDirty]);

  if (!canEdit && !item.location && !item.mapUrl) return null;
  return (
    <EditSection
      title="Place & map"
      canEdit={canEdit}
      editing={field.editing}
      onEdit={field.open}
      onCancel={field.cancel}
      onSave={() => void field.commit()}
      status={field.status}
      onUndo={() => void field.undo()}
      view={
        item.location || item.mapUrl ? (
          <div className={styles.view}>
            {item.location ? <p className={styles.place}><PinIcon />{item.location}</p> : null}
            {item.coordinates?.source === "lookup" ? (
              <p className="note">Pinned automatically from the place name{canEdit ? ". If it's the wrong place, Edit changes or removes the pin." : "."}</p>
            ) : !item.coordinates && !isFlight ? (
              <p className="note">Not on the map yet{canEdit ? ". Edit to find the place or paste a map link." : "."}</p>
            ) : null}
            <div className="cluster">
              {item.mapUrl ? (
                <ButtonLink variant="quiet" external href={item.mapUrl}>Open in {item.mapProvider ?? "map"} ↗</ButtonLink>
              ) : item.location ? (
                <ButtonLink variant="quiet" external href={googleSearchUrl(item.location)}>Open in Google Maps ↗</ButtonLink>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="note">No place yet.</p>
        )
      }
    >
      <PlaceFields
        value={field.draft}
        onChange={(patch) => field.setDraft((d) => ({ ...d, ...patch }))}
        error={field.error}
        placeLookup={placeLookup}
        isFlight={isFlight}
        tripDestination={trip.destination}
        links={item.links}
        autoPin={item.coordinates?.source === "lookup" ? item.mapUrl : null}
        disabled={field.saving}
      />
    </EditSection>
  );
}
