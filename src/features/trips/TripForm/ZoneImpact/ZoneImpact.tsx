import { Card } from "@/components/ui/Card/Card";
import { plural } from "@/lib/format";
import styles from "./ZoneImpact.module.css";

type DueWord = "upcoming" | "due_today" | "overdue";
export type Impact = {
  items: Array<{ itemId: string; title: string; localDate: string; localTime: string; result: "ok" | "gap" | "ambiguous" }>;
  bookingTasksAffected: number;
  bookingTasks: Array<{ itemId: string; title: string; dueDate: string; before: DueWord; after: DueWord }>;
};
export type Choice = "earlier" | "later";
const DUE_WORD: Record<DueWord, string> = { upcoming: "not due yet", due_today: "due today", overdue: "overdue" };

/**
 * What a trip time-zone change does (TRIP-4): every event whose local time is read in the new
 * zone, every booking task's due state, times that don't exist (blocking) and times that repeat
 * (the owner picks earlier or later).
 */
export function ZoneImpact({ impact, zone, choices, onChoose }: { impact: Impact; zone: string; choices: Record<string, Choice>; onChoose: (itemId: string, c: Choice) => void }) {
  const ok = impact.items.filter((i) => i.result === "ok");
  const gaps = impact.items.filter((i) => i.result === "gap");
  const ambiguous = impact.items.filter((i) => i.result === "ambiguous");
  return (
    <Card className={styles.impact} role="status" aria-live="polite">
      <b>Changing the time zone to {zone}</b>
      <p className="note">
        Events without their own time zone keep their local times, now read in {zone}.
        {!impact.items.length ? " No event times are affected." : ""}
      </p>
      {ok.length ? (
        <>
          <p className="note">These events keep their local time, which becomes a different moment:</p>
          <ul className={styles.list}>
            {ok.map((i) => <li key={i.itemId}>{i.title}: {i.localDate} at {i.localTime}</li>)}
          </ul>
        </>
      ) : null}
      {impact.bookingTasks.length ? (
        <>
          <p className="note">Book-by dates are read in the new time zone ({plural(impact.bookingTasks.length, "booking task")}):</p>
          <ul className={styles.list}>
            {impact.bookingTasks.map((b) => (
              <li key={b.itemId}>
                {b.title}: book by {b.dueDate}
                {b.before !== b.after ? <b>, changes from {DUE_WORD[b.before]} to {DUE_WORD[b.after]}</b> : <>, stays {DUE_WORD[b.after]}</>}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {gaps.length ? (
        <ul className={styles.warnings}>
          {gaps.map((g) => <li key={g.itemId}>{g.title}: {g.localTime} doesn&apos;t exist on {g.localDate} in {zone}. Change that event first.</li>)}
        </ul>
      ) : null}
      {ambiguous.map((a) => (
        <label className={styles.choice} key={a.itemId}>
          {a.title}: {a.localTime} happens twice on {a.localDate}
          <select value={choices[a.itemId] ?? ""} onChange={(e) => onChoose(a.itemId, e.target.value as Choice)}>
            <option value="" disabled>Choose one</option>
            <option value="earlier">The earlier one</option>
            <option value="later">The later one</option>
          </select>
        </label>
      ))}
    </Card>
  );
}

/** True while the change can't be saved yet: a missing time, or a repeated time without a choice. */
export function impactBlocks(impact: Impact | null, choices: Record<string, Choice>): boolean {
  if (!impact) return false;
  return impact.items.some((i) => i.result === "gap" || (i.result === "ambiguous" && !choices[i.itemId]));
}
