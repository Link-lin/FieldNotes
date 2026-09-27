"use client";

import { useEffect, useRef } from "react";
import type { PlanItemDTO } from "@/shared/dto";
import { formatMoney } from "@/shared/money";
import { googleDirectionsUrl, googleSearchUrl, providerLabel } from "@/shared/map-links";
import { TYPE_LABEL } from "./format";
import { CopyIcon, DotsIcon, EditIcon, PinIcon, PlaneIcon, TrashIcon } from "./icons";

type Props = {
  item: PlanItemDTO;
  num: { n: number; need: boolean } | null;
  owner: boolean;
  tripZone: string;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export function priceText(p: NonNullable<PlanItemDTO["plannedPrice"]>): string {
  return `${formatMoney(p.amount, p.currency)} · ${p.source === "ai" ? "unverified estimate" : p.label}`;
}

function timeText(item: PlanItemDTO, tripZone: string): string {
  if (item.flightDetails) {
    const d = item.flightDetails.departure;
    if (d.localDateTime) return `${d.localDateTime.slice(11)}${d.timeZone && d.timeZone !== tripZone ? ` (${d.timeZone})` : ""}`;
    return item.timelineDate ? "Time not set" : "No date";
  }
  if (!item.localDate) return "No date";
  if (!item.localTime) return "Time not set";
  return `${item.localTime}${item.timeZone && item.timeZone !== tripZone ? ` (${item.timeZone})` : ""}${item.durationMinutes ? ` · ${item.durationMinutes} min` : ""}`;
}

/** One timeline row: time, title, place links, tags, and the owner's three-dot menu (TRIP-8). */
export function EventRow({ item, num, owner, tripZone, menuOpen, onMenu, onEdit, onDuplicate, onDelete }: Props) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) onMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen, onMenu]);

  function onMenuKey(e: React.KeyboardEvent) {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      onMenu(false);
      button.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      e.preventDefault();
      onMenu(false);
      button.current?.focus();
    }
  }

  const f = item.flightDetails;
  const tags = (
    <span className="event-tags">
      <span className="tag tag-soft">{TYPE_LABEL[item.type]}</span>
      {item.plannedPrice ? <span className="tag tag-price">{priceText(item.plannedPrice)}</span> : null}
      {item.bookingStatus === "needs_booking" ? <span className="tag tag-need">Needs booking</span> : null}
      {item.bookingStatus === "booked" ? <span className="tag tag-booked">Booked</span> : null}
      {item.source === "ai" ? <span className="tag tag-soft">AI draft, unverified</span> : null}
    </span>
  );
  const links =
    item.location || item.mapUrl || item.links.length ? (
      <span className="event-links">
        {item.location ? <span className="event-place"><PinIcon />{item.location}</span> : null}
        {item.mapUrl ? (
          <a className="pill pill-quiet" href={item.mapUrl} target="_blank" rel="noopener noreferrer">Open in {item.mapProvider ?? "map"} ↗</a>
        ) : item.location ? (
          <a className="pill pill-quiet" href={googleSearchUrl(item.location)} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a>
        ) : null}
        {item.location ? <a className="pill pill-quiet" href={googleDirectionsUrl(item.location)} target="_blank" rel="noopener noreferrer">Directions ↗</a> : null}
        {item.links.map((l, i) => (
          <a key={i} className="pill pill-quiet" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} · {providerLabel(l.url)} ↗</a>
        ))}
      </span>
    ) : null;

  return (
    <li className={`event${num ? " has-num" : ""}${owner ? " owned" : ""}${menuOpen ? " menu-open" : ""}`} data-hl={item.id}>
      {num ? <span className={`num${num.need ? " need" : ""}`}>{num.n}</span> : null}
      {owner ? (
        <span className="event-menu" ref={wrap}>
          <button
            ref={button}
            className="kebab"
            type="button"
            data-menu={item.id}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Actions for ${item.title}`}
            onClick={() => onMenu(!menuOpen)}
          >
            <DotsIcon />
          </button>
          <div className="menu" role="menu" ref={menu} hidden={!menuOpen} onKeyDown={onMenuKey}>
            <button type="button" role="menuitem" tabIndex={-1} onClick={onEdit}><EditIcon /> Edit event</button>
            <button type="button" role="menuitem" tabIndex={-1} onClick={onDuplicate}><CopyIcon /> Duplicate</button>
            <button type="button" role="menuitem" tabIndex={-1} className="danger" onClick={onDelete}><TrashIcon /> Delete event</button>
          </div>
        </span>
      ) : null}
      <span className="event-time">{timeText(item, tripZone)}</span>
      {f ? (
        <div className="pass">
          <div className="mono">
            <span>Flight segment{f.airline || f.flightNumber ? ` · ${[f.airline, f.flightNumber].filter(Boolean).join(" ")}` : ""}</span>
            <span>{item.bookingStatus === "booked" ? "Booked" : "Needs booking"}</span>
          </div>
          <div className="route">
            <span>{f.departure.airportCode ?? "···"}</span>
            <PlaneIcon />
            <span>{f.arrival.airportCode ?? "···"}</span>
          </div>
          <div className="mono pass-foot">
            <span>{item.title}</span>
            {f.arrival.localDateTime ? <span>Arrives {f.arrival.localDateTime.replace("T", " ")}</span> : null}
            {item.plannedPrice ? <span>{priceText(item.plannedPrice)}</span> : null}
          </div>
          {item.source === "ai" ? <div><span className="tag">AI draft, unverified</span></div> : null}
        </div>
      ) : (
        <span className="event-title">{item.title}</span>
      )}
      {item.notes ? <p className="event-notes">{item.notes}</p> : null}
      {links}
      {!num && !f && item.localDate ? <span className="nopin">Not on the map yet</span> : null}
      {f ? null : tags}
    </li>
  );
}
