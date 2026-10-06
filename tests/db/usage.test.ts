import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/actor";
import { commitImport } from "@/server/modules/import/import.service";
import { createItem, deleteItem, duplicateItem, updateItem, updateItemFields, updateItemNotes } from "@/server/modules/items/items.service";
import { createTrip } from "@/server/modules/trips/trips.service";
import { countUsage } from "@/server/modules/usage/usage.service";
import type { ImportCommitInput, PlanItemDraftDTO } from "@/shared/import";
import example from "../../docs/design/import-example-v1.json";
import { event, makeActor, NOW, reset, testDb, tripInput } from "./helpers";

const session = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock("@/server/auth/session", async () => {
  const { HttpError } = await import("@/server/core/http/errors");
  return {
    currentActor: async () => session.actor,
    requireActor: async () => {
      if (!session.actor) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
      return session.actor;
    },
  };
});
const preview = await import("@/app/api/import/preview/route");

const origin = "http://localhost:3000";
const post = (body: unknown) =>
  new Request(`${origin}/api/import/preview`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });

async function counts(): Promise<Record<string, number>> {
  const rows = await testDb().selectFrom("usage_counts").select(["name", "count"]).execute();
  return Object.fromEntries(rows.map((r) => [r.name, Number(r.count)]));
}

const item = (over: Partial<PlanItemDraftDTO>): PlanItemDraftDTO =>
  ({
    location: null, notes: null, links: [], bookingStatus: "not_required", bookingDueDate: null, plannedPrice: null,
    localDate: "2027-04-15", localTime: null, timeZone: null, durationMinutes: null, timeDisambiguation: null, flightDetails: null,
    type: "activity", title: "Explore", ...over,
  }) as PlanItemDraftDTO;

let owner: Actor;
beforeEach(async () => {
  await reset();
  owner = await makeActor("owner@example.com", "Link");
  session.actor = owner;
});

describe("pilot counts (PRD: Validation and MVP acceptance)", () => {
  it("counts previews by outcome without storing the pasted response", async () => {
    await preview.POST(post({ responseText: JSON.stringify(example), ownerProvidedBudget: null }));
    await preview.POST(post({ responseText: JSON.stringify({ ...example, items: [{ ...example.items[0], title: "" }] }), ownerProvidedBudget: null }));
    expect((await preview.POST(post({ responseText: "{ not json", ownerProvidedBudget: null }))).status).toBe(422);
    expect(await counts()).toEqual({ import_preview_ok: 1, import_preview_needs_fixes: 1, import_preview_rejected: 1 });
    const columns = await testDb().selectFrom("usage_counts").selectAll().executeTakeFirstOrThrow();
    expect(Object.keys(columns).sort()).toEqual(["count", "day", "name"]);
  });

  it("counts a confirmed import, its items and skipped items, but not a retry", async () => {
    const draft: ImportCommitInput = {
      expectedFormatVersion: 1,
      ownerProvidedBudget: null,
      trip: { title: "Tokyo week", destination: "Tokyo, Japan", startDate: "2027-04-14", endDate: "2027-04-18", timeZone: "Asia/Tokyo", budget: null },
      items: [item({ title: "A" }), item({ title: "B" })],
      previewSkipped: 3,
    };
    const key = crypto.randomUUID();
    await commitImport(testDb(), owner, draft, key);
    await commitImport(testDb(), owner, draft, key);
    expect(await counts()).toEqual({ import_trip_created: 1, import_items_created: 2, import_items_skipped: 3 });
  });

  it("counts edits and deletions of imported items, due dates, bookings and manual work", async () => {
    const draft: ImportCommitInput = {
      expectedFormatVersion: 1, ownerProvidedBudget: null,
      trip: { title: "Kyoto", destination: "Kyoto, Japan", startDate: "2027-04-14", endDate: "2027-04-18", timeZone: "Asia/Tokyo", budget: null },
      items: [item({ title: "Imported one" }), item({ title: "Imported two" })],
    };
    const { tripId } = await commitImport(testDb(), owner, draft, crypto.randomUUID());
    const rows = await testDb().selectFrom("plan_items").select(["id", "version", "title"]).where("trip_id", "=", tripId).orderBy("title").execute();
    const [one, two] = rows as [(typeof rows)[number], (typeof rows)[number]];
    await updateItem(testDb(), owner, tripId, one.id, { item: event({ title: "Imported one, edited", localDate: "2027-04-15", localTime: null, bookingStatus: "needs_booking", bookingDueDate: "2027-03-01" }), expectedVersion: one.version });
    await updateItemNotes(testDb(), owner, tripId, two.id, { notes: "Bring cash", expectedVersion: two.version });
    await updateItemNotes(testDb(), owner, tripId, two.id, { notes: "Bring cash and a hat", expectedVersion: two.version + 1 });
    await deleteItem(testDb(), owner, tripId, two.id, two.version + 2);

    const manualTrip = await createTrip(testDb(), owner, tripInput, NOW);
    const manual = await createItem(testDb(), owner, manualTrip.id, event({ bookingStatus: "needs_booking", bookingDueDate: "2026-11-01" }));
    await updateItem(testDb(), owner, manualTrip.id, manual.id, { item: event({ bookingStatus: "booked" }), expectedVersion: manual.version });

    expect(await counts()).toMatchObject({
      import_trip_created: 1,
      ai_item_edited: 3,
      ai_item_first_edited: 2,
      ai_item_deleted: 1,
      due_date_set: 2,
      manual_trip_created: 1,
      manual_item_created: 1,
      item_booked: 1,
    });
  });

  it("counts no AI item edit for a save that changes nothing, or for a person's copy of an AI item", async () => {
    const draft: ImportCommitInput = {
      expectedFormatVersion: 1, ownerProvidedBudget: null,
      trip: { title: "Kyoto", destination: "Kyoto, Japan", startDate: "2027-04-14", endDate: "2027-04-18", timeZone: "Asia/Tokyo", budget: null },
      items: [item({ title: "Imported one", notes: "Bring cash" })],
    };
    const { tripId } = await commitImport(testDb(), owner, draft, crypto.randomUUID());
    const row = await testDb().selectFrom("plan_items").selectAll().where("trip_id", "=", tripId).executeTakeFirstOrThrow();
    const ai = ["ai_item_edited", "ai_item_first_edited", "ai_item_deleted"];
    const firstEdited = async (id: string) => (await testDb().selectFrom("plan_items").select("person_edited_at").where("id", "=", id).executeTakeFirstOrThrow()).person_edited_at;

    // The title and the notes saved again with a trailing space are trimmed back to what was there.
    const same = await updateItemFields(testDb(), owner, tripId, row.id, { changes: { title: "Imported one " }, base: { title: "Imported one" } });
    const again = await updateItemNotes(testDb(), owner, tripId, row.id, { notes: "Bring cash ", expectedVersion: same.version });
    expect(again).toMatchObject({ title: "Imported one", notes: "Bring cash", version: row.version + 2 });
    for (const name of ai) expect(await counts()).not.toHaveProperty(name);
    expect(await firstEdited(row.id)).toBeNull();

    // Changing and deleting a copy isn't correcting AI output.
    const copy = await duplicateItem(testDb(), owner, tripId, row.id, again.version);
    const mine = await updateItemNotes(testDb(), owner, tripId, copy.id, { notes: "Mine now", expectedVersion: copy.version });
    await deleteItem(testDb(), owner, tripId, copy.id, mine.version);
    for (const name of ai) expect(await counts()).not.toHaveProperty(name);
    expect(await firstEdited(copy.id)).toBeNull();

    // The original's first real change counts once, and the next one only as a save.
    const changed = await updateItemNotes(testDb(), owner, tripId, row.id, { notes: "Bring yen", expectedVersion: again.version });
    await updateItemFields(testDb(), owner, tripId, row.id, { changes: { title: "Imported one, at dawn" }, base: { title: "Imported one" } });
    expect(await counts()).toMatchObject({ ai_item_edited: 2, ai_item_first_edited: 1 });
    expect(await firstEdited(row.id)).toEqual(expect.any(Date));
    expect(changed.version).toBe(again.version + 1);
  });

  it("never fails the owner's action when counting fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await countUsage({ insertInto: () => { throw new Error("boom"); } } as never, [{ name: "manual_item_created" }]);
    expect(spy).toHaveBeenCalledWith("[usage] Error");
    spy.mockRestore();
  });
});
