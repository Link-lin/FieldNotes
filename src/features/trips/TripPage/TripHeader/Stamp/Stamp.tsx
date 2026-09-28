import { cx } from "@/lib/cx";
import { fmtMonth } from "@/lib/format";
import styles from "./Stamp.module.css";

/** Decorative passport stamp: destination, month, year and length. Colour follows the trip status. */
export function Stamp({ city, start, days, status, className }: { city: string; start: string; days: number; status: string; className?: string }) {
  return (
    <svg className={cx(styles.stamp, className)} data-status={status} viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <path id="stamp-arc" d="M60,60 m-45,0 a45,45 0 1,1 90,0 a45,45 0 1,1 -90,0" />
      </defs>
      <circle cx="60" cy="60" r="57" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="60" cy="60" r="35" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 3" />
      <text fontFamily="var(--mono)" fontSize="9.5" fontWeight="500" fill="currentColor">
        <textPath href="#stamp-arc" textLength="276" lengthAdjust="spacing">{`${city.toUpperCase().slice(0, 18)} · FIELD NOTES ·`}</textPath>
      </text>
      <text x="60" y="58" textAnchor="middle" fontFamily="var(--serif)" fontSize="20" fontWeight="700" fill="currentColor">{fmtMonth(start)}</text>
      <text x="60" y="73" textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="currentColor">{start.slice(0, 4)} · {days}D</text>
    </svg>
  );
}
