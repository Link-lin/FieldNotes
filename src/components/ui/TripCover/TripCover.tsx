import type { TripCoverDTO } from "@/shared/dto";
import { cx } from "@/lib/cx";
import styles from "./TripCover.module.css";

/**
 * DASH-8: a trip's cover at one of its two sizes. Its width and height attributes, and `--cover-ratio` for the CSS
 * that sizes it, reserve its shape before it loads. Decorative unless given `alt`.
 */
export function TripCover({ cover, size, alt = "", className }: { cover: TripCoverDTO; size: "small" | "full"; alt?: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a private image the app serves with the session; next/image would fetch it without one
    <img
      className={cx(styles.cover, className)}
      src={size === "full" ? cover.full : cover.small}
      width={cover.width}
      height={cover.height}
      style={{ "--cover-ratio": cover.width / cover.height } as React.CSSProperties}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  );
}
