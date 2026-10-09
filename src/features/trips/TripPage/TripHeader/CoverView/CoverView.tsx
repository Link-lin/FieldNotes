"use client";

import type { TripCoverDTO } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { TripCover } from "@/components/ui/TripCover/TripCover";
import styles from "./CoverView.module.css";

/** DASH-8: the trip's cover at full size, for everyone the trip is shared with. */
export function CoverView({ title, cover, onClose }: { title: string; cover: TripCoverDTO; onClose: () => void }) {
  return (
    <Modal title={title} subtitle="Cover" onClose={onClose} triggerSelector="[data-cover-open]">
      <TripCover cover={cover} size="full" alt={`The cover of ${title}`} className={styles.image} />
      <ModalActions>
        <Button variant="fill" onClick={onClose}>Close</Button>
      </ModalActions>
    </Modal>
  );
}
