"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FieldError } from "@/shared/dto";
import { openStreetMapPointUrl } from "@/shared/map-links";
import { importCommitSchema, importMoneySchema, tripDraftSchema, type ImportCommitInput, type ImportLocationResult, type ImportPreviewDTO } from "@/shared/import";
import { Banner } from "@/components/ui/Banner/Banner";
import { Button } from "@/components/ui/Button/Button";
import { FormError } from "@/components/ui/Field/Field";
import { Modal, ModalActions } from "@/components/ui/Modal/Modal";
import { useToast } from "@/components/ui/Toast/Toast";
import { api } from "@/lib/api";
import { buildConversionPrompt, buildImportPrompt, type TripBrief } from "../import-prompt";
import { DraftItemEditor } from "./DraftItemEditor/DraftItemEditor";
import { RepairOptions } from "./RepairOptions/RepairOptions";
import { TripBrief as TripBriefForm } from "./TripBrief/TripBrief";
import { TripPreview } from "./TripPreview/TripPreview";
import { groupPreviewItems } from "./preview-groups";
import { editPreviewItem, editPreviewTrip, hasRemovableEmptySourceValues, removePreviewEmptySourceValues, removePreviewUnknownFields } from "./preview-validation";
import { finishLookup, lookupMatches, needsLookup, settleLookups, type PlaceLookup } from "./place-lookup";
import styles from "./ImportPage.module.css";

const KEY = "field-notes-import-idempotency-key";
const SENSITIVE = "Do not include passport details, payment-card data or booking-confirmation codes. Your AI chat has its own data policies.";
const CONVERSION_PROMPT = buildConversionPrompt();
const asText = (value: unknown): string => value == null ? "" : typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value);

function issuePath(path: PropertyKey[], included: ImportPreviewDTO["items"]): string {
  if (path[0] === "items" && typeof path[1] === "number") {
    const original = included[path[1]]?.index ?? path[1];
    return `items[${original}]${path.length > 2 ? `.${path.slice(2).join(".")}` : ""}`;
  }
  return path.join(".");
}

function rowErrors(errors: FieldError[], index: number): FieldError[] {
  return errors.filter((error) => error.path.startsWith(`items[${index}]`) || error.path.startsWith(`items.${index}.`));
}

/** The items that errors point at (`items[3].title` is item 3), so their cards can be opened. */
function errorRows(errors: FieldError[]): number[] {
  return errors.flatMap((error) => {
    const match = /^items(?:\[(\d+)\]|\.(\d+)\.)/.exec(error.path);
    return match ? [Number(match[1] ?? match[2])] : [];
  });
}

function initialBrief(): TripBrief {
  return { title: "", destination: "", startDate: "", endDate: "", timeZone: "UTC", interests: "", pace: "", constraints: "", budgetAmount: "", budgetCurrency: "USD" };
}

/** New-trip AI import: explicit prompt copy, paste, editable preview, and confirmed atomic commit. */
export function ImportPage() {
  const router = useRouter();
  const toast = useToast();
  const [brief, setBrief] = useState<TripBrief>(initialBrief);
  const [briefErrors, setBriefErrors] = useState<Record<string, string>>({});
  const [responseText, setResponseText] = useState(""); // Private draft: page memory only.
  const [preview, setPreview] = useState<ImportPreviewDTO | null>(null);
  const [pasteErrors, setPasteErrors] = useState<FieldError[]>([]);
  const [localErrors, setLocalErrors] = useState<FieldError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [confirming, setConfirming] = useState<ImportCommitInput | null>(null);
  const [pending, setPending] = useState<{ body: ImportCommitInput; key: string } | null>(null);
  const [commitState, setCommitState] = useState<"uncertain" | "conflict" | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [existingKey, setExistingKey] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  // Item cards showing their edit form. Cards with issues start open; Expand all and Collapse all set every card.
  const [openRows, setOpenRows] = useState<ReadonlySet<number>>(() => new Set());
  const [lookups, setLookups] = useState<Record<number, PlaceLookup>>({});
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const lookupRun = useRef(0);
  const lookupRequests = useRef<Record<number, number>>({});
  const inputRevision = useRef(0);
  const prompt = useMemo(() => buildImportPrompt(brief), [brief]);
  const locked = busy === "commit" || pending !== null;
  const included = preview?.items.filter((item) => item.included) ?? [];
  const lookupBusy = locating || included.some((row) => lookupMatches(lookups[row.index], row.values.location, preview?.trip.values.destination) && lookups[row.index]?.status === "loading");
  const previewItems = preview?.items;
  const previewZone = typeof preview?.trip.values.timeZone === "string" ? preview.trip.values.timeZone : null;
  const groupedItems = useMemo(() => previewItems ? groupPreviewItems(previewItems, previewZone) : [], [previewItems, previewZone]);
  const editor = (row: ImportPreviewDTO["items"][number]) => preview ? (
    <DraftItemEditor key={row.index} row={row} errors={[...row.errors, ...rowErrors(localErrors, row.index)]} busy={locked} tripZone={previewZone}
      open={openRows.has(row.index)} onOpenChange={(open) => setRowOpen(row.index, open)}
      canRemoveEmptySourceValues={hasRemovableEmptySourceValues(row, preview.trip.values)} onChange={(path, value) => editItem(row.index, path, value)}
      onIncluded={(value) => setIncluded(row.index, value)} onRemoveUnsupported={() => removeUnsupported(row.index)} onRemoveEmptySourceValues={() => removeEmptySourceValues(row.index)}
      lookup={lookupMatches(lookups[row.index], row.values.location, preview.trip.values.destination) ? (lookups[row.index] ?? null) : null}
      onSelectLocation={(selected) => {
        lookupRequests.current[row.index] = (lookupRequests.current[row.index] ?? 0) + 1;
        setLookups((old) => { const entry = old[row.index]; return entry ? { ...old, [row.index]: { ...entry, selected, reviewed: true } } : old; });
      }}
      onRetryLocation={() => void locateOne(row.index, asText(row.values.location), asText(preview.trip.values.destination), lookupRun.current)} />
  ) : null;
  const remaining = included.reduce((sum, item) => sum + item.errors.length + rowErrors(localErrors, item.index).length, 0) + (preview?.trip.errors.length ?? 0) + localErrors.filter((e) => e.path.startsWith("trip.")).length;

  useEffect(() => {
    const run = lookupRun;
    const frame = requestAnimationFrame(() => {
      const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      setBrief((old) => old.timeZone === "UTC" ? { ...old, timeZone: browserZone } : old);
      setExistingKey(!!sessionStorage.getItem(KEY));
    });
    return () => { cancelAnimationFrame(frame); run.current++; };
  }, []);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(label);
      toast({ message: `${label}.` });
    } catch {
      setCopyStatus("Clipboard access failed. Select and copy the shown text instead.");
    }
  }

  function budgetFromBrief() {
    return brief.budgetAmount.trim() ? { amount: brief.budgetAmount.trim(), currency: brief.budgetCurrency } : null;
  }

  function validateBudget(): boolean {
    const budget = budgetFromBrief();
    if (!budget) { setBriefErrors((old) => ({ ...old, budget: "" })); return true; }
    const result = importMoneySchema.safeParse(budget);
    if (result.success) { setBriefErrors((old) => ({ ...old, budget: "" })); return true; }
    setBriefErrors((old) => ({ ...old, budget: result.error.issues[0]?.message ?? "Correct the amount and currency." }));
    setBuilderOpen(true);
    requestAnimationFrame(() => document.getElementById("brief-budget")?.focus());
    return false;
  }

  async function copyPrompt() {
    const trip = { title: brief.title, destination: brief.destination, startDate: brief.startDate, endDate: brief.endDate, timeZone: brief.timeZone, budget: budgetFromBrief() };
    const result = tripDraftSchema.safeParse(trip);
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) errors[String(issue.path[0]) === "budget" ? "budget" : String(issue.path[0])] ??= issue.message;
      setBriefErrors(errors);
      const first = Object.keys(errors)[0];
      requestAnimationFrame(() => document.getElementById(first === "budget" ? "brief-budget" : `brief-${first}`)?.focus());
      return;
    }
    setBriefErrors({});
    await copy(prompt, "Prompt copied");
  }

  async function validateResponse() {
    if (!responseText.trim()) {
      setMessage("Paste the JSON response first.");
      document.getElementById("import-response")?.focus();
      return;
    }
    if (!validateBudget()) return;
    lookupRun.current++;
    setLocating(false);
    setBusy("preview");
    setMessage(null);
    setPasteErrors([]);
    setCopyStatus(null);
    const revision = inputRevision.current;
    const submittedText = responseText;
    const submittedBudget = budgetFromBrief();
    const result = await api<ImportPreviewDTO>("POST", "/api/import/preview", { responseText: submittedText, ownerProvidedBudget: submittedBudget });
    if (revision !== inputRevision.current) { setBusy(null); return; }
    setBusy(null);
    if (!result.ok) {
      setPasteErrors(result.fields.length ? result.fields : [{ path: "Response", code: result.code, message: result.message }]);
      setMessage(result.status === 413 ? "The response is too long. Ask the AI to shorten notes and omit optional links, then paste the complete response again." : result.message);
      requestAnimationFrame(() => document.getElementById("import-paste-error")?.focus());
      return;
    }
    setPreview(result.data);
    setLookups({});
    setLookupMessage(null);
    setLocalErrors([]);
    setOpenRows(new Set(result.data.items.filter((row) => row.errors.length).map((row) => row.index)));
    requestAnimationFrame(() => document.getElementById("import-preview-title")?.focus());
    void locateAll(result.data, false);
  }

  async function locateOne(index: number, rawLocation: string, rawDestination: string, run: number): Promise<boolean> {
    const location = rawLocation.trim(), destination = rawDestination.trim();
    if (!location || !destination) return true;
    const requestId = (lookupRequests.current[index] ?? 0) + 1;
    lookupRequests.current[index] = requestId;
    setLookups((old) => ({ ...old, [index]: { location, destination, requestId, reviewed: false, status: "loading", candidates: [], selected: null } }));
    const result = await api<ImportLocationResult>("POST", "/api/places/resolve", { location, destination });
    if (run !== lookupRun.current) return false;
    if (lookupRequests.current[index] !== requestId) return true;
    setLookups((old) => {
      const entry = finishLookup(old[index], requestId, result.ok ? result.data : null);
      return entry ? { ...old, [index]: entry } : old;
    });
    if (!result.ok && result.code === "place_lookup_unavailable") setLookupMessage(result.message);
    return result.ok || result.code !== "place_lookup_unavailable";
  }

  async function locateAll(draft: ImportPreviewDTO, preserveReviewed = true) {
    const run = ++lookupRun.current;
    setLookups(settleLookups);
    setLookupMessage(null);
    const destination = typeof draft.trip.values.destination === "string" ? draft.trip.values.destination.trim() : "";
    const targets = draft.items.filter((row) => row.included && row.values.type !== "flight" && typeof row.values.location === "string" && row.values.location.trim().length >= 2
      && (!preserveReviewed || needsLookup(lookups[row.index], row.values.location, destination)))
      .map((row) => ({ row, revision: lookupRequests.current[row.index] ?? 0 }));
    setLocating(targets.length > 0);
    let next = 0;
    let active = true;
    const worker = async () => {
      while (active && run === lookupRun.current && next < targets.length) {
        const { row, revision } = targets[next++]!;
        if (revision !== (lookupRequests.current[row.index] ?? 0)) continue;
        const keepGoing = await locateOne(row.index, String(row.values.location), destination, run);
        if (!keepGoing) active = false;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
    if (run === lookupRun.current) setLocating(false);
  }

  function editTrip(path: string, value: unknown) {
    setPreview((old) => old ? editPreviewTrip(old, path, value) : old);
    if (path === "destination") { lookupRun.current++; setLookups({}); setLocating(false); }
    setLocalErrors((old) => old.filter((e) => !e.path.startsWith("trip.")));
  }

  function editItem(index: number, path: string, value: unknown) {
    setPreview((old) => old ? editPreviewItem(old, index, path, value) : old);
    if (path === "location" || path === "type") {
      lookupRequests.current[index] = (lookupRequests.current[index] ?? 0) + 1;
      setLookups((old) => { const next = { ...old }; delete next[index]; return next; });
    }
    setLocalErrors((old) => old.filter((e) => !rowErrors([e], index).length));
  }

  function setRowOpen(index: number, open: boolean) {
    setOpenRows((old) => {
      if (old.has(index) === open) return old;
      const next = new Set(old);
      if (open) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  function openRowsWithErrors(errors: FieldError[]) {
    setOpenRows((old) => new Set([...old, ...errorRows(errors)]));
  }

  function setIncluded(index: number, value: boolean) {
    setPreview((old) => old ? { ...old, items: old.items.map((row) => row.index === index ? { ...row, included: value } : row) } : old);
  }

  function removeUnsupported(index: number) {
    setPreview((old) => old ? removePreviewUnknownFields(old, index) : old);
  }

  function removeEmptySourceValues(index: number) {
    setPreview((old) => old ? removePreviewEmptySourceValues(old, index) : old);
  }

  function reviewCommit() {
    if (!preview || locked) return;
    if (lookupBusy) {
      setMessage("Place lookup is still running. Wait for it to finish, or skip the remaining lookups before reviewing creation.");
      requestAnimationFrame(() => document.getElementById("import-preview-error")?.focus());
      return;
    }
    if (remaining) {
      openRowsWithErrors([...included.flatMap((row) => row.errors), ...localErrors]);
      setMessage("Correct trip errors and every included item, or explicitly skip an item with errors.");
      requestAnimationFrame(() => document.getElementById("import-preview-error")?.focus());
      return;
    }
    const destination = preview.trip.values.destination;
    const confirmedMapUrls = included.map((row) => {
      const found = lookups[row.index];
      const selected = found?.selected;
      if (!found || !lookupMatches(found, row.values.location, destination) || selected === null || selected === undefined) return null;
      const match = found.candidates[selected];
      return match ? openStreetMapPointUrl(match.latitude, match.longitude) : null;
    });
    const candidate = { expectedFormatVersion: 1, ownerProvidedBudget: preview.trip.values.budget ?? null,
      trip: preview.trip.values, items: included.map((row) => row.values), confirmedMapUrls, previewSkipped: preview.items.length - included.length };
    const parsed = importCommitSchema.safeParse(candidate);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue) => ({ path: issuePath(issue.path, included), code: issue.code, message: issue.message }));
      setLocalErrors(errors);
      openRowsWithErrors(errors);
      setMessage("Correct the highlighted fields or skip an invalid item before confirming.");
      requestAnimationFrame(() => document.getElementById("import-preview-error")?.focus());
      return;
    }
    setLocalErrors([]);
    setMessage(null);
    setConfirming(parsed.data);
  }

  async function sendCommit(body: ImportCommitInput, key: string) {
    setBusy("commit");
    setCommitState(null);
    setMessage(null);
    const result = await api<{ tripId: string }>("POST", "/api/import/commit", body, { headers: { "Idempotency-Key": key } });
    setBusy(null);
    if (result.ok) {
      sessionStorage.removeItem(KEY);
      setExistingKey(false);
      setPending(null);
      router.push(`/trips/${result.data.tripId}`);
      router.refresh();
      return;
    }
    setConfirming(null);
    if (result.status === 0 || result.status >= 500) {
      setPending({ body, key });
      setCommitState("uncertain");
      setMessage("The result is unknown. Retry the same import to check whether the trip was created. Keep this tab open.");
      return;
    }
    if (result.status === 409 || result.status === 410) {
      setPending({ body, key });
      setCommitState("conflict");
      setMessage(result.status === 410 ? "This import created a trip that was later deleted. Start a new attempt only if you want to create it again." : "This import key was used with different values. Start a new attempt only if a second trip is intended.");
      return;
    }
    setPending(null);
    setLocalErrors(result.fields);
    openRowsWithErrors(result.fields);
    setMessage(result.message);
    requestAnimationFrame(() => document.getElementById("import-preview-error")?.focus());
  }

  function beginCommit() {
    if (!confirming) return;
    const key = sessionStorage.getItem(KEY) || crypto.randomUUID();
    sessionStorage.setItem(KEY, key);
    setExistingKey(true);
    const body = confirming;
    setConfirming(null);
    setPending({ body, key });
    void sendCommit(body, key);
  }

  function newAttempt() {
    sessionStorage.removeItem(KEY);
    setExistingKey(false);
    setPending(null);
    setCommitState(null);
    setMessage("You can review and confirm again. A previous import may have created a trip; check the dashboard before repeating it.");
  }

  return (
    <div className={styles.page}>
      <nav aria-label="Breadcrumb"><Link href="/">← All trips</Link></nav>
      <header className={styles.intro}>
        <p className="mono muted">External AI import · JSON v1</p>
        <h1>Create from an AI plan</h1>
        <p>Already planned a trip in ChatGPT or Gemini? Convert that conversation to JSON v1 and paste it here. You can edit or skip suggestions before a trip is created.</p>
      </header>

      {existingKey && !pending ? (
        <Banner tone="warn" role="status">
          <p>This tab has a key from an earlier import attempt. If you are retrying after a lost response, paste the same JSON and repeat the same preview edits to check the result. Check the dashboard before creating another trip.</p>
          <div className={styles.actions}><Button variant="quiet" onClick={newAttempt}>Start a different import attempt</Button></div>
        </Banner>
      ) : null}

      {!preview ? (
        <>
          <section className={styles.section} aria-labelledby="paste-heading" aria-busy={busy === "preview"}>
            <div className={styles.step}><span>1</span><h2 id="paste-heading">Bring in an existing plan</h2></div>
            <p>In the chat where you planned your trip, paste the conversion prompt below. ChatGPT or Gemini can use your earlier conversation to return the required JSON. If you already have JSON v1, paste it directly.</p>
            <div className={styles.actions}>
              <Button variant="outline" onClick={() => copy(CONVERSION_PROMPT, "Conversion prompt copied")} disabled={busy === "preview"}>Copy conversion prompt</Button>
              <a href="/api/import/schema" target="_blank" rel="noopener noreferrer">View JSON v1 schema ↗</a>
            </div>
            <details className={styles.prompt}><summary>Review the conversion prompt</summary><pre>{CONVERSION_PROMPT}</pre></details>
            <Banner tone="info">Copying a prompt does not send anything from Field Notes. You decide what to share with your AI chat. {SENSITIVE}</Banner>
            <label className={styles.pasteLabel} htmlFor="import-response">Paste the JSON response</label>
            <p className="note">Paste one JSON v1 object. A surrounding Markdown code fence is okay. No response is saved before you confirm the preview. You can set or correct the trip budget in the preview. If place lookup is configured, previewing sends each event&apos;s place name and trip destination to Geoapify for suggested map pins; notes, prices, and the raw JSON are not sent.</p>
            <textarea id="import-response" className={styles.paste} value={responseText} onChange={(e) => { inputRevision.current++; setResponseText(e.target.value); setPasteErrors([]); setMessage(null); }} rows={12} spellCheck={false} disabled={busy === "preview"} placeholder={'{ "formatVersion": 1, "trip": { ... }, "items": [ ... ] }'} />
            <div className={styles.actions}><Button variant="fill" onClick={validateResponse} disabled={busy === "preview"}>{busy === "preview" ? "Validating…" : "Validate and preview"}</Button>{busy === "preview" ? <span role="status">Checking the response…</span> : null}</div>
            {message ? <FormError id="import-paste-error">{message}</FormError> : null}
            {pasteErrors.length ? <RepairOptions errors={pasteErrors} responseText={responseText} onCopy={copy} /> : null}
          </section>
          <details className={styles.builder} open={builderOpen} onToggle={(e) => setBuilderOpen(e.currentTarget.open)}>
            <summary>Starting with an idea? Build a new trip prompt instead</summary>
            <section className={styles.section} aria-labelledby="brief-heading">
              <h2 id="brief-heading">Describe the trip for your AI chat</h2>
              <p className="note">This optional form builds a planning prompt. It is never required to import a trip you already planned elsewhere.</p>
              <fieldset className={styles.briefFieldset} disabled={busy === "preview"}>
                <TripBriefForm value={brief} onChange={(patch) => { inputRevision.current++; setBrief((old) => ({ ...old, ...patch })); setBriefErrors({}); }} errors={briefErrors} />
              </fieldset>
              <div className={styles.actions}><Button variant="fill" onClick={copyPrompt} disabled={busy === "preview"}>Copy new trip prompt</Button></div>
              <details className={styles.prompt}><summary>Review the new trip prompt</summary><pre>{prompt}</pre></details>
            </section>
          </details>
        </>
      ) : (
        <section className={styles.section} aria-labelledby="import-preview-title">
          <div className={styles.step}><span>2</span><h2 id="import-preview-title" tabIndex={-1}>Review your trip</h2></div>
          <p className="note">Nothing has been saved. All AI suggestions and prices are unverified. Each included item can be edited or skipped.</p>
          <div className={styles.actions}>
            <Button variant="quiet" onClick={() => { lookupRun.current++; setLocating(false); setPreview(null); setLocalErrors([]); setMessage(null); }} disabled={locked}>← Back to paste</Button>
            <span className="mono muted">{included.length} included · {preview.items.length - included.length} skipped</span>
          </div>
          <TripPreview values={preview.trip.values} errors={[...preview.trip.errors, ...localErrors.filter((e) => e.path.startsWith("trip."))]} warnings={preview.trip.warnings} aiBudget={preview.trip.aiBudget ?? null} busy={locked} onChange={editTrip} />
          <div className={styles.itemsHead}>
            <h2>Itinerary items</h2>
            <p className="note">Flights are separate segments. Field Notes looks up place names for map pins; check the suggested locations before creating the trip. Only each place and the trip destination go to Geoapify.</p>
            {lookupMessage ? <Banner tone="warn" role="status">{lookupMessage}</Banner> : null}
            <div className={styles.actions}>
              <Button variant="quiet" onClick={() => void locateAll(preview)} disabled={locked}>Refresh map suggestions</Button>
              {lookupBusy ? <><span className="note" role="status">Finding map locations…</span><Button variant="quiet" onClick={() => { lookupRun.current++; setLocating(false); setLookups(settleLookups); }} disabled={locked}>Skip remaining lookups</Button></> : null}
              <span className="note">Locations: <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></span>
            </div>
            {included.length ? (
              <div className={styles.actions}>
                <Button variant="quiet" onClick={() => setOpenRows(new Set(included.map((row) => row.index)))}>Expand all</Button>
                <Button variant="quiet" onClick={() => setOpenRows(new Set())}>Collapse all</Button>
              </div>
            ) : null}
          </div>
          {preview.items.length ? (
            groupedItems.map((group) => (
              <section key={group.key} className={styles.dayGroup} aria-label={group.label}>
                <h3>{group.label}</h3>
                {group.timed.length ? <ol className={styles.items}>{group.timed.map(editor)}</ol> : null}
                {group.unscheduled.length ? <><h4>{group.key === "undated" || group.key === "undated-flights" || group.key === "needs-correction" ? "Items to review" : "Unscheduled"}</h4><ol className={styles.items}>{group.unscheduled.map(editor)}</ol></> : null}
              </section>
            ))
          ) : <Banner tone="info">This response has no items. You can still create an empty trip and add events later.</Banner>}
          {message ? <FormError id="import-preview-error">{message}</FormError> : null}
          {remaining ? <Banner tone="warn">{remaining} unresolved {remaining === 1 ? "issue" : "issues"} in included content. Correct each issue, skip the affected item, or repair the response in your AI chat.</Banner> : null}
          {remaining ? <RepairOptions errors={[...preview.trip.errors, ...preview.items.flatMap((row) => row.included ? row.errors : []), ...localErrors]} responseText={responseText} onCopy={copy} /> : null}
          {pending ? (
            <Banner tone="warn" role="status">
              <p>{message}</p>
              <div className={styles.actions}>
                {commitState === "uncertain" ? <Button variant="fill" onClick={() => void sendCommit(pending.body, pending.key)} disabled={busy === "commit"}>{busy === "commit" ? "Checking…" : "Retry the same import"}</Button> : null}
                <Button variant="quiet" onClick={newAttempt} disabled={busy === "commit"}>Start a new attempt</Button>
              </div>
            </Banner>
          ) : (
            <div className={styles.finish}>
              <p>Confirming creates <strong>{asText(preview.trip.values.title) || "this trip"}</strong> with {included.length} {included.length === 1 ? "item" : "items"}. {preview.items.length - included.length} skipped {preview.items.length - included.length === 1 ? "item is" : "items are"} not saved. A second confirmation is required.</p>
              <Button data-import-create variant="fill" onClick={reviewCommit} disabled={locked}>Review creation</Button>
            </div>
          )}
        </section>
      )}
      {copyStatus ? <p className="note" role="status">{copyStatus}</p> : null}
      {confirming ? (
        <Modal title="Create this trip?" onClose={() => setConfirming(null)} triggerSelector="[data-import-create]" subtitle="This is the first time the trip and its included items will be saved.">
          <p><strong>{confirming.trip.title}</strong> · {confirming.items.length} {confirming.items.length === 1 ? "item" : "items"}</p>
          <p className="note">Every imported item will be marked as an unverified AI draft until you mark it reviewed on the trip page. No item will be marked Booked.</p>
          <p className="note">{confirming.confirmedMapUrls?.filter(Boolean).length ?? 0} suggested map pins will be saved. Clear venue matches may have been preselected; check unfamiliar matches in the preview before continuing.</p>
          <ModalActions><Button variant="quiet" onClick={() => setConfirming(null)}>Keep reviewing</Button><Button variant="fill" onClick={beginCommit}>Create trip</Button></ModalActions>
        </Modal>
      ) : null}
    </div>
  );
}
