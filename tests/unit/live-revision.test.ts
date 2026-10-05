import { describe, expect, it } from "vitest";
import { createRevisionWatcher, LIVE, type RevisionAnswer, type RevisionClock } from "@/lib/live-revision";

/** A clock whose timers run only when the test moves time on; answers settle before the next timer. */
function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: RevisionClock = {
    setTimeout: (fn, ms) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id as number),
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
      await settle();
    }
    now = end;
    await settle();
  }
  return { clock, advance, pending: () => timers.size };
}

function setup({ visible = true, busy = () => false }: { visible?: boolean; busy?: () => boolean } = {}) {
  const t = fakeClock();
  let answer: RevisionAnswer = { ok: true, revision: "1.owner" };
  const asked: number[] = [];
  let refreshes = 0;
  let calls = 0;
  const w = createRevisionWatcher({
    fetchRevision: async () => {
      calls++;
      asked.push(calls);
      return answer;
    },
    refresh: () => void refreshes++,
    clock: t.clock,
    visible,
    busy,
  });
  return {
    w,
    ...t,
    answer: (a: RevisionAnswer) => void (answer = a),
    asks: () => calls,
    refreshes: () => refreshes,
  };
}

describe("live revision watcher (TRIP-11)", () => {
  it("waits until it knows what the page shows, then asks every few seconds while the page is in view", async () => {
    const s = setup();
    await s.advance(10_000);
    expect(s.asks()).toBe(0);
    s.w.setRendered("1.owner");
    await s.advance(LIVE.every - 1);
    expect(s.asks()).toBe(0);
    await s.advance(1);
    expect(s.asks()).toBe(1);
    await s.advance(LIVE.every * 3);
    expect(s.asks()).toBe(4);
    expect(s.refreshes()).toBe(0);
  });

  it("refreshes once for each new revision, and never again for the same one if the page didn't catch up", async () => {
    const s = setup();
    s.w.setRendered("1.owner");
    s.answer({ ok: true, revision: "2.owner" });
    await s.advance(LIVE.every);
    expect(s.refreshes()).toBe(1);
    // The refresh failed to show revision 2: asking again finds 2 again, which is not refreshed a second time.
    await s.advance(LIVE.every * 4);
    expect(s.refreshes()).toBe(1);
    s.answer({ ok: true, revision: "3.owner" });
    await s.advance(LIVE.every);
    expect(s.refreshes()).toBe(2);
    // Once the page shows the server's revision there is nothing to do.
    s.w.setRendered("3.owner");
    await s.advance(LIVE.every * 3);
    expect(s.refreshes()).toBe(2);
    // A role change alone is a new revision too.
    s.answer({ ok: true, revision: "3.viewer" });
    await s.advance(LIVE.every);
    expect(s.refreshes()).toBe(3);
  });

  it("asks nothing while the page is hidden, and asks at once when it comes back or the window gets focus", async () => {
    const s = setup({ visible: false });
    s.w.setRendered("1.owner");
    await s.advance(LIVE.every * 5);
    expect(s.asks()).toBe(0);
    s.w.poke();
    await s.advance(0);
    expect(s.asks()).toBe(0);
    s.w.setVisible(true);
    await s.advance(0);
    expect(s.asks()).toBe(1);
    s.w.poke();
    await s.advance(0);
    expect(s.asks()).toBe(2);
    s.w.setVisible(false);
    await s.advance(LIVE.every * 5);
    expect(s.asks()).toBe(2);
    expect(s.pending()).toBe(0);
  });

  it("backs off while the server can't be reached, up to a limit, and keeps the usual pace once it answers", async () => {
    const s = setup();
    s.w.setRendered("1.owner");
    s.answer({ ok: false, status: 0 });
    await s.advance(LIVE.every);
    expect(s.asks()).toBe(1);
    for (const wait of [LIVE.every * 2, LIVE.every * 4, LIVE.every * 8, LIVE.maxBackoff, LIVE.maxBackoff]) {
      await s.advance(wait - 1);
      const before = s.asks();
      await s.advance(1);
      expect(s.asks()).toBe(before + 1);
    }
    s.answer({ ok: true, revision: "1.owner" });
    await s.advance(LIVE.maxBackoff);
    const asked = s.asks();
    await s.advance(LIVE.every);
    expect(s.asks()).toBe(asked + 1);
    expect(s.refreshes()).toBe(0);
  });

  it("refreshes once and stops asking when signed out, or when the trip is gone or no longer shared", async () => {
    for (const status of [401, 403, 404]) {
      const s = setup();
      s.w.setRendered("1.owner");
      s.answer({ ok: false, status });
      await s.advance(LIVE.every);
      expect(s.refreshes()).toBe(1);
      await s.advance(LIVE.every * 10);
      expect(s.asks()).toBe(1);
      expect(s.refreshes()).toBe(1);
    }
  });

  it("leaves the page alone while this tab is saving (its own refresh follows), and stops when disposed", async () => {
    let busy = true;
    const s = setup({ busy: () => busy });
    s.w.setRendered("1.owner");
    s.answer({ ok: true, revision: "2.owner" });
    await s.advance(LIVE.every * 3);
    expect(s.asks()).toBe(0);
    busy = false;
    await s.advance(LIVE.every);
    expect(s.refreshes()).toBe(1);
    s.w.dispose();
    await s.advance(LIVE.every * 5);
    expect(s.asks()).toBe(1);
    expect(s.pending()).toBe(0);
  });
});
