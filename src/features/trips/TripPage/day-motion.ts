/**
 * Day-tab switch motion (TRIP-2). The new day's timeline slides in from the side the tab lies on
 * (later days from the right, earlier ones from the left) and its events settle in one after
 * another. Web Animations, so nothing is left behind in the DOM; skipped for reduced motion.
 */
const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";
const SHIFT_PX = 28;
const MAX_STAGGERED = 8;

export function prefersReducedMotion(): boolean {
  return typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** `direction` is +1 for a later tab, -1 for an earlier one, 0 when unknown. */
export function animateDayEnter(main: HTMLElement, direction: number): void {
  if (prefersReducedMotion() || typeof main.animate !== "function") return;
  main.getAnimations().forEach((a) => a.cancel());
  main.animate(
    [{ opacity: 0, transform: `translateX(${direction * SHIFT_PX}px)` }, { opacity: 1, transform: "none" }],
    { duration: 320, easing: EASE },
  );
  const rows = Array.from(main.querySelectorAll<HTMLElement>("[data-hl]")).slice(0, MAX_STAGGERED);
  rows.forEach((row, i) => {
    row.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], {
      duration: 300,
      delay: 60 + i * 35,
      easing: EASE,
      fill: "backwards",
    });
  });
}
