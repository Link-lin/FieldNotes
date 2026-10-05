import type { PlanItemDTO } from "./dto";

/** An AI draft nobody has reviewed yet (IMPORT-7): it carries the "AI draft, unverified" tag until a person marks it reviewed. */
export const isAiDraft = (item: Pick<PlanItemDTO, "source" | "reviewedAt">): boolean => item.source === "ai" && !item.reviewedAt;
