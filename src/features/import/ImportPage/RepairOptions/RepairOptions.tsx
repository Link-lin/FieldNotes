"use client";

import { useState } from "react";
import type { FieldError } from "@/shared/dto";
import { Button } from "@/components/ui/Button/Button";
import { Banner } from "@/components/ui/Banner/Banner";
import styles from "./RepairOptions.module.css";

type Props = { errors: FieldError[]; responseText: string; onCopy: (text: string, label: string) => Promise<void> };

/** Repair is an explicit copy action. The full response is displayed before it can be copied. */
export function RepairOptions({ errors, responseText, onCopy }: Props) {
  const [showFull, setShowFull] = useState(false);
  const list = errors.map((error) => `${error.path || "Response"}: ${error.message}`).join("\n") || "The response could not be imported. Return valid Travel Planner JSON v1.";
  const repair = `Please correct this Travel Planner JSON v1 response. Return exactly one JSON object, with no Markdown or prose. Preserve all valid trip and item details; do not invent bookings, prices, flight details, or sensitive data.\n\nErrors:\n${list}\n\nOriginal response:\n${responseText}`;

  return (
    <div className={styles.wrap}>
      <div className={styles.actions}>
        <Button variant="quiet" onClick={() => onCopy(list, "Errors copied")}>Copy errors only</Button>
        <Button variant="quiet" onClick={() => setShowFull((value) => !value)} aria-expanded={showFull}>{showFull ? "Hide" : "Review"} response and errors for repair</Button>
      </div>
      {showFull ? (
        <div className={styles.full}>
          <Banner tone="warn">The text below contains your full pasted response. Check it before copying it to an external AI provider.</Banner>
          <label htmlFor="repair-text">Exact text to copy</label>
          <textarea id="repair-text" readOnly value={repair} rows={9} />
          <Button variant="outline" onClick={() => onCopy(repair, "Response and errors copied")}>Copy shown response and errors</Button>
        </div>
      ) : null}
    </div>
  );
}
