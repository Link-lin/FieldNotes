"use client";

import type { PlanItemDTO } from "@/shared/dto";
import { googleSearchUrl, providerLabel } from "@/shared/map-links";
import { ButtonLink } from "@/components/ui/Button/Button";
import { CopyIcon, DotsIcon, EditIcon, PinIcon, TrashIcon } from "@/components/ui/Icon/icons";
import { Menu, MenuItem } from "@/components/ui/Menu/Menu";
import { Tag } from "@/components/ui/Tag/Tag";
import { priceText, TYPE_LABEL } from "@/lib/format";
import { StopNumber } from "../../StopNumber/StopNumber";
import { eventTimeText } from "../../trip-days";
import { FlightCard } from "../../FlightCard/FlightCard";
import styles from "./EventRow.module.css";

type Props = {
  item: PlanItemDTO;
  num: { n: number; need: boolean } | null;
  owner: boolean;
  tripZone: string;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  /** Opens the event's side panel (TRIP-10). */
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

/**
 * One timeline row: number, time, title (or flight card), notes, place links, tags, and the
 * owner's three-dot menu (TRIP-8). data-hl links it with its pin and stop-list line. The whole
 * row opens the event's side panel (TRIP-10) through one stretched button; links and the menu
 * sit above it and keep working.
 */
export function EventRow({ item, num, owner, tripZone, menuOpen, onMenu, onOpen, onEdit, onDuplicate, onDelete }: Props) {
  const f = item.flightDetails;
  return (
    <li className={styles.event} data-hl={item.id} data-numbered={!!num} data-owned={owner} data-menu-open={menuOpen}>
      {num ? <StopNumber n={num.n} need={num.need} className={styles.num} /> : null}
      <button type="button" className={styles.open} data-details={item.id} aria-haspopup="dialog" aria-label={`Details for ${item.title}`} onClick={onOpen} />
      {owner ? (
        <Menu
          className={styles.menu}
          popupClassName={styles.popup}
          open={menuOpen}
          onOpenChange={onMenu}
          trigger={(props) => (
            <button className={styles.kebab} type="button" data-menu={item.id} aria-label={`Actions for ${item.title}`} {...props}>
              <DotsIcon />
            </button>
          )}
        >
          <MenuItem icon={<EditIcon />} onClick={onEdit}>Edit event</MenuItem>
          <MenuItem icon={<CopyIcon />} onClick={onDuplicate}>Duplicate</MenuItem>
          <MenuItem icon={<TrashIcon />} danger onClick={onDelete}>Delete event</MenuItem>
        </Menu>
      ) : null}
      <span className={styles.time}>{eventTimeText(item, tripZone)}</span>
      {f ? <FlightCard item={item} className={styles.flight} /> : <span className={styles.title}>{item.title}</span>}
      {item.notes ? <p className={styles.notes}>{item.notes}</p> : null}
      {item.location || item.mapUrl || item.links.length ? (
        <span className={styles.links}>
          {item.location ? <span className={styles.place}><PinIcon />{item.location}</span> : null}
          {item.mapUrl ? (
            <ButtonLink variant="quiet" external href={item.mapUrl}>Open in {item.mapProvider ?? "map"} ↗</ButtonLink>
          ) : item.location ? (
            <ButtonLink variant="quiet" external href={googleSearchUrl(item.location)}>Open in Google Maps ↗</ButtonLink>
          ) : null}
          {item.links.map((l, i) => (
            <ButtonLink key={i} variant="quiet" external href={l.url}>{l.label} · {providerLabel(l.url)} ↗</ButtonLink>
          ))}
        </span>
      ) : null}
      {!num && !f && item.localDate ? <span className={styles.nopin}>Not on the map yet</span> : null}
      {f ? null : (
        <span className={styles.tags}>
          <Tag tone="soft">{TYPE_LABEL[item.type]}</Tag>
          {item.plannedPrice ? <Tag tone="price">{priceText(item.plannedPrice)}</Tag> : null}
          {item.bookingStatus === "needs_booking" ? <Tag tone="need">Needs booking</Tag> : null}
          {item.bookingStatus === "booked" ? <Tag tone="booked">Booked</Tag> : null}
          {item.source === "ai" ? <Tag tone="soft">AI draft, unverified</Tag> : null}
        </span>
      )}
    </li>
  );
}
