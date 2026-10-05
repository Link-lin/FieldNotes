import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { api, lastWriteAt } from "./api";
import { createRevisionWatcher, type RevisionWatcher } from "./live-revision";

/** How long after this tab saved something its own refresh is still expected. */
const OWN_REFRESH_MS = 1500;

/**
 * Keeps a server-rendered page current (TRIP-11): while the page is in view it asks `url` for the revision every few
 * seconds, and as soon as the window gets focus, and refreshes the page when it differs from `revision`, the one the page
 * was rendered with. A refresh keeps the page's own state: open panels, scroll and anything typed.
 */
export function useLiveRevision(url: string, revision: string) {
  const router = useRouter();
  const watcher = useRef<RevisionWatcher | null>(null);
  useEffect(() => {
    const w = createRevisionWatcher({
      fetchRevision: async () => {
        const r = await api<{ revision: string }>("GET", url);
        return r.ok ? { ok: true, revision: r.data.revision } : { ok: false, status: r.status };
      },
      refresh: () => router.refresh(),
      clock: { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (id) => window.clearTimeout(id as number) },
      visible: document.visibilityState === "visible",
      busy: () => Date.now() - lastWriteAt() < OWN_REFRESH_MS,
    });
    watcher.current = w;
    const onVisibility = () => w.setVisible(document.visibilityState === "visible");
    const onFocus = () => w.poke();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      w.dispose();
      watcher.current = null;
    };
  }, [url, router]);
  useEffect(() => {
    watcher.current?.setRendered(revision);
  }, [revision, url]);
}
