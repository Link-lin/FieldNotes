import { MinusIcon, PlusIcon, ResetIcon } from "@/components/ui/Icon/icons";
import { cx } from "@/lib/cx";
import styles from "./GlobeControls.module.css";

/** The drag hint, the marker key and the zoom buttons laid over the globe. */
export function GlobeControls({ hintGone, onZoomIn, onZoomOut, onReset }: { hintGone: boolean; onZoomIn: () => void; onZoomOut: () => void; onReset: () => void }) {
  return (
    <>
      <span className={cx("mono", styles.hint)} data-gone={hintGone}>Drag to turn<br />Scroll to zoom</span>
      <div className={cx("mono", styles.legend)} aria-label="Marker key">
        <span><i className={cx(styles.mk, styles.upcoming)} />Upcoming</span>
        <span><i className={cx(styles.mk, styles.ongoing)} />Ongoing</span>
        <span><i className={cx(styles.mk, styles.past)} />Past</span>
      </div>
      <div className={styles.zoom}>
        <button type="button" aria-label="Zoom in" onClick={onZoomIn}><PlusIcon /></button>
        <button type="button" aria-label="Zoom out" onClick={onZoomOut}><MinusIcon /></button>
        <button type="button" aria-label="Reset view" onClick={onReset}><ResetIcon /></button>
      </div>
    </>
  );
}
