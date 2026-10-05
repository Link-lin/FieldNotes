const s = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const GlobeIcon = () => (
  <svg viewBox="0 0 16 16" strokeWidth={1.5} {...s} aria-hidden="true">
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12M8 2c1.8 1.7 2.7 3.7 2.7 6S9.8 12.3 8 14c-1.8-1.7-2.7-3.7-2.7-6S6.2 3.7 8 2z" />
  </svg>
);
export const PlusIcon = () => (
  <svg viewBox="0 0 16 16" strokeWidth={1.8} {...s} aria-hidden="true">
    <path d="M8 3v10M3 8h10" />
  </svg>
);
export const MinusIcon = () => (
  <svg viewBox="0 0 16 16" strokeWidth={1.8} {...s} aria-hidden="true">
    <path d="M3 8h10" />
  </svg>
);
export const ResetIcon = () => (
  <svg viewBox="0 0 16 16" strokeWidth={1.5} {...s} aria-hidden="true">
    <path d="M3 8a5 5 0 1 0 1.7-3.7M3 3v3h3" />
  </svg>
);
export const CheckIcon = () => (
  <svg viewBox="0 0 16 16" strokeWidth={1.8} {...s} aria-hidden="true">
    <path d="M3 8.5l3.2 3L13 4.5" />
  </svg>
);
export const EditIcon = () => (
  <svg viewBox="0 0 16 16" strokeWidth={1.5} {...s} aria-hidden="true">
    <path d="M2.5 13.5l1-3.5L11 2.5 13.5 5 6 12.5zM9.5 4l2.5 2.5" />
  </svg>
);
export const TrashIcon = () => (
  <svg viewBox="0 0 16 16" strokeWidth={1.5} {...s} aria-hidden="true">
    <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.6 8.5h6.8l.6-8.5M6.7 7v4M9.3 7v4" />
  </svg>
);
export const CopyIcon = () => (
  <svg viewBox="0 0 16 16" strokeWidth={1.5} {...s} aria-hidden="true">
    <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
    <path d="M10.5 5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5H5" />
  </svg>
);
export const ShareIcon = () => (
  <svg viewBox="0 0 16 16" strokeWidth={1.5} {...s} aria-hidden="true">
    <circle cx="6" cy="5.5" r="2.5" />
    <path d="M1.5 13.5c.5-2.4 2.3-3.8 4.5-3.8s4 1.4 4.5 3.8M11.5 5v5M9 7.5h5" />
  </svg>
);
export const DotsIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="3" cy="8" r="1.5" />
    <circle cx="8" cy="8" r="1.5" />
    <circle cx="13" cy="8" r="1.5" />
  </svg>
);
export const PinIcon = () => (
  <svg viewBox="0 0 16 16" strokeWidth={1.5} {...s} aria-hidden="true">
    <path d="M8 14.5s5-4.3 5-8.3A5 5 0 0 0 3 6.2c0 4 5 8.3 5 8.3z" />
    <circle cx="8" cy="6.2" r="1.8" />
  </svg>
);
export const WarnIcon = () => (
  <svg viewBox="0 0 16 16" strokeWidth={1.6} {...s} aria-hidden="true">
    <path d="M8 2.5l6 10.5H2z" />
    <path d="M8 7v3M8 11.6v.01" />
  </svg>
);
export const ClockIcon = () => (
  <svg viewBox="0 0 16 16" strokeWidth={1.6} {...s} aria-hidden="true">
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.2 1.5" />
  </svg>
);
export const PlaneIcon = () => (
  <svg viewBox="0 0 34 14" strokeWidth={1.4} {...s} aria-hidden="true">
    <path d="M1 7h30M26 2l6 5-6 5" />
  </svg>
);
export const StatusIcon = ({ status }: { status: "upcoming" | "ongoing" | "past" }) =>
  status === "upcoming" ? (
    <svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="currentColor" /></svg>
  ) : status === "ongoing" ? (
    <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 .5L9.5 5 5 9.5.5 5z" fill="currentColor" /></svg>
  ) : (
    <svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
  );
