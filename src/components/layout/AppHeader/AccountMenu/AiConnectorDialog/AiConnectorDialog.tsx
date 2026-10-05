"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ConnectionDTO } from "@/shared/dto";
import { Banner } from "@/components/ui/Banner/Banner";
import { Button } from "@/components/ui/Button/Button";
import { Field, FormError } from "@/components/ui/Field/Field";
import { CopyIcon } from "@/components/ui/Icon/icons";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { Tag } from "@/components/ui/Tag/Tag";
import { api } from "@/lib/api";
import { instantDate } from "@/lib/format";
import styles from "./AiConnectorDialog.module.css";

/**
 * CONNECT-1, CONNECT-5: the connector address to paste into Claude or ChatGPT, and the AI apps the person has connected,
 * each with what it may do and a Disconnect that ends it on the app's next request.
 */
export function AiConnectorDialog({ url, onClose, returnFocus }: { url: string; onClose: () => void; returnFocus: () => HTMLElement | null }) {
  const id = useId();
  const address = useRef<HTMLInputElement>(null);
  const [connections, setConnections] = useState<ConnectionDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api<ConnectionDTO[]>("GET", "/api/connector/connections").then((r) => {
      if (!live) return;
      if (r.ok) setConnections(r.data);
      else setLoadError(r.message);
    });
    return () => {
      live = false;
    };
  }, [loads]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      address.current?.select();
      setCopied("manual");
    }
  }

  async function disconnect(c: ConnectionDTO) {
    setError(null);
    setBusy(c.id);
    const r = await api<void>("DELETE", `/api/connector/connections/${c.id}`);
    setBusy(null);
    if (!r.ok) {
      // Already gone (another tab, or it expired): show the list as it is now.
      setError(r.message);
      if (r.status === 404) setLoads((n) => n + 1);
      return;
    }
    setConnections((all) => (all ?? []).filter((x) => x.id !== c.id));
  }

  return (
    <Modal
      title="AI connector"
      onClose={onClose}
      fallbackFocus={returnFocus}
      subtitle="Ask Claude or ChatGPT about your trips, and have it add or change events. It runs on your own account with them; Field Notes calls no AI itself."
    >
      <Field label="Connector address" htmlFor={`${id}-address`}>
        <input id={`${id}-address`} ref={address} className={styles.address} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      </Field>
      <div className={styles.row}>
        <Button onClick={() => void copy()}><CopyIcon /> Copy address</Button>
        <span role="status" className="muted">{copied === "copied" ? "Copied." : copied === "manual" ? "Couldn't copy automatically. The address is selected; copy it with your keyboard." : ""}</span>
      </div>
      <ol className={styles.steps}>
        <li><b>Claude:</b> open <i>Customize</i>, then <i>Connectors</i>, choose <i>Add custom connector</i> and paste the address.</li>
        <li><b>ChatGPT:</b> in <i>Settings</i>, <i>Security and login</i>, turn on <i>Developer mode</i>, then create an app for a remote MCP server with the address and OAuth sign-in. For its optional icon, <a href="/icon.png" download="field-notes-icon.png">save the Field Notes icon</a>.</li>
        <li><b>Claude Code:</b> run <code className={styles.command}>claude mcp add --transport http field-notes {url}</code>, then <code className={styles.command}>/mcp</code> to sign in.</li>
        <li>Sign in to Field Notes in the window that opens and choose what to allow.</li>
      </ol>
      {!url.startsWith("https://") ? (
        <Banner tone="info">This address isn&apos;t a public https address, so Claude and ChatGPT can&apos;t reach it yet. It works once Field Notes is served over https.</Banner>
      ) : null}
      <p className="note">What a connected chat reads is sent to its provider, under that provider&apos;s privacy policy. It can only see and change what your role on each trip allows.</p>

      <section aria-labelledby={`${id}-apps`} className={styles.apps}>
        <h3 id={`${id}-apps`} className={styles.heading}>Connected apps</h3>
        {loadError ? (
          <div className={styles.loadError}>
            <FormError>{loadError}</FormError>
            <Button variant="quiet" onClick={() => { setLoadError(null); setLoads((n) => n + 1); }}>Try again</Button>
          </div>
        ) : connections === null ? (
          <p className="muted" role="status">Loading…</p>
        ) : connections.length === 0 ? (
          <p className="note">No app is connected.</p>
        ) : (
          <ul className={styles.list}>
            {connections.map((c) => (
              <li key={c.id} className={styles.app}>
                <div className={styles.appInfo}>
                  <p className={styles.appName}>{c.appName} <Tag tone="soft">{c.canChange ? "Read and change" : "Read only"}</Tag></p>
                  <p className={`mono ${styles.meta}`}>
                    {c.returnHost} · connected {instantDate(c.connectedAt)} · {c.lastUsedAt ? `last used ${instantDate(c.lastUsedAt)}` : "not used yet"}
                  </p>
                </div>
                <Button variant="outline" onClick={() => void disconnect(c)} disabled={busy !== null} aria-label={`Disconnect ${c.appName}`}>
                  {busy === c.id ? "Disconnecting…" : "Disconnect"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? <FormError>{error}</FormError> : null}
      </section>
      <ModalActions>
        <Button variant="quiet" onClick={onClose}>Done</Button>
      </ModalActions>
    </Modal>
  );
}
