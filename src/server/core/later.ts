import "server-only";
import { after } from "next/server";

/** Work to finish after the response has gone out, so neither a person nor a connected chat waits for it. */
export type Later = (task: () => Promise<void>) => void;

/** Next's `after` inside a request; outside one (scripts, tests calling a handler directly) the task simply starts now. */
export const later: Later = (task) => {
  try {
    after(task);
  } catch {
    void task();
  }
};
