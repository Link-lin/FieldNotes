"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PlaceDTO } from "@/shared/dto";
import { api } from "./api";

/**
 * Destination field with suggestions from the bundled place catalog (WAI-ARIA combobox with a
 * list popup). Free text stays allowed for multi-stop trips; a picked suggestion matches the
 * catalog exactly, so the trip gets a globe point and a suggested time zone.
 */
export function DestinationInput({
  id,
  value,
  onChange,
  onPick,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onPick: (p: PlaceDTO) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const [results, setResults] = useState<PlaceDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState<string | null>(null); // last text typed (null after a pick)
  const seq = useRef(0);

  useEffect(() => {
    const q = query?.trim() ?? "";
    if (q.length < 2) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await api<{ places: PlaceDTO[] }>("GET", `/api/atlas/places?q=${encodeURIComponent(q.slice(0, 160))}`);
      if (n !== seq.current || !r.ok) return;
      setResults(r.data.places.slice(0, 8));
      setActive(-1);
      setOpen(true);
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  const shown = open && (query?.trim().length ?? 0) >= 2 && results.length > 0;

  function pick(p: PlaceDTO) {
    seq.current++;
    onChange(p.label);
    onPick(p);
    setQuery(null);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!results.length) return;
      e.preventDefault();
      if (!shown) {
        setOpen(true);
        setActive(e.key === "ArrowDown" ? 0 : results.length - 1);
        return;
      }
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % results.length : (i - 1 + results.length) % results.length));
    } else if (e.key === "Enter" && shown && active > -1) {
      e.preventDefault();
      pick(results[active]!);
    } else if (e.key === "Escape" && shown) {
      e.stopPropagation(); // close the list, not the dialog
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div className="combo">
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && active > -1 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        value={value}
        maxLength={160}
        placeholder="Start typing a city or country"
        onChange={(e) => {
          onChange(e.target.value);
          setQuery(e.target.value);
          if (e.target.value.trim().length < 2) setOpen(false);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => results.length && query !== null && setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      <ul className="combo-list" id={listId} role="listbox" aria-label="Suggested places" hidden={!shown}>
        {results.map((p, i) => {
          const comma = p.label.lastIndexOf(",");
          const name = p.kind === "country" || comma < 0 ? p.label : p.label.slice(0, comma);
          const where = p.kind === "country" ? "Country" : p.label.slice(comma + 1).trim();
          return (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the input
              onClick={() => pick(p)}
              onMouseMove={() => setActive(i)}
            >
              <b>{name}</b>
              <span>{where}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
