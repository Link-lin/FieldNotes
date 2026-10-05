/**
 * Live updates (TRIP-11): while a page is in view it asks the server every few seconds for a short revision string, and
 * refreshes itself when that moves. Pure, on an injected clock, so the timing can be tested without a browser.
 */
export const LIVE = {
  /** How often a page in view asks. */
  every: 3000,
  /** The longest wait between attempts while the server can't be reached. */
  maxBackoff: 30000,
} as const;

export type RevisionClock = { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void };
export type RevisionAnswer = { ok: true; revision: string } | { ok: false; status: number };

export type RevisionWatcher = {
  /** The revision the page shows now; checking starts once it is known. */
  setRendered: (revision: string) => void;
  /** The page came into view or went out of it; nothing is asked while it is hidden. */
  setVisible: (visible: boolean) => void;
  /** Ask now (the window got focus, or the connection came back). */
  poke: () => void;
  dispose: () => void;
};

export function createRevisionWatcher(options: {
  fetchRevision: () => Promise<RevisionAnswer>;
  /** Re-render the page from the server. Called once per new revision, never in a loop. */
  refresh: () => void;
  clock: RevisionClock;
  visible: boolean;
  /** True while this tab is saving something itself: its own refresh follows, so a check would only race it. */
  busy?: () => boolean;
}): RevisionWatcher {
  const { clock } = options;
  let rendered: string | null = null;
  // The revision a refresh was last asked for. A page that still shows an older one afterwards is not refreshed again for
  // the same revision, so a failed render can't turn into a refresh loop.
  let requested: string | null = null;
  let visible = options.visible;
  let timer: unknown = null;
  let asking = false;
  let failures = 0;
  let stopped = false;
  let disposed = false;

  const clear = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };
  const schedule = (ms: number) => {
    clear();
    if (!disposed && !stopped && visible && rendered !== null) timer = clock.setTimeout(() => void check(), ms);
  };

  async function check() {
    timer = null;
    if (disposed || stopped || !visible || rendered === null || asking) return;
    if (options.busy?.()) {
      schedule(LIVE.every);
      return;
    }
    asking = true;
    const answer = await options.fetchRevision();
    asking = false;
    if (disposed) return;
    if (answer.ok) {
      failures = 0;
      if (answer.revision !== rendered && answer.revision !== requested) {
        requested = answer.revision;
        options.refresh();
      }
      schedule(LIVE.every);
      return;
    }
    // Signed out, or the trip is gone or no longer shared: one refresh shows the page that says so, then stop asking.
    if (answer.status === 401 || answer.status === 403 || answer.status === 404) {
      stopped = true;
      clear();
      options.refresh();
      return;
    }
    failures += 1;
    schedule(Math.min(LIVE.every * 2 ** failures, LIVE.maxBackoff));
  }

  return {
    setRendered(revision) {
      const first = rendered === null;
      rendered = revision;
      if (first) schedule(LIVE.every);
    },
    setVisible(next) {
      visible = next;
      if (next) schedule(0);
      else clear();
    },
    poke() {
      if (visible) schedule(0);
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}
